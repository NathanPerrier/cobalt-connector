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
    return this.configService.get<string>('N8N_WEBHOOK_URL') || 'http://localhost:5678/webhook';
  }

  getSessionStream(sessionId: string): Observable<MessageEvent> {
    if (!this.streams.has(sessionId)) {
      this.streams.set(sessionId, new Subject<MessageEvent>());
    }
    return this.streams.get(sessionId)!.asObservable();
  }

  private getOrCreateSession(sessionId: string): Actor<typeof sessionMachine> {
    if (!this.sessions.has(sessionId)) {
      const actor = createActor(
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
                        richContent: firstMsg.richContent
                    };
                }
                return {
                    content: data.plainText || data.content || '',
                    metadata: data.meta || data.metadata || {},
                    richContent: data.richContent
                };
              } catch (error) {
                this.logger.error('Error calling n8n LLM:', error);
                throw error;
              }
            }),
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
              params: {}
            }
          } as MessageEvent);

          // 2. Send New Messages
          const messages = snapshot.context.messages;
          this.logger.log(`Session ${sessionId} messages: ${messages.length}, last count: ${lastMessageCount}`);
          if (messages.length > lastMessageCount) {
            const newMessages = messages.slice(lastMessageCount);
            newMessages.forEach(msg => {
              if (msg.role !== 'user') {
                this.logger.log('Sending message to stream: ' + msg.content);
                const frontendMsg = {
                  messageId: msg.id,
                  plainText: msg.content,
                  richContent: msg.richContent,
                  participant: msg.role === 'agent' ? 'agent' : 'bot',
                  timestamp: msg.timestamp,
                  meta: msg.metadata,
                };
                stream.next({
                  data: frontendMsg
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

    if (typeof message === 'string' && message.startsWith('__') && message.endsWith('__')) {
      const trigger = message.slice(2, -2);

      if (trigger === 'message_received' || trigger === 'reconnect') {
        return;
      }

      // Call n8n
      const n8nUrl = `${this.getN8nUrl()}/${trigger}`;
      try {
        const response = await firstValueFrom(
            this.httpService.post(n8nUrl, { sessionId, ...data })
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

  private mapTriggerToEvent(actor: Actor<typeof sessionMachine>, trigger: string, n8nData: any, inputData: any) {
    this.logger.log(`Mapping trigger ${trigger} to event. n8nData: ${JSON.stringify(n8nData)}`);
    
    let messageSent = false;
    // Handle generic messages in response
    if (Array.isArray(n8nData)) {
      n8nData.forEach((msg) => {
        if (msg.type === 'text' && msg.plainText) {
          this.logger.log('Sending BOT_RESPONSE: ' + msg.plainText);
          actor.send({
            type: 'BOT_RESPONSE',
            content: msg.plainText,
            richContent: msg.richContent,
            metadata: msg.meta,
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
             actor.send({ type: 'EMAIL_INVALID', message: n8nData.message || 'Please enter a valid email address' });
         } else {
             // Try to find email in n8n response or input data
             // If the frontend sent the email as 'payload' or 'email' in the trigger request
             const email = n8nData?.email || inputData?.email || inputData?.payload;
             actor.send({ type: 'EMAIL_VALIDATED', email: email || '' });
         }
         break;
      
      case 'endchat':
        if (!messageSent) actor.send({ type: 'USER_ENDED_CHAT' });
        // If message was sent (e.g. "Goodbye"), we might still want to end the chat?
        // But the message metadata might have 'chatEnded': true which the frontend handles?
        // Or the machine state 'closed' handles it?
        // If we send USER_ENDED_CHAT, it goes to 'closed'.
        // If we sent BOT_RESPONSE with startSurvey, it goes to 'survey'.
        // If we want to end chat AFTER survey, we shouldn't send USER_ENDED_CHAT yet.
        // If n8n response has startSurvey: true, we should probably NOT send USER_ENDED_CHAT immediately if we want the user to see the survey.
        // But if the trigger is 'endchat', it implies ending.
        
        // Let's rely on metadata if message was sent.
        if (messageSent) {
             // Check if we should force close or if the message metadata handles the flow
             // If n8nData has 'chatEnded': true in meta, frontend might handle it.
             // But backend state needs to update.
             // If message transitioned to 'survey', we are good.
             // If message transitioned to 'closed' (not possible via BOT_RESPONSE usually), we are good.
             
             // If we send USER_ENDED_CHAT now, it might preempt the survey state if not careful.
             // In 'survey' state, USER_ENDED_CHAT -> 'closed'.
             // So if we send BOT_RESPONSE (-> survey) then USER_ENDED_CHAT (-> closed), we skip survey?
             // Yes.
             
             // So for endchat, if we sent a message (likely containing survey prompt), we should NOT send USER_ENDED_CHAT automatically.
        } else {
            actor.send({ type: 'USER_ENDED_CHAT' });
        }
        break;
        
      case 'live_agent':
        if (!messageSent) actor.send({ type: 'LIVE_AGENT_REQUESTED' });
        break;

      default:
        this.logger.warn(`Unknown trigger: ${trigger}`);
    }
  }

  injectMessage(sessionId: string, message: any) {
     const actor = this.getOrCreateSession(sessionId);
     if (message.type === 'agent_message') {
         actor.send({ type: 'AGENT_MESSAGE', content: message.content });
     } else if (message.type === 'bot_response') {
         actor.send({ type: 'BOT_RESPONSE', content: message.content, metadata: message.metadata });
     }
  }
}
