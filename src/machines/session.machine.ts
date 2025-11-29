import { setup, assign, fromPromise } from 'xstate';

export interface ChatMessage {
  role: 'user' | 'bot' | 'agent';
  content: string;
  timestamp: number;
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
              timestamp: Date.now(),
            } as ChatMessage,
          ];
        }
        if (eventType === 'BOT_RESPONSE') {
          return [
            ...context.messages,
            {
              role: 'bot',
              content: content as string,
              timestamp: Date.now(),
            } as ChatMessage,
          ];
        }
        if (eventType === 'AGENT_MESSAGE') {
          return [
            ...context.messages,
            {
              role: 'agent',
              content: content as string,
              timestamp: Date.now(),
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
  /** @xstate-layout N4IgpgJg5mDOIC5QGED2AjAhgGwC7IAtNd1VcA6ASwmzAGIBVAZQFEAlAfQFkWmmBBAOIsA2gAYAuolAAHVLEq5KqAHbSQAD0QBGAEwBWcgE4TJ3QBYAzJYNjtADgA0IAJ6JdRgGzlzAdk-6vvb6lub69p5GAL5RzmhYeITEpBQp-ADGSgBuYOQyAE6o6XAKKlB0EKq5lCpZqADWufE4+EQkZORpmZQ5eYXFsKVQCDV16cTKKuIS0+pyCkqq6loIntreYpbaNuu+HkYezm4IHtrG-oH269rm5va+MXEYLUntqWQZ2bkFRSU15WB8oV8nlsMQAGaofIAW3IzUSbRSnQ+3V6PwGQxGtSKE1U01mSBA80Uk2WOks+l05E8ezEnksXn0uyOiE8fmp+k8uguRnCm20jxA8NayQ6XS+5AgYHSlAUqjoBNk8hJS0JK22lOptPpjOZrh0EXI2m0RnsdjE9givlu9kFwteSPFPVyUplcpUCu0UkJxMWajV5M1NN0dIZAT1xy2hjCWzCFvMugZdueCNF71wn2dkulssmCt03qVC1JAYQvLEPk8lut9nMvK55hZCCslmMIRu+k2ugskWTCRFb2RGdRuUwAHdMCSygBJFQyACuuEYrE4PD4QlEkjmyr9ZLLncr1budc5FibfiMbdjdd09l0XIFsSFKYHjpREvHk6UM7ni+X7A4FgADkABEWBAjhkAACX4AAVRUiR3EtQBWSkm2uewfH0S5uUsKsxGwvsXkRDoiBUSocnyCoqiobFGjhF8HVIzByNQSisTGXEpkkBDfWQzQDVuchfFCNZ7yZGljXQ3wzl5LZuRk41dGNB4n3tEiKDIijAToQFgVBCEoVhdS03ILS2MBDicT9fEtx9JDVRQxBrHMch7CMOlzDWWs9EsYImyuchOzEELORjAwDCI1NB0wGAVGHCV0lUFRpVwSB-1XXgBGEXiHP9Jyy28UxipKkx0O7bxtDEIwEwce5LTEXQotfDpYrAeLM16JKVBSzJ0o3IDYO4LKN1y4tHIEwrjFKmb0O2CttFPS13IMTxNmapiKDajqR3IbrerSiA6AGobgLAiDoLgsaVXyybQgrdy6RCXxO3uPDG31BBthsc4Dm0fwjBU+8No08htoSrN9tS9LmAAs7wMgmD4Lsosbr3e63I8gJLBei0RLZcrApC+8-HsGwQzCEHTNged8hyFw6CYBgACEuGnIambYAA1FgAE1rt3UtPHpYTQjCfQvGqsQPuODsqQigI6S8PQAipwcabpsAGdhzh4YupGBf4lZhdbETbmwyWPJlnRzDsYTKTZeqqzCJq1MY0HwUnbBafoHXhvXHKUcQ8bbpWFzMc87zzF8-zPt8eOjVPAGqxq40YifFRUCleBCRMt5txDvcAFpPCbIvDBm0qrDVpFqFoAu0dLBMmy2S9fH5PxlMaiIaprsV32dBvBYKnYI7ZKOY-0JsKZ8C49gk3z9D79NOu+fo-jKIejecyIx68hxo8TWPjgvLUjHb3wvBsU0l7d-tNqHVfszdfi+ImlYycMG4xFpA54+Na2CAtimw7nsKqt526eGXo-Xan4pxQFnAuXAW9346HWK5CkvJbxrWlnhc8ONhIRAvBcNYXloHmUoig0OOhwi+HINVBknIjCWB-veJwn0bh0JjMaFh4sQiuyePfUG4NV5UL3HcaaldTARHQtLKkAQuRBHqt2RM0CRG7Shn1CAYjSwampMeUIEt-r6C8oA7Y3J6FcmwncMmIZGrQI1vTHRBVOQViZJyYMdJ6QmnQl5S8dIDAhCsCpCk0D0jYHkJAZxk1LRUn5GLMBXhEy+N3lyA4D5wh1igXfYiplPaUG9vkMA0T1SBArFYf+wRL51j2E2AGQU9hXD8tYAwfl05RCAA */
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
          target: 'botActive',
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
