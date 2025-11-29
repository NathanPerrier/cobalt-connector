import { Injectable, Logger, MessageEvent } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { createActor, ActorRefFrom } from 'xstate';
import { sessionMachine } from './machines/session.machine';
import { Observable, ReplaySubject, firstValueFrom } from 'rxjs';
import { map } from 'rxjs/operators';
import { randomUUID } from 'crypto';

// Define interfaces for better type safety
interface BotMessageData {
  plainText?: string;
  text?: string;
  content?: string;
  output?: string;
  response?: string;
  message?: string;
  messageId?: string;
  escalate?: boolean;
  meta?: {
    chatEnded?: boolean;
    [key: string]: any;
  };
  [key: string]: any;
}

interface StateUpdateData {
  type: 'state_update';
  state: string;
  context: any; // Consider defining a more specific interface for context if possible
}

interface SessionInfo {
  actor: ActorRefFrom<typeof sessionMachine>;
  stream: ReplaySubject<
    StateUpdateData | { type: 'bot_message'; data: BotMessageData }
  >;
}

interface N8nPayload {
  sessionId: string;
  context?: any;
  message?: string;
  [key: string]: any;
}

interface TriggerPayload {
  type?: string;
  message?: string;
  [key: string]: any;
}

@Injectable()
export class AppService {
  private readonly logger = new Logger(AppService.name);
  private sessions = new Map<string, SessionInfo>();

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  private getN8nUrl(key: string): string {
    const url = this.configService.get<string>(key);
    if (!url) {
      this.logger.warn(`Environment variable ${key} is not set.`);
      return '';
    }
    return url;
  }

  getOrCreateSession(sessionId: string): SessionInfo {
    if (this.sessions.has(sessionId)) {
      return this.sessions.get(sessionId)!;
    }

    const stream = new ReplaySubject<
      StateUpdateData | { type: 'bot_message'; data: BotMessageData }
    >(10);
    const actor = createActor(sessionMachine);

    actor.subscribe((snapshot) => {
      this.logger.log(`Session ${sessionId} state: ${snapshot.value}`);

      // Emit state update to frontend
      stream.next({
        type: 'state_update',
        state: snapshot.value as unknown as string, // Cast to string as per usage
        context: snapshot.context,
      });

      // Handle N8N calls based on state
      void this.handleStateSideEffects(
        sessionId,
        snapshot.value as unknown as string,
        snapshot.context,
      );
    });

    actor.start();
    const sessionInfo: SessionInfo = { actor, stream };
    this.sessions.set(sessionId, sessionInfo);
    return sessionInfo;
  }

  private async handleStateSideEffects(
    sessionId: string,
    state: string,
    context: any, // Consider defining a more specific interface for context if possible
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    const { actor } = session;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const payload: N8nPayload = { sessionId, context };

    switch (state) {
      case 'live_agent_queue':
        void this.callN8n(this.getN8nUrl('N8N_LIVE_AGENT_QUEUE_URL'), payload);
        break;
      case 'email_transcript_processing':
        try {
          await this.callN8n(this.getN8nUrl('N8N_TRANSCRIPT_URL'), payload);
          actor.send({ type: 'SUCCESS' });
        } catch {
          actor.send({ type: 'FAILURE' });
        }
        break;
      case 'timeout':
        void this.callN8n(this.getN8nUrl('N8N_TIMEOUT_URL'), payload);
        break;
      default:
        break;
    }
  }

  async handleTrigger(
    sessionId: string,
    payload: TriggerPayload,
  ): Promise<void> {
    const session = this.getOrCreateSession(sessionId);
    const { actor, stream } = session;
    let type: string | undefined = payload.type; // Explicitly extract type
    const remainingPayload = { ...payload }; // Create a copy of payload

    // Infer type from message content if missing
    if (!type && remainingPayload.message) {
      if (
        typeof remainingPayload.message === 'string' &&
        remainingPayload.message.startsWith('__') &&
        remainingPayload.message.endsWith('__')
      ) {
        type = remainingPayload.message;
      } else {
        type = 'USER_MESSAGE';
      }
    }

    if (
      type &&
      typeof type === 'string' &&
      type.trim().toLowerCase() === '__endchat__'
    ) {
      type = 'END_CMD';
    }

    this.logger.log(`Received trigger for ${sessionId}: ${type}`);

    if (type === 'SURVEY_SUBMITTED') {
      const url = this.getN8nUrl('N8N_ANALYTICS_URL');
      if (url) {
        void this.callN8n(url, { sessionId, ...remainingPayload });
      }
      actor.send({ type: 'SURVEY_SUBMITTED', data: remainingPayload });
      return;
    }

    // Forward event to state machine
    if (type) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      actor.send({ type, ...remainingPayload } as any);
    }

    if (type === 'USER_MESSAGE') {
      const currentState = actor.getSnapshot().value;
      let url = '';

      if (currentState === 'live_agent_active') {
        url = this.getN8nUrl('N8N_LIVE_AGENT_ACTIVE_URL');
      } else {
        url = this.getN8nUrl('N8N_LLM_URL');
      }

      if (url) {
        const timeoutMs = 15000;
        let timedOut = false;
        const timeoutId = setTimeout(() => {
          timedOut = true;
          stream.next({
            type: 'bot_message',
            data: {
              plainText:
                "Sorry, I'm taking a bit longer than expected. Please try again.",
              messageId: randomUUID(),
            },
          });
        }, timeoutMs);

        try {
          const n8nPayload: N8nPayload = {
            sessionId,
            message: remainingPayload.message as string,
            ...remainingPayload,
          };
          const response: BotMessageData | null = await this.callN8n(
            url,
            n8nPayload,
          );
          if (timedOut) return;
          clearTimeout(timeoutId);

          const messageId = response?.messageId || randomUUID();
          const finalResponse: BotMessageData = { ...response, messageId };

          stream.next({ type: 'bot_message', data: finalResponse });

          if (response && response.escalate) {
            actor.send({ type: 'ESCALATION_TRIGGER' });
          }
        } catch (error) {
          this.logger.error(
            `Error handling USER_MESSAGE with N8N: ${(error as Error).message}`,
          );
          if (timedOut) return;
          clearTimeout(timeoutId);
          stream.next({
            type: 'bot_message',
            data: {
              plainText:
                "I'm sorry, an error occurred while processing your request. Please try again later.",
              messageId: randomUUID(),
            },
          });
        }
      }
    } else if (type === '__greeting__') {
      const url = this.getN8nUrl('N8N_GREETING_URL');
      if (url) {
        try {
          const response: BotMessageData | null = await this.callN8n(url, {
            sessionId,
          });
          const messageId = response?.messageId || randomUUID();
          const finalResponse: BotMessageData = { ...response, messageId };
          stream.next({ type: 'bot_message', data: finalResponse });
        } catch (error) {
          this.logger.error(
            `Error handling __greeting__ with N8n: ${(error as Error).message}`,
          );
        }
      }
    } else if (type === 'END_CMD') {
      const url = this.getN8nUrl('N8N_END_CHAT_URL');
      if (url) {
        try {
          const response: BotMessageData | null = await this.callN8n(url, {
            sessionId,
          });
          const messageId = response?.messageId || randomUUID();
          const finalResponse: BotMessageData = {
            ...(response || {}),
            messageId,
            meta: {
              ...(response?.meta || {}),
              chatEnded: true,
            },
          };
          stream.next({ type: 'bot_message', data: finalResponse });
        } catch (error) {
          this.logger.error(
            `Error handling END_CMD with N8n: ${(error as Error).message}`,
          );
        }
      }
    }
  }

  private async callN8n(
    url: string,
    payload: N8nPayload,
  ): Promise<BotMessageData | null> {
    try {
      this.logger.log(`Calling N8N: ${url}`);
      const response = await firstValueFrom(
        this.httpService.post<BotMessageData>(url, payload), // Specify response type
      );
      return response.data;
    } catch (error) {
      this.logger.error(`Error calling N8N: ${(error as Error).message}`);
      return null;
    }
  }

  injectMessage(sessionId: string, message: BotMessageData): void {
    const session = this.getOrCreateSession(sessionId);
    const { stream } = session;
    const messageId = message?.messageId || randomUUID();
    stream.next({
      type: 'bot_message',
      data: { ...message, messageId } as BotMessageData,
    });
  }

  getSessionStream(sessionId: string): Observable<MessageEvent> {
    // Ensure session exists
    if (!this.sessions.has(sessionId)) {
      this.getOrCreateSession(sessionId);
    }
    return this.sessions
      .get(sessionId)!
      .stream.asObservable()
      .pipe(
        map(
          (
            event:
              | StateUpdateData
              | { type: 'bot_message'; data: BotMessageData },
          ) => {
            // Handle State Updates
            if (event.type === 'state_update') {
              return {
                type: 'state',
                data: {
                  type: 'state_update',
                  status: event.state,
                  meta: {},
                  params: event.context as object,
                },
              } as MessageEvent;
            }

            // Handle Bot Messages
            if (event.type === 'bot_message') {
              const messageData: BotMessageData = event.data || {};
              const mappedData: BotMessageData = {
                participant: 'bot',
                ...messageData,
              };

              // robustly map to plainText if missing
              if (!mappedData.plainText) {
                mappedData.plainText =
                  mappedData.text ||
                  mappedData.content ||
                  mappedData.output ||
                  mappedData.response ||
                  mappedData.message;
              }

              // Ensure we have a string
              if (
                typeof mappedData.plainText !== 'string' &&
                mappedData.plainText !== undefined &&
                mappedData.plainText !== null
              ) {
                if (typeof mappedData.plainText === 'object') {
                  try {
                    mappedData.plainText = JSON.stringify(
                      mappedData.plainText as unknown,
                    );
                  } catch {
                    // Changed 'catch (e)' to 'catch' as 'e' was unused
                    mappedData.plainText = String(mappedData.plainText);
                  }
                } else {
                  mappedData.plainText = String(mappedData.plainText);
                }
              }

              return {
                data: mappedData,
              } as MessageEvent;
            }

            // Fallback - should ideally not be reached if all types are handled
            return { data: event } as MessageEvent;
          },
        ),
      );
  }
}
