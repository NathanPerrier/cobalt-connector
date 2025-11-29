import { setup, assign, fromPromise } from 'xstate';

export interface ChatMessage {
  role: 'user' | 'bot' | 'agent';
  content: string;
  timestamp: string;
}

export interface ChatContext {
  sessionId: string;
  userId: string;
  messages: ChatMessage[];
  agentId?: string;
  error?: string;
  surveyData?: any;
}

export type ChatEvent =
  | { type: 'USER_MESSAGE'; content: string }
  | {
      type: 'BOT_RESPONSE';
      content: string;
      metadata?: { liveAgentRequested?: boolean; startSurvey?: boolean };
    }
  | { type: 'AGENT_CONNECTED'; agentId: string }
  | { type: 'AGENT_MESSAGE'; content: string }
  | { type: 'AGENT_ENDED_CHAT' }
  | { type: 'USER_ENDED_CHAT' }
  | { type: 'SUBMIT_SURVEY'; data: any }
  | { type: 'SYSTEM_ERROR'; message: string };

// 3. Setup the Machine
export const sessionMachine = setup({
  types: {
    context: {} as ChatContext,
    events: {} as ChatEvent,
    input: {} as { sessionId: string; userId?: string },
  },
  actions: {
    addMessageToContext: assign({
      messages: (
        { context, event },
        params?: { type?: string; content?: string }
      ) => {
        const eventType = params?.type || event.type;
        const content = params?.content || (event as any).content;

        if (eventType === 'USER_MESSAGE') {
          return [
            ...context.messages,
            {
              role: 'user',
              content: content as string,
              timestamp: new Date().toISOString(),
            } as ChatMessage,
          ];
        }
        if (eventType === 'BOT_RESPONSE') {
          return [
            ...context.messages,
            {
              role: 'bot',
              content: content as string,
              timestamp: new Date().toISOString(),
            } as ChatMessage,
          ];
        }
        if (eventType === 'AGENT_MESSAGE') {
          return [
            ...context.messages,
            {
              role: 'agent',
              content: content as string,
              timestamp: new Date().toISOString(),
            } as ChatMessage,
          ];
        }
        return context.messages;
      },
    }),
    setAgentId: assign({
      agentId: ({ event }) =>
        event.type === 'AGENT_CONNECTED' ? event.agentId : undefined,
    }),
    logError: assign({
      error: ({ event }) =>
        event.type === 'SYSTEM_ERROR' ? event.message : undefined,
    }),
  },
  actors: {
    // These placeholders would be implemented with your existing logic from 'connector/dialogflow.js' and 'liveagent.js'
    sendToDialogflow: fromPromise(
      async ({ input }: { input: { message: string; sessionId: string } }) => {
        await Promise.resolve(); // Satisfy require-await
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const dummy = input;
        // Logic from dialogflow.js
        return {
          content: 'Hello',
          metadata: { liveAgentRequested: false, startSurvey: false },
        };
      },
    ),
    connectToLiveAgent: fromPromise(
      async ({ input }: { input: { sessionId: string } }) => {
        await Promise.resolve(); // Satisfy require-await
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const dummy = input;
        // Logic to initiate Handover
      },
    ),
    sendToLiveAgent: fromPromise(
      async ({ input }: { input: { message: string; agentId: string } }) => {
        await Promise.resolve(); // Satisfy require-await
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const dummy = input;
        // Logic from liveagent.js
      },
    ),
  },
  guards: {
    isLiveAgentRequested: ({ event }) =>
      event.type === 'BOT_RESPONSE' && !!event.metadata?.liveAgentRequested,
    isSurveyRequested: ({ event }) =>
      event.type === 'BOT_RESPONSE' && !!event.metadata?.startSurvey,
  },
}).createMachine({
  /** @xstate-layout N4IgpgJg5mDOIC5QGED2AjAhgGwC7IAtNd1VcA6ASwmzAGIBVAZQFEAlAfQFkWmmBBAOIsA2gAYAuolAAHVLEq5KqAHbSQAD0QBGAEwBWcgE4TRgBwA2M2OsAWA7YA0IAJ6J9Fi+QDsVgMxiYt76pn7eAL7hzmhYeITEpBSJ-ADGSgBuYOQyAE6oKXAKKlB0EKpZlCrpqADWWTE4+EQkZOTJaZSZ2XkFsEVQCJXVKcTKKuISE+pyCkqq6loIFrba5GJ+en5GYhY7QWbObgi2tl4rFt663mLmfhfetpHRGI3xLUlkqRlZufmFlSUwDk8jlsthiAAzVA5AC25AacWaiTanw6XV+vX6gyq+VGqgmUyQIBmijGCx0tjEunItjMtj8+lsHl0uhsukOiD8V3I2k8l30+g2TN2+ieIARTQSrXa33IEDAKUoClUdEJsnkpPmRMW2kp1Np9MZzNZZnZrk5D3InguuksFn0VyMfjFEreyJlnSy8sVypUqu0UiJJLmam1Oi2+rpDOFLLZHOOrKtfIMYlOy10fkeUXFL0RUo+uC+nrlCqVY1VukD6tmZLDCHMhlOZmuRn02jp7YO5uO3iM5DbZgCm28eltWeesUl7xRhbRFRUMgArrg2AqwJ6IIxWJweHwhKJJNMNSHyfWzI2rC2ByszF2jvpLOQzE7dE71m29C7c1P3ajZZUlxXNcNy3dgOBYAA5AARFgoI4ZAAAl+AAFTVYlj1rUBFgdeNtA8Lxgl0ZZLiMEc+S-Sc3VaIgVDKTIclKcoqBxOp4W-KiKBouigWxYY8XGSQ0ODTDNB0Z9bH7JsBV5YiHlw7w-DWQc-EsExLCpS4KNeJFqMwWjUHouggRBMFIWhOFXR0zi9O4nJeNxEMCUPIMMK1LDOROJ9tgsBkDC2G473DCSTjEXk-C2OlNOzSz83ITAYBUWdZRSVQVAVXBIFAndeAEYQhNc0N3PrbxcO0MryFfVsVMZUKbC0vNp3isBEqLLoUpUNK0ky-cIOQ7gcv3fKazc0Titw0LDEzZY8LMPRKVbeqf1aJqWrnch2s6jLNx6vrIJguDEJQobNUK0bMzELydgNJlLEuEru20LlDAMIjaQUiwM1vRaOLihKkuLDb0sy5gwL22D4KQ1DnOrE7T3Oy7ljpG6bXuo49DESaGXMK5n20IIImi9irPIWBFxyTIXDoJgGAAIS4ABJPrqbYAA1FgAE1jpPOtPEUhSTnbKkVN7fRcLCLwHxCawfIxwJdG+4nSfJsBKZBzgwYOyGuZExZeZ8TMbyF5tWzFoilKl1kLFbEcjAV2KIUwShsDJ+g1f6vc8uh9DhtOxZwok58dl8wVtnMeNZv7QIo9TVtzAWsUVFQeV4CJGL3iPH3TwAWgseMc7t6dqFoDPYbrex4wfPsTGu3wBR8+XCco4mPUyEvuaK8KvEDnyHRDgL4wZMxjF5O7U2bKwzAL39-vRHp-mKNudc5OkEeD-yw+7fCaSMN7gnenZtCn6U-2Lb0yxG4SRsWdSeUpEJHt0E4qvjJtb65BT-JU2kj4LVr50A1cBQNyLyvjobQJhyBYwZL2dMlhtDxl2NSdYyxSJGF0HoaSP9yBcQMkCEBvsdA+S8N5cBbYRRcicA9Wk-ZByUkpHhK4vhxw5ibrFFaM8wD4NPLYIw8Y0HeCfKcFY+hfC2jxhYLB7C-7rVSkDCAXC6yPUMIjJkg9XxhDwrhdB1IXqeD0BcaWDcJzaVikrCmCiioeAum2DwDouSvm8L4MW4U1hUiIScJkvIjEsJMdOFI2B5CQAsaNW8SCNhjgfs+UWD0uRVyxuJYI2x2xYIdk7F2wSdQfQuimUK4lGSnD8Hwi6NhYlW2bEyDwBNIhAA */
  id: 'CobaltChatbot',
  initial: 'idle',
  context: ({ input }) => {
    return {
      sessionId: input?.sessionId || 'FALLBACK_EMPTY',
      userId: input?.userId || '',
      messages: [],
    };
  },
  states: {
    // 1. IDLE: Waiting for the session to effectively start or user input
    idle: {
      on: {
        USER_MESSAGE: {
          target: 'botActive.processing',
          actions: 'addMessageToContext',
        },
      },
    },

    // 2. BOT ACTIVE: The default mode (replaces !inLiveAgentMode)
    botActive: {
      initial: 'processing',
      states: {
        processing: {
          invoke: {
            src: 'sendToDialogflow',
            input: ({ context, event }) => ({
              message: (event as any).content,
              sessionId: context.sessionId,
            }),
            onDone: {
              target: 'decision',
              actions: [
                {
                  type: 'addMessageToContext',
                  params: ({
                    event,
                  }: {
                    event: { output: { content: string } };
                  }) => ({
                    type: 'BOT_RESPONSE',
                    content: event.output.content,
                  }),
                },
                // In reality, you'd map the output to a proper event
              ],
            },
            onError: {
              target: '#CobaltChatbot.failure',
            },
          },
        },
        decision: {
          // Logic from 'dialogflow.js' to check metadata
          always: [
            {
              target: '#CobaltChatbot.handover',
              guard: 'isLiveAgentRequested',
            },
            { target: '#CobaltChatbot.survey', guard: 'isSurveyRequested' },
            { target: 'inputReceived' },
          ],
        },
        inputReceived: {
          on: {
            USER_MESSAGE: {
              target: 'processing',
              actions: 'addMessageToContext',
            },
            // Global exit triggers
            USER_ENDED_CHAT: { target: '#CobaltChatbot.closed' },
          },
        },
      },
    },

    // 3. HANDOVER: The transition state (formerly implicit in setting inLiveAgentMode)
    handover: {
      invoke: {
        src: 'connectToLiveAgent',
        input: ({ context }) => ({ sessionId: context.sessionId }),
        onDone: {
          target: 'agentActive', // Or 'agentActive.queueing' if you want to distinguish
        },
        onError: {
          target: 'botActive', // Fallback to bot if agent unavailable
          actions: 'logError',
        },
      },
    },

    // 4. AGENT ACTIVE: Talking to human (replaces inLiveAgentMode = true)
    agentActive: {
      initial: 'connected',
      states: {
        connected: {
          on: {
            USER_MESSAGE: {
              actions: 'addMessageToContext',
              // We don't transition state, just side-effect send to agent
            },
            AGENT_MESSAGE: {
              actions: 'addMessageToContext',
            },
            AGENT_ENDED_CHAT: {
              target: '#CobaltChatbot.survey',
            },
            USER_ENDED_CHAT: {
              target: '#CobaltChatbot.closed',
            },
          },
        },
      },
    },

    // 5. SURVEY: Post-chat survey
    survey: {
      on: {
        SUBMIT_SURVEY: {
          target: 'closed',
          actions: assign({ surveyData: ({ event }) => event.data }),
        },
        USER_ENDED_CHAT: 'closed',
      },
    },

    // 6. CLOSED: Final state
    closed: {
      type: 'final',
    },

    // Global Failure State
    failure: {
      on: {
        USER_MESSAGE: 'botActive', // Try to recover
      },
    },
  },
});
