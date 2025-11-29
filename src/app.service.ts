import { Injectable, Logger, MessageEvent } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { createActor, ActorRefFrom, fromPromise } from 'xstate';
import {
  sessionMachine,
  ChatContext,
  ChatMessage,
} from './machines/session.machine';
import { Observable, ReplaySubject, firstValueFrom } from 'rxjs';
import { map } from 'rxjs/operators';
import { randomUUID } from 'crypto';

// Define interfaces for better type safety (matching frontend expectations)
interface BotMessageData {
  plainText?: string;
  text?: string;
  content?: string;
  output?: string;
  response?: string;
  message?: string;
  messageId?: string;
  participant?: string;
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
  context: ChatContext;
}

type StreamEvent =
  | StateUpdateData
  | { type: 'bot_message'; data: BotMessageData };

interface SessionInfo {
  actor: ActorRefFrom<typeof sessionMachine>;
  stream: ReplaySubject<StreamEvent>;
  lastMessageCount: number;
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
    this.logger.log(`getOrCreateSession called with sessionId: '${sessionId}'`);
    if (this.sessions.has(sessionId)) {
      return this.sessions.get(sessionId)!;
    }

    const stream = new ReplaySubject<StreamEvent>(10);

    // Provide implementations for the machine's actors
    const machineWithActors = sessionMachine.provide({
      actors: {
        sendToDialogflow: fromPromise(
          async ({
            input,
          }: {
            input: { message: string; sessionId: string };
          }) => {
            this.logger.log(`sendToDialogflow actor input: ${JSON.stringify(input)}`);
            const url = this.getN8nUrl('N8N_LLM_URL');

            // Timeout logic: Send a message if N8N takes too long (side effect)
            const timeoutMs = 15000;
            const timeoutId = setTimeout(() => {
              stream.next({
                type: 'bot_message',
                data: {
                  plainText:
                    "Sorry, I'm taking a bit longer than expected. Please try again.",
                  messageId: randomUUID(),
                  participant: 'bot',
                },
              });
            }, timeoutMs);

            try {
              const response = await this.callN8n(url, {
                sessionId: input.sessionId,
                message: input.message,
              });
              clearTimeout(timeoutId);
              
              this.logger.log(`N8N Response: ${JSON.stringify(response)}`);

              return {
                content:
                  response?.plainText ||
                  response?.text ||
                  response?.message ||
                  '',
                metadata: {
                  liveAgentRequested: response?.escalate ?? false,
                  startSurvey: response?.meta?.chatEnded ?? false,
                },
              };
            } catch (error) {
              clearTimeout(timeoutId);
              throw error;
            }
          },
        ),
        connectToLiveAgent: fromPromise(
          async ({ input }: { input: { sessionId: string } }) => {
            await this.callN8n(this.getN8nUrl('N8N_LIVE_AGENT_QUEUE_URL'), {
              sessionId: input.sessionId,
            });
          },
        ),
        sendToLiveAgent: fromPromise(
          async ({
            input,
          }: {
            input: { message: string; agentId: string };
          }) => {
            await this.callN8n(this.getN8nUrl('N8N_LIVE_AGENT_ACTIVE_URL'), {
              sessionId: input.agentId, // Assuming agentId is used as sessionId for live agent active call, or modify as needed
              message: input.message,
            });
          },
        ),
      },
    });

    // Pass sessionId as input to initialize machine context
    const actor = createActor(machineWithActors, {
        input: { sessionId }
    });

    const sessionInfo: SessionInfo = { actor, stream, lastMessageCount: 0 };
    this.sessions.set(sessionId, sessionInfo);

    actor.subscribe((snapshot) => {
      this.logger.log(`
        Session ${sessionId} state: ${JSON.stringify(snapshot.value)} context: ${JSON.stringify(snapshot.context)}`);

      // Detect new messages and emit to stream
      const msgs = snapshot.context.messages || [];
      if (msgs.length > sessionInfo.lastMessageCount) {
        const newMsgs = msgs.slice(sessionInfo.lastMessageCount);
        newMsgs.forEach((msg: ChatMessage) => {
          // Only emit bot or agent messages to the frontend stream (echoing user messages is handled by frontend usually, but consistent stream is good)
          if (msg.role !== 'user') {
            stream.next({
              type: 'bot_message',
              data: {
                plainText: msg.content,
                messageId: randomUUID(),
                participant: msg.role,
              },
            });
          }
        });
        sessionInfo.lastMessageCount = msgs.length;
      }

      // Emit state update to frontend
      stream.next({
        type: 'state_update',
        state: snapshot.value as unknown as string,
        context: snapshot.context,
      });
    });

    actor.start();
    return sessionInfo;
  }

  async handleTrigger(
    sessionId: string,
    payload: TriggerPayload,
  ): Promise<void> {
    const session = this.getOrCreateSession(sessionId);
    const { actor, stream } = session;
    let type: string | undefined = payload.type;
    const remainingPayload = { ...payload };

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
      type = 'END_CMD'; // Maps to 'USER_ENDED_CHAT' or 'END_CMD' based on machine def
    }

    this.logger.log(`Received trigger for ${sessionId}: ${type}`);

    // Handle Survey
    if (type === 'SURVEY_SUBMITTED') {
      // Call analytics as side effect (or move to machine actor)
      const url = this.getN8nUrl('N8N_ANALYTICS_URL');
      if (url) {
        void this.callN8n(url, { sessionId, ...remainingPayload });
      }
      actor.send({ type: 'SUBMIT_SURVEY', data: remainingPayload });
      return;
    }

    // Handle Greeting (Special case, not in machine events explicitly?)
    // If machine is in idle, we might just trigger it manually or send USER_MESSAGE
    if (type === '__greeting__') {
      const url = this.getN8nUrl('N8N_GREETING_URL');
      if (url) {
        try {
          const response = await this.callN8n(url, { sessionId });
          // Emit directly to stream as this might be pre-session
          stream.next({
            type: 'bot_message',
            data: {
              plainText: response?.plainText || response?.text || '',
              messageId: randomUUID(),
              participant: 'bot',
            },
          });
        } catch (error) {
          this.logger.error(`
            Error handling greeting: ${(error as Error).message}`);
        }
      }
      return;
    }

    // Map to Machine Events
    if (type === 'USER_MESSAGE') {
      actor.send({
        type: 'USER_MESSAGE',
        content: remainingPayload.message as string,
      });
    } else if (type === 'END_CMD' || type === 'USER_ENDED_CHAT') {
      const url = this.getN8nUrl('N8N_END_CHAT_URL');
      if (url) {
        try {
          const response = await this.callN8n(url, { sessionId });
          // Emit response if needed
          if (response) {
             stream.next({
                type: 'bot_message',
                data: {
                    plainText: response?.plainText || response?.text || '',
                    messageId: randomUUID(),
                    participant: 'bot',
                    meta: { chatEnded: true }
                }
             });
          }
        } catch (error) {
          this.logger.error(`Error calling END_CHAT n8n: ${(error as Error).message}`);
        }
      }
      actor.send({ type: 'USER_ENDED_CHAT' });
    } else {
      // Fallback for other events if they match
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      actor.send({ type: type as any, ...remainingPayload } as any);
    }
  }

  private async callN8n(
    url: string,
    payload: N8nPayload,
  ): Promise<BotMessageData | null> {
    try {
      this.logger.log(`Calling N8N: ${url}`);
      const response = await firstValueFrom(
        this.httpService.post<BotMessageData>(url, payload),
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
        map((event: StreamEvent) => {
          // Handle State Updates
          if (event.type === 'state_update') {
            return {
              type: 'state',
              data: {
                type: 'state_update',
                status: event.state,
                meta: {},
                params: event.context,
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

          return { data: event } as MessageEvent;
        }),
      );
  }
}