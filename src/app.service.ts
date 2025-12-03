import { Injectable, MessageEvent, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { createActor, Actor, fromPromise } from 'xstate';
import { sessionMachine } from './machines/session.machine';
import { Subject, Observable, firstValueFrom, timeout } from 'rxjs';

interface Meta {
  startSurvey?: boolean;
  liveAgentRequested?: boolean;
  emailRequested?: boolean;
  chatEnded?: boolean;
  [key: string]: any;
}

interface N8nMessage {
  plainText?: string;
  content?: string;
  text?: string;
  richContent?: any[];
  meta?: Meta;
  metadata?: Meta;
  type?: string;
  title?: string;
  buttons?: any[];
  sent?: boolean;
  valid?: boolean;
  message?: string;
  email?: string;
}

interface N8nResponse {
  success: boolean;
  data?: N8nMessage[] | N8nMessage;
  error?: string;
}

interface InjectMessagePayload {
  type?: string;
  content?: string;
  plainText?: string;
  richContent?: any[];
  meta?: Meta;
  metadata?: Meta;
  title?: string;
  buttons?: any[];
}

@Injectable()
export class AppService {
  private readonly logger = new Logger(AppService.name);
  private sessions = new Map<string, Actor<typeof sessionMachine>>();
  private streams = new Map<string, Subject<MessageEvent>>();

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  private getN8nUrl(): string {
    return (
      this.configService.get<string>('N8N_WEBHOOK_URL') ||
      'http://localhost:5678/webhook'
    );
  }

  private get n8nErrorMessage(): string {
    return (
      this.configService.get<string>('N8N_ERROR_MESSAGE') ||
      'Sorry, I am having trouble connecting right now.'
    );
  }

  private async safePostToN8n(
    endpoint: string,
    payload: any,
  ): Promise<N8nResponse> {
    const n8nUrl = `${this.getN8nUrl()}/${endpoint}`;
    const timeoutVal = this.configService.get<string>('N8N_TIMEOUT');
    const timeoutMs = timeoutVal ? parseInt(timeoutVal, 10) : 15000;

    try {
      const response = await firstValueFrom(
        this.httpService.post(n8nUrl, payload).pipe(timeout(timeoutMs)),
      );
      return {
        success: true,
        data: response.data as N8nMessage[] | N8nMessage,
      };
    } catch (error) {
      this.logger.error(`Error calling n8n endpoint ${endpoint}:`, error);
      return { success: false, error: this.n8nErrorMessage };
    }
  }

  getSessionStream(sessionId: string): Observable<MessageEvent> {
    if (!this.streams.has(sessionId)) {
      this.streams.set(sessionId, new Subject<MessageEvent>());
    }
    return this.streams.get(sessionId)!.asObservable();
  }

  private getOrCreateSession(
    sessionId: string,
    revive = true,
  ): Actor<typeof sessionMachine> | undefined {
    this.logger.log(
      `getOrCreateSession called for ${sessionId} with revive=${revive}`,
    );
    let actor = this.sessions.get(sessionId);

    if (actor) {
      const snapshot = actor.getSnapshot();
      if (snapshot.status === 'done') {
        if (!revive) {
          this.logger.warn(`Session ${sessionId} is closed and revive=false.`);
          return undefined;
        }
        this.logger.log(
          `Session ${sessionId} is closed. Creating new session.`,
        );
        this.sessions.delete(sessionId);
        actor = undefined;
      }
    }

    if (!actor) {
      if (!revive) {
        return undefined;
      }
      actor = createActor(
        sessionMachine.provide({
          actors: {
            sendToDialogflow: fromPromise(async ({ input }) => {
              const result = await this.safePostToN8n('llm', {
                sessionId: input.sessionId,
                message: input.message,
              });

              if (!result.success) {
                return {
                  content: result.error!,
                  metadata: { chatEnded: true },
                  richContent: [],
                };
              }

              const data = result.data;
              // Assuming n8n returns an array of messages or a single message object
              // We need to normalize it to what the machine expects
              if (Array.isArray(data) && data.length > 0) {
                const firstMsg = data[0];
                return {
                  content: firstMsg.plainText || '',
                  metadata: firstMsg.meta || {},
                  richContent: firstMsg.richContent,
                };
              }
              const msg = data as N8nMessage;
              return {
                content: msg.plainText || msg.content || '',
                metadata: msg.meta || msg.metadata || {},
                richContent: msg.richContent,
              };
            }),
            notifyTimeout: fromPromise(
              async ({ input }: { input: { sessionId: string } }) => {
                this.logger.log(
                  `Calling n8n timeout endpoint for session ${input.sessionId}`,
                );
                const result = await this.safePostToN8n('timeout', {
                  sessionId: input.sessionId,
                });

                if (!result.success) {
                  return {
                    content: result.error!,
                    metadata: { chatEnded: true },
                    richContent: [],
                    type: undefined,
                    title: undefined,
                    buttons: undefined,
                  };
                }

                this.logger.log('n8n timeout call successful');
                const data = result.data;

                if (Array.isArray(data) && data.length > 0) {
                  const firstMsg = data[0];
                  return {
                    content: firstMsg.plainText || '',
                    metadata: firstMsg.meta || {},
                    richContent: firstMsg.richContent || [],
                    type: firstMsg.type,
                    title: firstMsg.title,
                    buttons: firstMsg.buttons,
                  };
                }
                const msg = data as N8nMessage;
                return {
                  content: msg.plainText || msg.content || '',
                  metadata: msg.meta || msg.metadata || {},
                  richContent: msg.richContent || [],
                  type: msg.type,
                  title: msg.title,
                  buttons: msg.buttons,
                };
              },
            ),
            sendToLiveAgent: fromPromise(
              async ({
                input,
              }: {
                input: { message: string; sessionId: string };
              }) => {
                const result = await this.safePostToN8n('live_agent', {
                  sessionId: input.sessionId,
                  message: input.message,
                });

                if (!result.success) {
                  return { success: false, content: result.error || '' };
                }
                return { success: true, content: '' };
              },
            ),
          },
        }),
        {
          input: { sessionId },
        },
      );

      let lastMessageCount = 0;

      actor.subscribe((snapshot) => {
        const stream = this.streams.get(sessionId);
        if (stream) {
          // 1. Send State Update
          stream.next({
            type: 'state',
            data: {
              type: 'state_update',
              status: snapshot.value,
              meta: {},
              params: {},
            },
          } as MessageEvent);

          // 2. Send New Messages
          const messages = snapshot.context.messages;
          this.logger.log(
            `Session ${sessionId} messages: ${messages.length}, last count: ${lastMessageCount}`,
          );
          if (messages.length > lastMessageCount) {
            const newMessages = messages.slice(lastMessageCount);
            newMessages.forEach((msg) => {
              if (msg.role !== 'user') {
                this.logger.log('Sending message to stream: ' + msg.content);
                const frontendMsg = {
                  messageId: msg.id,
                  plainText: msg.content,
                  richContent: msg.richContent,
                  participant: msg.role === 'agent' ? 'agent' : 'bot',
                  timestamp: msg.timestamp,
                  meta: msg.metadata as Meta,
                  type: msg.type,
                  title: msg.title,
                  buttons: msg.buttons,
                };
                stream.next({
                  data: frontendMsg,
                } as MessageEvent);
              }
            });
            lastMessageCount = messages.length;
          }
        }
      });

      actor.start();
      this.sessions.set(sessionId, actor);
    }
    return this.sessions.get(sessionId)!;
  }

  async handleTrigger(sessionId: string, data: Record<string, unknown>) {
    const message = data.message as string;
    let revive = true;

    if (
      typeof message === 'string' &&
      message.startsWith('__') &&
      message.endsWith('__')
    ) {
      const trigger = message.slice(2, -2);
      if (trigger === 'message_received' || trigger === 'reconnect') {
        revive = false;
      }
    }

    const actor = this.getOrCreateSession(sessionId, revive);

    if (!actor) {
      this.logger.warn(
        `Ignoring trigger ${message} for closed session ${sessionId}`,
      );
      return;
    }

    if (
      typeof message === 'string' &&
      message.startsWith('__') &&
      message.endsWith('__')
    ) {
      const trigger = message.slice(2, -2);

      if (trigger === 'message_received' || trigger === 'reconnect') {
        return;
      }

      // Call n8n
      const result = await this.safePostToN8n(trigger, { sessionId, ...data });

      if (!result.success) {
        actor.send({
          type: 'BOT_RESPONSE',
          content: result.error!,
          metadata: { chatEnded: true },
        });
        return;
      }

      this.logger.log(`n8n response for trigger ${trigger}:`, result.data);
      this.mapTriggerToEvent(actor, trigger, result.data, data);
    } else {
      // Normal message
      actor.send({ type: 'USER_MESSAGE', content: message });
    }
  }

  private mapTriggerToEvent(
    actor: Actor<typeof sessionMachine>,
    trigger: string,
    n8nData: N8nMessage | N8nMessage[] | undefined,
    inputData: Record<string, any>,
  ) {
    this.logger.log(
      `Mapping trigger ${trigger} to event. n8nData: ${JSON.stringify(n8nData)}`,
    );

    let messageSent = false;
    // Handle generic messages in response
    if (Array.isArray(n8nData)) {
      n8nData.forEach((msg: N8nMessage) => {
        if (msg.sent) {
          this.logger.log(
            'Message already sent via injectMessage, skipping in mapTriggerToEvent',
          );
          return;
        }

        if (msg.type === 'text' && msg.plainText) {
          this.logger.log('Sending BOT_RESPONSE: ' + msg.plainText);
          actor.send({
            type: 'BOT_RESPONSE',
            content: msg.plainText,
            richContent: msg.richContent,
            metadata: msg.meta,
          });
          messageSent = true;
        } else if (msg.type === 'splash') {
          this.logger.log(
            'Sending SPLASH BOT_RESPONSE: ' + (msg.plainText || msg.text),
          );
          actor.send({
            type: 'BOT_RESPONSE',
            content: msg.plainText || msg.text || '',
            richContent: msg.richContent,
            metadata: msg.meta,
            messageType: 'splash',
            title: msg.title,
            buttons: msg.buttons,
          });
          messageSent = true;
        }
      });
    }

    switch (trigger) {
      case 'email_transcript':
        if (!messageSent) actor.send({ type: 'EMAIL_TRANSCRIPT_REQUESTED' });
        break;
      case 'email_received': {
        const msg = Array.isArray(n8nData) ? n8nData[0] : n8nData;
        // Check validation from n8n response
        if (msg?.valid === false) {
          actor.send({
            type: 'EMAIL_INVALID',
            message: msg.message || 'Please enter a valid email address',
          });
        } else {
          // Try to find email in n8n response or input data
          // If the frontend sent the email as 'payload' or 'email' in the trigger request
          const email = (msg?.email ||
            inputData?.email ||
            inputData?.payload) as string;
          actor.send({ type: 'EMAIL_VALIDATED', email: email || '' });
        }
        break;
      }

      case 'endchat': {
        // Check if any message requested a state change that should prevent immediate closing
        let preventClose = false;
        if (Array.isArray(n8nData)) {
          preventClose = n8nData.some(
            (msg: N8nMessage) =>
              msg.meta?.startSurvey ||
              msg.metadata?.startSurvey ||
              msg.meta?.liveAgentRequested ||
              msg.metadata?.liveAgentRequested ||
              msg.meta?.emailRequested ||
              msg.metadata?.emailRequested,
          );
        } else if (n8nData) {
          const msg = n8nData;
          preventClose = !!(
            msg.meta?.startSurvey ||
            msg.metadata?.startSurvey ||
            msg.meta?.liveAgentRequested ||
            msg.metadata?.liveAgentRequested ||
            msg.meta?.emailRequested ||
            msg.metadata?.emailRequested
          );
        }

        if (!preventClose) {
          actor.send({ type: 'USER_ENDED_CHAT' });
        }
        break;
      }

      case 'live_agent':
      case 'live_agent_requested':
        if (!messageSent) actor.send({ type: 'LIVE_AGENT_REQUESTED' });
        break;

      case 'start_survey':
        break;

      default:
        this.logger.warn(`Unknown trigger: ${trigger}`);
    }
  }

  injectMessage(sessionId: string, message: InjectMessagePayload) {
    this.logger.log(`injectMessage called for ${sessionId}`);
    const actor = this.getOrCreateSession(sessionId);
    if (!actor) {
      this.logger.warn(
        `Ignoring injected message for closed/missing session ${sessionId}`,
      );
      return;
    }

    if (message.type === 'agent_message') {
      actor.send({ type: 'AGENT_MESSAGE', content: message.content! });
    } else {
      actor.send({
        type: 'BOT_RESPONSE',
        content: message.plainText || message.content || '',
        richContent: message.richContent,
        metadata: message.meta || message.metadata,
        messageType: message.type,
        title: message.title,
        buttons: message.buttons,
      });
    }
  }
}
