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
      metadata?: { liveAgentRequested?: boolean; startSurvey?: boolean; liveAgentIssue?: boolean; emailRequested?: boolean };
      richContent?: any[];
    }
  | { type: 'AGENT_CONNECTED'; agentId: string }
  | { type: 'AGENT_MESSAGE'; content: string }
  | { type: 'AGENT_ENDED_CHAT' }
  | { type: 'USER_ENDED_CHAT' }
  | { type: 'SUBMIT_SURVEY'; data: any }
  | { type: 'SYSTEM_ERROR'; message: string }
  | { type: 'LIVE_AGENT_REQUESTED' }
  | { type: 'LIVE_AGENT_ISSUE' }
  | { type: 'EMAIL_TRANSCRIPT_REQUESTED' }
  | { type: 'EMAIL_PROVIDED'; email: string };

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
          richContent: [] as any[] | undefined, // Explicitly include richContent in placeholder
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
    sendEmailTranscript: fromPromise(
      async ({ input }: { input: { email: string; sessionId: string } }) => {
        await Promise.resolve();
        // Logic to send email transcript
      },
    ),
  },
  guards: {
    isLiveAgentRequested: ({ event }) => {
      if (event.type === 'BOT_RESPONSE' && !!event.metadata?.liveAgentRequested)
        return true;
      if (
        event.type.startsWith('xstate.done.actor.') &&
        !!(event as any).output?.metadata?.liveAgentRequested
      )
        return true;
      return false;
    },
    isSurveyRequested: ({ event }) => {
      if (event.type === 'BOT_RESPONSE' && !!event.metadata?.startSurvey)
        return true;
      if (
        event.type.startsWith('xstate.done.actor.') &&
        !!(event as any).output?.metadata?.startSurvey
      )
        return true;
      return false;
    },
    isEmailTranscriptRequested: ({ event }) => {
      if (event.type === 'BOT_RESPONSE' && !!event.metadata?.emailRequested)
        return true;
      if (
        event.type.startsWith('xstate.done.actor.') &&
        !!(event as any).output?.metadata?.emailRequested
      )
        return true;
      return false;
    },
    isLiveAgentIssue: ({ event }) => {
      if (
        event.type.startsWith('xstate.done.actor.') &&
        !!(event as any).output?.metadata?.liveAgentIssue
      )
        return true;
      return false;
    },
  },
}).createMachine({
  /** @xstate-layout N4IgpgJg5mDOIC5QGED2AjAhgGwC7IAtNd1VcA6ASwmzAGIBVAZQFEAlAfQFkWmmBBAOIsA2gAYAuolAAHVLEq5KqAHbSQAD0QBGACwBWcgE4TRgOwAOXQDZtAJn26xdgDQgAnjuvW75M86ddC20zI1sAX3C3NCw8QmJSCmpaOgAhAHkAFQ42XgAFdIA5VnEpJBA5BSVVdS0EbQBmQ1NzK1sHJ1cPRDtdA3IxS3MGsSajXSMGyOiMHHwiEjIqGnoM7NymAuLRbTLZeUVlNXK67X1m00sbe0dnN08EBrNdcj6fBu0LfRM7CzDpkAxObxRZJFZpLI5fJFEp2PYVA7VY6gU4OYyXNo3Tr3Hr6MzWAbnfR2IwWOwNCwWawAoFxBaJZYpNZQzYw0QNeGVQ41E46c7okxXdq3LoPexGMTkMl2Mwk8bWMJmMw02Z0hJLZL0IQsQrZZBFQosZCZFgAEVK6i5SNqOiaAta1w6d269TJ5H0DRaVI+DQVUyigNV83VYJS2t13F4AmEFvKVqONvq-RaQqxzoeMosr0mYnM52ssom-pmsWDoMZ9AAMgBJABqLA44fWLAAigxeCbzZJLYiE7z6vyU5inaLELpesYbOTc2dzs8VaWQQzNYxWJwdaazRxkAAJfiZWP7Kp9lE6dM9Ix6d1E34WUL6PQL4H0paJfgAYyUADctcII-rCkNY0zUPBFjx5U96ksbRyALT59C+bQ9EGHEEEpQxtDCM5rEcXR-F0bQnzVcs30-SgfzoJtIz4bVQPjCDNB0UIYLgr5EOQsxUNJGC9CMDpyTJPjCIDWkywZUjvyrOsGyo3I2w7EDuzjXsGNOMkWLMeD2KcTiXT0JDyBuKwxFzJp-AsIixNfMgP0k8gZAAJ1Qd84AUFQoDoCBVDAKgVC-VAAGsfNEpdrNwWzyJ8xznNcyh3IQOL-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-hhbfxT0XrdeHGcgrIhAA */
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
        BOT_RESPONSE: [
          { target: '#CobaltChatbot.emailTranscript', guard: 'isEmailTranscriptRequested' },
          { target: '#CobaltChatbot.handover', guard: 'isLiveAgentRequested' },
          { target: '#CobaltChatbot.survey', guard: 'isSurveyRequested' },
          { target: 'botActive.inputReceived', actions: 'addMessageToContext' },
        ],
        AGENT_CONNECTED: {
          target: 'agentActive',
          actions: 'setAgentId',
        },
        AGENT_MESSAGE: {
          target: 'agentActive',
          actions: 'addMessageToContext',
        },
        LIVE_AGENT_REQUESTED: { target: '#CobaltChatbot.handover' },
        EMAIL_TRANSCRIPT_REQUESTED: { target: '#CobaltChatbot.sendingEmail' },
        USER_ENDED_CHAT: { target: '#CobaltChatbot.closed' },
      },
    },

    // 2. BOT ACTIVE: The default mode (replaces !inLiveAgentMode)
    botActive: {
      initial: 'processing',
      on: {
        AGENT_CONNECTED: {
          target: 'agentActive',
          actions: 'setAgentId',
        },
        AGENT_MESSAGE: {
          target: 'agentActive',
          actions: 'addMessageToContext',
        },
        LIVE_AGENT_REQUESTED: { target: '#CobaltChatbot.handover' },
        EMAIL_TRANSCRIPT_REQUESTED: { target: '#CobaltChatbot.sendingEmail' },
      },
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
            { target: '#CobaltChatbot.sendingEmail', guard: 'isEmailTranscriptRequested' },
            { target: 'inputReceived' },
          ],
        },
        inputReceived: {
          on: {
            USER_MESSAGE: {
              target: 'processing',
              actions: 'addMessageToContext',
            },
            BOT_RESPONSE: [
              { target: '#CobaltChatbot.sendingEmail', guard: 'isEmailTranscriptRequested', actions: 'addMessageToContext' },
              { target: '#CobaltChatbot.handover', guard: 'isLiveAgentRequested', actions: 'addMessageToContext' },
              { target: '#CobaltChatbot.survey', guard: 'isSurveyRequested', actions: 'addMessageToContext' },
              { actions: 'addMessageToContext' },
            ],
            // Global exit triggers
            USER_ENDED_CHAT: { target: '#CobaltChatbot.closed' },
          },
        },
      },
    },

    // 3. HANDOVER: The transition state (formerly implicit in setting inLiveAgentMode)
    handover: {
      on: {
        LIVE_AGENT_ISSUE: 'botActive.inputReceived',
      },
      invoke: {
        src: 'connectToLiveAgent',
        input: ({ context }) => ({ sessionId: context.sessionId }),
        onDone: [
          {
            target: 'botActive.inputReceived',
            guard: 'isLiveAgentIssue',
          },
          {
            target: 'agentActive', // Or 'agentActive.queueing' if you want to distinguish
          },
        ],
        onError: {
          target: 'botActive.inputReceived', // Fallback to bot if agent unavailable
          actions: 'logError',
        },
      },
    },

    // 4. AGENT ACTIVE: Talking to human (replaces inLiveAgentMode = true)
    agentActive: {
      on: {
        LIVE_AGENT_ISSUE: 'botActive.inputReceived',
      },
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

    // 6. EMAIL TRANSCRIPT
    emailTranscript: {
      on: {
        EMAIL_PROVIDED: {
          target: 'sendingEmail',
        },
        USER_MESSAGE: {
          target: 'sendingEmail', // Assume message is email for now, validation logic needed
        },
        USER_ENDED_CHAT: 'closed',
      },
    },

    sendingEmail: {
      invoke: {
        src: 'sendEmailTranscript',
        input: ({ context, event }) => {
          const eventContent = (event as any).content || (event as any).email;
          if (eventContent) {
            return { email: eventContent, sessionId: context.sessionId };
          }
          // Fallback to last user message
          const lastUserMsg = [...context.messages].reverse().find(m => m.role === 'user');
          return {
            email: lastUserMsg?.content || '',
            sessionId: context.sessionId
          };
        },
        onDone: {
          target: 'botActive.inputReceived',
        },
        onError: {
          target: 'botActive.inputReceived', // Fallback to bot if failed
        },
      },
    },

    // 7. CLOSED: Final state
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