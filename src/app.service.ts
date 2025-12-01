import { Injectable, MessageEvent, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { createActor, Actor, fromPromise } from 'xstate';
import { sessionMachine } from './machines/session.machine';
import { Subject, Observable, firstValueFrom } from 'rxjs';

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

  getSessionStream(sessionId: string): Observable<MessageEvent> {
    if (!this.streams.has(sessionId)) {
      this.streams.set(sessionId, new Subject<MessageEvent>());
    }
    return this.streams.get(sessionId)!.asObservable();
  }

  private getOrCreateSession(sessionId: string): Actor<typeof sessionMachine> {
    let actor = this.sessions.get(sessionId);

    if (actor) {
      const snapshot = actor.getSnapshot();
      if (snapshot.status === 'done') {
        this.logger.log(`Session ${sessionId} is closed. Creating new session.`);
        this.sessions.delete(sessionId);
        actor = undefined;
      }
    }

    if (!actor) {
      actor = createActor(
        sessionMachine.provide({
          actors: {
            sendToDialogflow: fromPromise(async ({ input }) => {
              const n8nUrl = `${this.getN8nUrl()}/llm`;
              try {
                const response = await firstValueFrom(
                  this.httpService.post(n8nUrl, {
                    sessionId: input.sessionId,
                    message: input.message,
                  }),
                );
                const data = response.data;
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
                return {
                  content: data.plainText || data.content || '',
                  metadata: data.meta || data.metadata || {},
                  richContent: data.richContent,
                };
              } catch (error) {
                this.logger.error('Error calling n8n LLM:', error);
                throw error;
              }
            }),
            notifyTimeout: fromPromise(
              async ({ input }: { input: { sessionId: string } }) => {
                const n8nUrl = `${this.getN8nUrl()}/timeout`;
                this.logger.log(
                  `Calling n8n timeout endpoint: ${n8nUrl} for session ${input.sessionId}`,
                );
                try {
                  const response = await firstValueFrom(
                    this.httpService.post(n8nUrl, {
                      sessionId: input.sessionId,
                    }),
                  );
                  this.logger.log('n8n timeout call successful');

                  const data = response.data;
                  if (Array.isArray(data) && data.length > 0) {
                    const firstMsg = data[0];
                    return {
                      content: firstMsg.plainText || '',
                      metadata: firstMsg.meta || {},
                      richContent: firstMsg.richContent,
                      type: firstMsg.type,
                      title: firstMsg.title,
                      buttons: firstMsg.buttons,
                    };
                  }
                  return {
                    content: data.plainText || data.content || '',
                    metadata: data.meta || data.metadata || {},
                    richContent: data.richContent,
                    type: data.type,
                    title: data.title,
                    buttons: data.buttons,
                  };
                } catch (error) {
                  this.logger.error('Error calling n8n timeout:', error);
                  throw error;
                }
              },
            ),
            sendToLiveAgent: fromPromise(
              async ({
                input,
              }: {
                input: { message: string; sessionId: string };
              }) => {
                const n8nUrl = `${this.getN8nUrl()}/live_agent`;
                try {
                  await firstValueFrom(
                    this.httpService.post(n8nUrl, {
                      sessionId: input.sessionId,
                      message: input.message,
                    }),
                  );
                } catch (error) {
                  this.logger.error('Error calling n8n live agent:', error);
                  // We don't throw here to avoid crashing the actor, or maybe we should?
                  // If we throw, it might trigger onError in the machine.
                  throw error;
                }
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
                  meta: msg.metadata,
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
    const actor = this.getOrCreateSession(sessionId);
    const message = data.message as string;

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
      const n8nUrl = `${this.getN8nUrl()}/${trigger}`;
      try {
        const response = await firstValueFrom(
          this.httpService.post(n8nUrl, { sessionId, ...data }),
        );
        this.logger.log(`n8n response for trigger ${trigger}:`, response.data);

        this.mapTriggerToEvent(actor, trigger, response.data, data);
      } catch (error) {
        this.logger.error(`Error calling n8n for trigger ${trigger}:`, error);
      }
    } else {
      // Normal message
      actor.send({ type: 'USER_MESSAGE', content: message });
    }
  }

  private mapTriggerToEvent(
    actor: Actor<typeof sessionMachine>,
    trigger: string,
    n8nData: any,
    inputData: any,
  ) {
    this.logger.log(
      `Mapping trigger ${trigger} to event. n8nData: ${JSON.stringify(n8nData)}`,
    );

    let messageSent = false;
    // Handle generic messages in response
    if (Array.isArray(n8nData)) {
      n8nData.forEach((msg) => {
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
      case 'email_received':
        // Check validation from n8n response
        if (n8nData?.valid === false) {
          actor.send({
            type: 'EMAIL_INVALID',
            message: n8nData.message || 'Please enter a valid email address',
          });
        } else {
          // Try to find email in n8n response or input data
          // If the frontend sent the email as 'payload' or 'email' in the trigger request
          const email =
            n8nData?.email || inputData?.email || inputData?.payload;
          actor.send({ type: 'EMAIL_VALIDATED', email: email || '' });
        }
        break;

      case 'endchat':
        // Check if any message requested a state change that should prevent immediate closing
        let preventClose = false;
        if (Array.isArray(n8nData)) {
          preventClose = n8nData.some(
            (msg) =>
              msg.meta?.startSurvey ||
              msg.metadata?.startSurvey ||
              msg.meta?.liveAgentRequested ||
              msg.metadata?.liveAgentRequested ||
              msg.meta?.emailRequested ||
              msg.metadata?.emailRequested,
          );
        } else if (n8nData) {
          preventClose =
            n8nData.meta?.startSurvey ||
            n8nData.metadata?.startSurvey ||
            n8nData.meta?.liveAgentRequested ||
            n8nData.metadata?.liveAgentRequested ||
            n8nData.meta?.emailRequested ||
            n8nData.metadata?.emailRequested;
        }

        if (!preventClose) {
          actor.send({ type: 'USER_ENDED_CHAT' });
        }
        break;

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

  injectMessage(sessionId: string, message: any) {
    const actor = this.getOrCreateSession(sessionId);
    if (message.type === 'agent_message') {
      actor.send({ type: 'AGENT_MESSAGE', content: message.content });
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
