import { Injectable, Logger, MessageEvent } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { createActor, ActorRefFrom } from 'xstate';
import { sessionMachine } from './machines/session.machine';
import { Observable, ReplaySubject, firstValueFrom } from 'rxjs';
import { map } from 'rxjs/operators';
import { randomUUID } from 'crypto';

@Injectable()
export class AppService {
  private readonly logger = new Logger(AppService.name);
  private sessions = new Map<
    string,
    { actor: ActorRefFrom<typeof sessionMachine>; stream: ReplaySubject<any> }
  >();

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

  getOrCreateSession(sessionId: string) {
    if (this.sessions.has(sessionId)) {
      return this.sessions.get(sessionId)!;
    }

    const stream = new ReplaySubject<any>(10);
    const actor = createActor(sessionMachine);

    actor.subscribe((snapshot) => {
      this.logger.log(`Session ${sessionId} state: ${snapshot.value}`);

      // Emit state update to frontend
      stream.next({
        type: 'state_update',
        state: snapshot.value,
        context: snapshot.context,
      });

      // Handle N8N calls based on state
      this.handleStateSideEffects(
        sessionId,
        snapshot.value as string,
        snapshot.context,
      );
    });

    actor.start();
    this.sessions.set(sessionId, { actor, stream });
    return { actor, stream };
  }

  private async handleStateSideEffects(
    sessionId: string,
    state: string,
    context: any,
  ) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    const { actor } = session;
    const payload = { sessionId, context };

    switch (state) {
      case 'live_agent_queue':
        this.callN8n(this.getN8nUrl('N8N_LIVE_AGENT_QUEUE_URL'), payload);
        break;
      case 'email_transcript_processing':
        this.callN8n(this.getN8nUrl('N8N_TRANSCRIPT_URL'), payload)
          .then(() => actor.send({ type: 'SUCCESS' }))
          .catch(() => actor.send({ type: 'FAILURE' }));
        break;
      case 'timeout':
        this.callN8n(this.getN8nUrl('N8N_TIMEOUT_URL'), payload);
        break;
      default:
        break;
    }
  }

  async handleTrigger(sessionId: string, payload: any) {
    const session = this.getOrCreateSession(sessionId);
    if (!session) return;

    const { actor, stream } = session;
    let { type, ...data } = payload;

    // Infer type from message content if missing
    if (!type && data.message) {
        if (data.message.startsWith('__') && data.message.endsWith('__')) {
             type = data.message;
        } else {
             type = 'USER_MESSAGE';
        }
    }

    if (type && typeof type === 'string' && type.trim().toLowerCase() === '__endchat__') {
        type = 'END_CMD';
    }

    this.logger.log(`Received trigger for ${sessionId}: ${type}`);

    if (type === 'SURVEY_SUBMITTED') {
      const url = this.getN8nUrl('N8N_ANALYTICS_URL');
      if (url) {
        await this.callN8n(url, { sessionId, ...data });
      }
      // @ts-ignore
      actor.send({ type, ...data });
      return;
    }

    // Forward event to state machine
    if (type) {
      // @ts-ignore - dynamic event dispatch
      actor.send({ type, ...data });
    }

    if (type === 'USER_MESSAGE') {
      const currentState = actor.getSnapshot().value;
      let url = '';

      if (currentState === 'live_agent_active') {
        url = this.getN8nUrl('N8N_LIVE_AGENT_ACTIVE_URL');
      } else {
        // Default to LLM for idle or bot_active
        url = this.getN8nUrl('N8N_LLM_URL');
      }

      if (url) {
        // Timeout logic: Send a message if N8N takes too long
        const timeoutMs = 15000;
        let timedOut = false;
        const timeoutId = setTimeout(() => {
          timedOut = true;
          stream.next({
            type: 'bot_message',
            data: {
              plainText:
                "Sorry, I'm taking a bit longer than expected. Please try again.",
              messageId: randomUUID()
            },
          });
        }, timeoutMs);

        this.callN8n(url, { sessionId, message: data.message, ...data }).then(
          (response) => {
            if (timedOut) return;
            clearTimeout(timeoutId);

            const messageId = response?.messageId || randomUUID();
            const finalResponse = { ...response, messageId };

            // Emit response to stream
            stream.next({ type: 'bot_message', data: finalResponse });

            // Check for escalation in response if handled by N8N
            if (response && response.escalate) {
              actor.send({ type: 'ESCALATION_TRIGGER' });
            }
          },
        );
      }
    } else if (type === '__greeting__') {
      const url = this.getN8nUrl('N8N_GREETING_URL');
      if (url) {
        this.callN8n(url, { sessionId }).then((response) => {
          const messageId = response?.messageId || randomUUID();
          const finalResponse = { ...response, messageId };
          stream.next({ type: 'bot_message', data: finalResponse });
        });
      }
    } else if (type === 'END_CMD') {
         const url = this.getN8nUrl('N8N_END_CHAT_URL');
         if (url) {
             this.callN8n(url, { sessionId }).then(response => {
                 const messageId = response?.messageId || randomUUID();
                 const finalResponse = {
                     ...(response || {}),
                     messageId,
                     meta: {
                         ...(response?.meta || {}),
                         chatEnded: true
                     }
                 };
                 stream.next({ type: 'bot_message', data: finalResponse });
             });
         }
    }
  }

  private async callN8n(url: string, payload: any) {
    try {
      this.logger.log(`Calling N8N: ${url}`);
      const response = await firstValueFrom(
        this.httpService.post(url, payload),
      );
      return response.data;
    } catch (error) {
      this.logger.error(`Error calling N8N: ${error.message}`);
      // Handle error, maybe send FAILURE event to machine?
      return null;
    }
  }

  injectMessage(sessionId: string, message: any) {
    const session = this.getOrCreateSession(sessionId);
    // session is guaranteed to be defined now, but let's be safe if I change getOrCreateSession later
    if (session) {
        const { stream } = session;
        const messageId = message?.messageId || randomUUID();
        stream.next({
            type: 'bot_message',
            data: { ...message, messageId }
        });
    }
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
        map((event) => {
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
                const messageData = event.data || {};
                const mappedData = {
                    participant: 'bot',
                    ...messageData
                };

                // robustly map to plainText if missing
                if (!mappedData.plainText) {
                    mappedData.plainText = mappedData.text || mappedData.content || mappedData.output || mappedData.response || mappedData.message;
                }
                
                // Ensure we have a string
                if (typeof mappedData.plainText !== 'string' && mappedData.plainText) {
                    if (typeof mappedData.plainText === 'object') {
                        try {
                            mappedData.plainText = JSON.stringify(mappedData.plainText);
                        } catch (e) {
                            mappedData.plainText = String(mappedData.plainText);
                        }
                    } else {
                        mappedData.plainText = String(mappedData.plainText);
                    }
                }

                return {
                    data: mappedData
                } as MessageEvent;
            }

          // Fallback
          return { data: event } as MessageEvent;
        }),
      );
  }
}
