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
  richContent?: any[];
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

// Define a mapping for special triggers
const specialTriggerMap = {
  // Maps to 'USER_ENDED_CHAT' in machine
  '__endchat__': {
    n8nUrlKey: 'N8N_END_CHAT_URL',
    machineEvent: 'USER_ENDED_CHAT',
    meta: { chatEnded: true },
  },
  // Maps to email transcript request
  '__email_transcript__': {
    n8nUrlKey: 'N8N_TRANSCRIPT_URL',
    meta: { emailSent: true }, // Assuming successful call means sent
  },
  // Handle greeting separately for direct stream emit
  '__greeting__': {
    n8nUrlKey: 'N8N_GREETING_URL',
  },
  // Handle survey submission, machine event is SUBMIT_SURVEY
  'SURVEY_SUBMITTED': {
    n8nUrlKey: 'N8N_ANALYTICS_URL', // N8N endpoint for analytics
    machineEvent: 'SUBMIT_SURVEY',
  },
};

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
    this.logger.debug(`getN8nUrl: key=${key}, resolvedUrl='${url}'`); // Added debug log
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
            this.logger.log(`
              sendToDialogflow actor input: ${JSON.stringify(input)}`);
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

                          let content = '';
                          let richContent: any[] | undefined = undefined;

                          if (typeof response === 'string') {
                              content = response;
                          } else {
                              content = response?.plainText || response?.text || response?.message || '';
                              richContent = response?.richContent; // Extract richContent
                          }

                          this.logger.log(`Parsed content: '${content}'`); // Add logging

                          // Check for Escalation Tag in the content
                          const escalationTag = '##ESCALATE##';
                          let escalationTagFound = false;
                          if (content.includes(escalationTag)) {
                            this.logger.log('Escalation tag detected in content.'); // Add logging
                            escalationTagFound = true;
                            content = content.replace(escalationTag, '').trim();
                            this.logger.log('Escalation tag found and removed.'); // Add logging
                          }

                          if (content === 'firstEntryJson') {
                              content = '';
                          }

                          return {
                            content,
                            metadata: {
                              liveAgentRequested:
                                escalationTagFound ||
                                (typeof response === 'object'
                                  ? !!response?.escalate ||
                                    !!response?.meta?.liveAgentRequested
                                  : false),
                              startSurvey:
                                typeof response === 'object'
                                  ? !!response?.meta?.chatEnded
                                  : false,
                            },
                            richContent: richContent, // Pass through richContent
                          };
                        } catch (error) {
                          clearTimeout(timeoutId);
                          throw error;
                        }          },
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
        sendEmailTranscript: fromPromise(
          async ({ input }: { input: { email: string; sessionId: string } }) => {
            await this.callN8n(this.getN8nUrl('N8N_EMAIL_TRANSCRIPT_URL'), {
              sessionId: input.sessionId,
              email: input.email,
            });
          },
        ),
      },
    });

    // Pass sessionId as input to initialize machine context
    const actor = createActor(machineWithActors, {
      input: { sessionId },
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
                richContent: (msg as any).richContent, // Pass richContent to frontend
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

    // Dynamic handling of special triggers
    // Ensure type is a string before using it as an index
    if (typeof type === "string" && specialTriggerMap[type]) {
      const specialTrigger = specialTriggerMap[type];
      if (specialTrigger.n8nUrlKey) {
        const url = this.getN8nUrl(specialTrigger.n8nUrlKey);
        if (url) {
          try {
            const response = await this.callN8n(url, { sessionId, ...remainingPayload });
            if (response) {
              let plainText = response?.plainText || response?.text || '';

              // Check for Escalation Tag
              const escalationTag = '##ESCALATE##';
              let escalationTagFound = false;
              if (plainText.includes(escalationTag)) {
                escalationTagFound = true;
                plainText = plainText.replace(escalationTag, '').trim();
              }

              if (plainText !== 'firstEntryJson') {
                const botMessageData: BotMessageData = {
                  plainText,
                  messageId: randomUUID(),
                  participant: 'bot',
                  richContent: response?.richContent,
                  meta: {
                      ...specialTrigger.meta,
                      ...response?.meta,
                      liveAgentRequested: escalationTagFound || !!response?.meta?.liveAgentRequested || !!response?.escalate
                  },
                };
                stream.next({ type: 'bot_message', data: botMessageData });

                // Trigger state machine if escalation found
                if (botMessageData.meta?.liveAgentRequested) {
                    actor.send({ type: 'LIVE_AGENT_REQUESTED' });
                }

                // Send BOT_RESPONSE to machine to handle other metadata (like emailRequested)
                actor.send({
                  type: 'BOT_RESPONSE',
                  content: plainText,
                  metadata: botMessageData.meta as any,
                  richContent: botMessageData.richContent,
                });
              }
            }
          } catch (error) {
            this.logger.error(
              `Error calling N8n for ${type}: ${(error as Error).message}`,
            );
          }
        }
      }

      if (specialTrigger.machineEvent) {
        actor.send({ type: specialTrigger.machineEvent as any, ...remainingPayload });
      }
      return; // Handled special trigger, exit
    }

    // Handle Greeting (Special case, not in machine events explicitly, directly emits to stream)
    if (type === '__greeting__') {
      const url = this.getN8nUrl('N8N_GREETING_URL');
      if (url) {
        try {
          const response = await this.callN8n(url, { sessionId });
          const plainText = response?.plainText || response?.text || '';
          if (plainText !== 'firstEntryJson') {
            stream.next({
              type: 'bot_message',
              data: {
                plainText,
                messageId: randomUUID(),
                participant: 'bot',
                richContent: response?.richContent,
              },
            });
          }
        } catch (error) {
          this.logger.error(`
            Error handling greeting: ${(error as Error).message}`);
        }
      }
      return;
    }


    // Map to Machine Events (default behavior for USER_MESSAGE and fallbacks)
    if (type === 'USER_MESSAGE') {
      actor.send({
        type: 'USER_MESSAGE',
        content: remainingPayload.message as string,
      });
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
    const { actor, stream } = session;
    const messageId = message?.messageId || randomUUID();

    let content =
      message.plainText ||
      message.text ||
      message.content ||
      message.message ||
      '';

    // Check for Escalation Tag in the content
    const escalationTag = '##ESCALATE##';
    let escalationTagFound = false;
    if (content.includes(escalationTag)) {
      escalationTagFound = true;
      content = content.replace(escalationTag, '').trim();

      // Update the message object with cleaned text
      message.plainText = content;
      if (message.text) message.text = content;
      if (message.content) message.content = content;
      if (message.message) message.message = content;

      // Also clean rich content if it mirrors the text
      if (message.richContent && Array.isArray(message.richContent)) {
         message.richContent.forEach(item => {
             if (item.type === 'text' && item.text && item.text.includes(escalationTag)) {
                 item.text = item.text.replace(escalationTag, '').trim();
                 if (item.plainText) item.plainText = item.text;
             }
         });
      }
    }

    // --- Meta Handling & State Transitions ---

    // 1. Live Agent Requested
    if (message.meta?.liveAgentRequested || escalationTagFound) {
      actor.send({ type: 'LIVE_AGENT_REQUESTED' });
    }

    // 2. Chat Ended
    if (message.meta?.chatEnded) {
        this.logger.log(`Meta 'chatEnded' received for session ${sessionId}. Closing chat.`);
        actor.send({ type: 'USER_ENDED_CHAT' });
    }

    // 3. Livechat Issue
    if (message.meta?.livechatIssue || message.meta?.liveChatIssue || message.meta?.liveAgentIssue) {
      this.logger.warn(`Livechat issue reported for session ${sessionId}. Reverting to bot.`);
      actor.send({ type: 'LIVE_AGENT_ISSUE' });
    }

    // 4. Live Agent Unavailable
    // If we were in handover or agentActive, this should probably revert to bot or close?
    // For now, we'll treat it as a system message but could add a specific event later.
    if (message.meta?.liveAgentUnavailable) {
         this.logger.log(`Meta 'liveAgentUnavailable' received for session ${sessionId}.`);
         // Potentially could trigger a state change back to botActive if we had a specific event
    }

    // 5. Email Requested / Sent (Logging/Tracking)
    if (message.meta?.emailRequested) {
        this.logger.log(`Meta 'emailRequested' received for session ${sessionId}.`);
        // No explicit event needed here if it's part of BOT_RESPONSE metadata handled by machine
    }
    if (message.meta?.emailSent) {
        this.logger.log(`Meta 'emailSent' received for session ${sessionId}.`);
    }

    // 6. Start Survey
    // If startSurvey is true, it usually accompanies chatEnded or precedes it.
    // The machine guard `isSurveyRequested` looks for this on BOT_RESPONSE.
    // Since injectMessage sends AGENT_MESSAGE or generic message, we rely on the message itself to carry this.

    // --- End Meta Handling ---

    // If the message is from an agent, send it to the machine to update state/context
    if (message.participant === 'agent' || message.participant === 'bot') {
      // Ensure we map the content correctly
      // Use the potentially cleaned content
      actor.send({
        type: 'BOT_RESPONSE',
        content: content as string,
        metadata: message.meta as any,
        richContent: message.richContent,
      });
    } else {
      // Otherwise, stream it directly (e.g. system messages or generic bot injections)
      stream.next({
        type: 'bot_message',
        data: { ...message, messageId } as BotMessageData,
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