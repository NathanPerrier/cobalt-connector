import { setup, assign, fromPromise } from 'xstate';
import { v4 as uuidv4 } from 'uuid';

export interface ChatMessage {
  id: string;
  role: 'user' | 'bot' | 'agent';
  content: string;
  timestamp: string;
  richContent?: any[];
  metadata?: any;
}

export interface ChatContext {
  sessionId: string;
  userId: string;
  messages: ChatMessage[];
  agentId?: string;
  error?: string;
  surveyData?: any;
  email?: string;
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
  | { type: 'EMAIL_PROVIDED'; email: string }
  | { type: 'EMAIL_VALIDATED'; email: string }
  | { type: 'EMAIL_INVALID'; message: string };

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
        params?: { type?: string; content?: string; richContent?: any[]; metadata?: any }
      ) => {
        console.log('addMessageToContext called with event:', event.type);
        const eventType = params?.type || event.type;
        const content = params?.content || (event as any).content || (event as any).message;
        const richContent = params?.richContent || (event as any).richContent;
        const metadata = params?.metadata || (event as any).metadata;

        if (eventType === 'USER_MESSAGE') {
          return [
            ...context.messages,
            {
              id: uuidv4(),
              role: 'user',
              content: content as string,
              timestamp: new Date().toISOString(),
            } as ChatMessage,
          ];
        }
        if (eventType === 'BOT_RESPONSE' || eventType === 'EMAIL_INVALID') {
          console.log('Adding BOT_RESPONSE to context. Content:', content);
          return [
            ...context.messages,
            {
              id: uuidv4(),
              role: 'bot',
              content: content as string,
              timestamp: new Date().toISOString(),
              richContent: richContent,
              metadata: metadata,
            } as ChatMessage,
          ];
        }
        if (eventType === 'AGENT_MESSAGE') {
          return [
            ...context.messages,
            {
              id: uuidv4(),
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
      console.log('isSurveyRequested guard checking event:', event.type, (event as any).metadata);
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
      if (event.type === 'BOT_RESPONSE' && !!event.metadata?.emailRequested) {
        console.log('Guard isEmailTranscriptRequested passed');
        return true;
      }
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
  /** @xstate-layout N4IgpgJg5mDOIC5QGED2AjAhgGwC7IAtNd1VcA6ASwmzAGIBVAZQFEAlAfQFkWmmBBAOIsA2gAYAuolAAHVLEq5KqAHbSQAD0QBGAGwBWcgE4TRgBxijAJgAsVgMxGbZgDQgAnolv6A7OX322la6PvpiYvoG9gC+0W5oWHiExKQU1LR0AEIA8gAqHGy8AArZAHKs4lJIIHIKSqrqWgjaNoam5pa2Dk6uHoj2+sHkPmK6rVYWej4DsfEYOPhEJGRUNPQ5+YVMJeWi2lWy8orKatVN2vptphbWdo7Obp4I9g7Go2KOYsEXobMgCQtkss0mssnkCsUyhUrAcakd6qdQE1Bo9EM4rNpyFYfEYgvYfD4zNpiX8AUklqlVhkNhDtlDRPZYbVjg0zjpLsZrp07j1UQhghjyNoXmZLjYnD4rPobKT5uSUit0vQhCxSvlkGVSixkLkWAARSrqZkIxo6Aackw3Lr3XpPYWY6747QEqXOqyyxKLBUgjIqtXcXgCYSG6rGk6m5qtC0dW7dB59fnY4yDIz2IliZ1iGy6D2AimK0EAGQAkgA1FgcP2bFgARQYvF1BskRvh4bZzQM0atPPjTxs2iM5FF1ntunMNjsuflwKp9BYXH4xcLHFybH45WQbGLRWrdYb+pDhzqbaRZqulu5cdt-V0Vis5AMRlvY9a9l0Yh8U69M6VjFYnFVPV9Q4ZAAAl+FyQ84WPVlT2aKUu0vRx9D5IlyHFUw73sMRRV0C4vyBSlUn4ABjJQADdlWEf0NVKLUdQPZtQ1bWDNB0Mwx3IQJXRMS4s2xPkLjMe9LHxbM3zTQICPzChiLIyhKLoKsAz4FUoLDVjzjMcUuKCfQByMPi7B8QTtDMQdCXMy4LhsRwQmk71yDkij6BLctK2o3d6yYRt1JYxE2OaMwcV0njDLCYzBJCMxyCzXRtMlMxhO0hyZ2chS5wXJcVzXDctx3CE9x8ximX8iMBwHUL9N4iKBITAddF0dCAgzWyfGFGxCVSoiyFIly-3YDhAOAsCIL8mCAq0-RB246rwv4kyE0CEKzKscwxjvAJupWdLFJpLYdgqJijxZSadCMSwqoMoy6rtYKxHQy1DJaKwcMa7bZN6+S9vBA76REfYWwm8qkpmvTrtqxa7US-xszMNMQkCdEPqcr7+v2yFdhEGEgdOkHONmiGFr5bCOVaDaRh8KI3xR3b1l+zGKkZXGTXbfR4fQjFRQCUIXqsPlsQ4h9LAnKVGsiJLabRjLyBkAAnVASLgBQVCgOgIFUMAqBUcjUAAay1slvx63A+pl+XFeVyhVYQa3dZI4gTkqca8fbJL71e7DQlGCcON0AWXhsIU1slXRPjTXwpdN76tYtpXYBVtWwDlhW5dl7BiAAM1QOWAFtyCNwidulyjZYV+PE9tnXFcd1RneO6DXbgszpqumrifqiZDB8OwgmsDp4c-OJ-jlY3i+jlzyAgMASMoBRVDoF3Web8ywbCm6ofY2xHt4nEvhsSwo7N0vp9n+eVEXwHmOB9tbz5TrQixPeD8sEx3uHwuZNRieZdPueTkXjja+TdAoVTXnNDeAsMxNUMthFoF0OJ6CPjHKeM9-4LxEMzYBy9QEOCamMUYQQJjaAiIZAWtgHoGDwglCc0xIjIMntbGQABXXAbAZ5gAyhAAanAeCqWDA3DSZ14JvgfAfPCd50zTRQgmWwBIHyRGCNpSRRIcwf1HkXT6P9S5MNYewpWXCwTVjpFjQRZV2xmRMG3eakVZGEj8JZe6ZkPwtAYTLXRbCOGGIxiYioV8To4K0lYwm7dbFPAxLiYYIdpQfiJCYNxOiVAsM8QYyi3CfGHVEEAgJJ5QGg2sZA2RF1BzhECBcEhz0abqM9Jo7+x8tYeP0ZwtJRjaSZMwaVG+zdnCGACMKcIwRIjmBkeE4UhhxjmAGBMVozgEkNKSXorxLTmCDWGnqEC4FIJmK6XkkKISbG3X6OEIOhlbzmSlC8UpKMiAqA1pROW6tNba11gbAuGiv43LucnKu9ta4qHrp0kB5xH7tG7FePkMThbWBwhxO8VMYjVLzI5T5qB7mPJUPMl5ht3nIswLc1F3y7Y1wRM7fxjdAleFXs1MpgQDDOA+KZbSQozJhw-BMMcwRrl4q+Q85Oqd05ZxzvnT+uL8X3J+cSp2kgl65KaK9Kx2l8TsxIYMEYNg+TPSHNNLmMKOKtC5WK5OdA3IVmUsWPg9YZWaS8K-IcbVlURGxFmDVGYuLauCGq8IHwUaYBgCobRrkyyms8hwc1TBLXbKBV4OBwx7C2ScAfaarRN7PACDFWy2EJxmRIaKBFcwalf19WAf19TyAkVUBisikAeEqSDKISNFLniNUxLYEw9g42I1slFdmsUHCOAJGEfSPq-UBrLRWmeuBq3KT4XWq1wi3x4SxBhdt2Zphdvqoo2KIw1rxWCBEIe+akUziLSWlB5aVCVsndw5SayNljQbbKxAwl759oURKLoF1bDDuLaO89l7q0rIAqUIC6zRpbMBY26w98zL2CFNNW8PdhJhxRrAZhctKLuDoOGzIXBiz5HDWwcsABNOdEYw6GAuLeOwtDLAMoTFmwwSGvgkMsElPNI8C2OVQ+hsAmHANDWAyNTZpHb7mko10GjF17D330piAkuJnoBEjoi6clJuMYdaX9UxEHH0IAkUKdqwVsTs1GMEe+B8TmdEcNpRBZgUZgFzpgSg2BchyzxbAEictKAyFwDW29YGRNwUlC+plFxUzOiVZOFTY8KAOacy5tzKgPNeZ85pxm9adPWtTamWKcMiFpgcNoAWYwmrcXbRYBwO6ZTRdqXF5zrn3Oee87Fxzzn2EAEdmFwCvXQeci5lxFDYNkUsxYQOBcCmtEhwwPg4RxC-JK-tZF2HvOI1+kQH7VcPaplYdWEuNZSy1+LHWuuwB6-xmdakH1Zcmw9EY2FgpOHCAtgW+kYoDBHA9g+Ax2MipnLthrSWms+fILt473Xq19eyqWfgJY9QQRKizXT5XYPOFss6TqOFhkC1WsYKmdg2UwuxPZ1re3AcHZByTsHp2IdZWXMWUo0PYfjblfFTERI5HLThuqpbExYpIcai4-ScbifxYB8l5rFOjtgE6+D9JDNfEZcR9d1nQ4gidU5-Fbn4T233j7tKTXm07wi-q4l8XwPQdLJp-1jgjPRvw6bJl+dkl0KKvRyMcyopisTlCuVr4LwjDTGN6Ts3h22uW+4ZDunDOYejeZ14XEt2ZufaexxAOQwJkWHbdZTlNWv7-dN0D0P2AmnePl+0q787iSDmmviL4IxpSpmk7IqZvbDIZqfAOOzueuPFogNbKALASfosxfrbFnGZywF7-3wf8WJUOxJdKivEYHCurXfcRNThfAk3xw+YS61DIB-MAejjR61NT9VjP5zdA+U5wFbgbOec3nj7P7c6fJO59-IBUr4RwRRHs-V+jprnyISLrp0Guo1Eqj9jijOJnPFmhvQOdoGJdo7iDOeDGNaLyAmI+FqtYN9hVG+NoCjLAc5vAWlgrnHomFmFiE+MFOmPiJTIJBckKBvnvgfE+JtiftthQMQdgKQRkv9GSkIsvq9EHDurQSQvQR+KZL4EKMFJ1BdGMPDFtN3jAXAXLPTMYu0tkuSrpneFQWIYSBIQSFIfVHGiUqmO1KEH2r4GoltjFuQDwXwWXv9FgjktdghKCkhJgXaKJEOAMEodYELvQn8CoKgNPPANUL9qkN-hGAALSLZPCxFoHtCeGEEqGUhKgxHth2ACzyGxSxLartS+AcFRHjz1JZFwRKacwtw8z6TLZQKdTJhrQcSSjChPjH6lFaKlpxxWyqwVGBR4T4KDCBCWAtBUJFZLYyFSiEiqrYgEgGBzKoJny5JCEWIkKYizROgmAZgpoOBRi4TGZIzbElHQEmylqNLh79HnB8Q4EWbuz9hxrkKiLiI-AhAYjUYGo8pXFeBjBs5q7TCAHaTSGDjULswYgYjxT6DfqnouTfFNrChLptodpr6CSdRBy+B17tT4jmDwzQm-rjpVoQBwlvgKrjgdTSJviCShAxQB5jDrQ9xPg552G1Lqa8Zwl5HrHSjeDRLXgICtARBDi3jvYfj2JGBB5i6F5wm-6wb-4Ak9xAGyIOA0kphKHTLShd7Ml54k4Snk4W4y7U5EnYK6EjAPQWDZhhxOBdxN7hIpixQDAzHYQin6rpE7bakF66mU6XFGlZZIyiHmQZhdyrxAmTH3jmDBDPhSitBikukUCT6v4X4k7El4QtrLrIlxrWleBUxtA4jaTiikx4QowkTYDyCQBwnBQo4tTSgtBsGUn0ZhxNSDDnJ6DKoDhEFqFgBSkkJByKrUkqpOpa46DYilYhB6B3ijnPSxCxBAA */
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
          { target: '#CobaltChatbot.emailTranscript', guard: 'isEmailTranscriptRequested', actions: 'addMessageToContext' },
          { target: '#CobaltChatbot.handover', guard: 'isLiveAgentRequested', actions: 'addMessageToContext' },
          { target: '#CobaltChatbot.survey', guard: 'isSurveyRequested', actions: 'addMessageToContext' },
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
        EMAIL_TRANSCRIPT_REQUESTED: { target: '#CobaltChatbot.emailTranscript' },
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
        EMAIL_TRANSCRIPT_REQUESTED: { target: '#CobaltChatbot.emailTranscript' },
        USER_ENDED_CHAT: { target: '#CobaltChatbot.closed' },
        BOT_RESPONSE: [
          { target: '#CobaltChatbot.emailTranscript', guard: 'isEmailTranscriptRequested', actions: 'addMessageToContext' },
          { target: '#CobaltChatbot.handover', guard: 'isLiveAgentRequested', actions: 'addMessageToContext' },
          { target: '#CobaltChatbot.survey', guard: 'isSurveyRequested', actions: 'addMessageToContext' },
          { target: '.inputReceived', actions: 'addMessageToContext' },
        ],
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
                    event: { output: { content: string; richContent?: any[]; metadata?: any } };
                  }) => ({
                    type: 'BOT_RESPONSE',
                    content: event.output.content,
                    richContent: event.output.richContent,
                    metadata: event.output.metadata,
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
        BOT_RESPONSE: { actions: 'addMessageToContext' },
      },
    },

    // 6. EMAIL TRANSCRIPT
    emailTranscript: {
      initial: 'emailRequested',
      states: {
        emailRequested: {
          on: {
            EMAIL_PROVIDED: {
              target: 'emailReceived',
              actions: assign({ email: ({ event }) => event.email }),
            },
            USER_MESSAGE: {
              target: 'emailReceived',
              actions: assign({ email: ({ event }) => event.content }),
            },
            EMAIL_VALIDATED: {
              target: '#CobaltChatbot.sendingEmail',
              actions: assign({ email: ({ event }) => event.email }),
            },
            EMAIL_INVALID: {
              target: 'emailRequested',
              actions: 'addMessageToContext',
            },
            BOT_RESPONSE: { actions: 'addMessageToContext' },
          },
        },
        emailReceived: {
          on: {
            EMAIL_VALIDATED: {
              target: '#CobaltChatbot.sendingEmail',
              actions: assign({ email: ({ event }) => event.email }),
            },
            EMAIL_INVALID: {
              target: 'emailRequested',
              actions: 'addMessageToContext', // Should probably add a bot message explaining why
            },
            BOT_RESPONSE: { actions: 'addMessageToContext' },
          },
        },
      },
      on: {
        USER_ENDED_CHAT: 'closed',
        BOT_RESPONSE: { actions: 'addMessageToContext' },
      },
    },

    sendingEmail: {
      invoke: {
        src: 'sendEmailTranscript',
        input: ({ context, event }) => {
          const email = context.email || (event as any).email;
          if (email) {
            return { email, sessionId: context.sessionId };
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
        BOT_RESPONSE: [
          { target: '#CobaltChatbot.emailTranscript', guard: 'isEmailTranscriptRequested', actions: 'addMessageToContext' },
          { target: '#CobaltChatbot.handover', guard: 'isLiveAgentRequested', actions: 'addMessageToContext' },
          { target: '#CobaltChatbot.survey', guard: 'isSurveyRequested', actions: 'addMessageToContext' },
          { target: 'botActive.inputReceived', actions: 'addMessageToContext' },
        ],
      },
    },
  },
});