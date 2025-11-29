import { setup } from 'xstate';

export const sessionMachine = setup({
  types: {
    context: {} as object,
    events: {} as
      | { type: 'USER_MESSAGE' }
      | { type: 'ESCALATION_TRIGGER' }
      | { type: 'END_CMD' }
      | { type: 'TIMEOUT_DETECTED' }
      | { type: 'AGENT_CONNECTED' }
      | { type: 'NO_AGENTS' }
      | { type: 'USER_CANCEL' }
      | { type: 'AGENT_ENDED' }
      | { type: 'USER_ENDED' }
      | { type: 'GHOST_TIMEOUT' }
      | { type: 'SURVEY_SUBMITTED'; data?: any }
      | { type: 'SURVEY_SKIPPED' }
      | { type: 'SUCCESS' }
      | { type: 'FAILURE' }
      | { type: 'AUTO_TRANSCRIPT' }
      | { type: 'RESTART_CLICK' },
  },
}).createMachine({
  id: 'session',
  initial: 'idle',
  states: {
    idle: {
      description: 'Session object exists, but user has not interacted.',
      // n8n Logic: Calls the greeting endpoint to fetch the initial welcome message/payload. (trigger __greeting__)
      on: {
        USER_MESSAGE: {
          target: 'bot_active',
        },
      },
    },
    bot_active: {
      description:
        'Standard AI conversational mode. UI Behavior: Input enabled. Render markdown + Rich UI Components.',
      // n8n Logic: Main Router -> LLM Node. LLM determines if it should answer, call a tool, or escalate.
      on: {
        ESCALATION_TRIGGER: {
          // LLM Tool triggers liveAgent_requested n8n trigger -> live_agent_queue
          target: 'live_agent_queue',
        },
        END_CMD: {
          // User types __endChat__ or clicks End
          target: 'survey',
        },
        TIMEOUT_DETECTED: {
          // Frontend timer > ENV_VAR
          target: 'timeout',
        },
      },
    },
    live_agent_queue: {
      description:
        'User is waiting for a human. UI Behavior: Input Disabled. Show Queue Position or Spinner.',
      // n8n Logic: Triggers liveAgentQueue n8n endpoint. Loop updates user with queue data every 5 mins.
      on: {
        AGENT_CONNECTED: {
          // Webhook
          target: 'live_agent_active',
        },
        NO_AGENTS: {
          // Timeout/Business Hours -> Create async ticket instead
          target: 'bot_active',
        },
        USER_CANCEL: {
          // Button Click
          target: 'bot_active',
        },
      },
    },
    live_agent_active: {
      description:
        '1:1 tunnel between User and Human Agent. UI Behavior: Input enabled. Agent is typing... indicators.',
      // n8n Logic: Bypass LLM. Route user message payload directly to Agent Platform API. Ghost Check.
      on: {
        AGENT_ENDED: {
          // Webhook
          target: 'survey',
        },
        USER_ENDED: {
          // Button Click
          target: 'survey',
        },
        GHOST_TIMEOUT: {
          // No reply to check
          target: 'timeout',
        },
      },
    },
    survey: {
      description:
        'Post-chat feedback collection. UI Behavior: Chat input replaced by Form/Star Rating component.',
      // n8n Logic: Receives form submission -> Writes to Analytics (BigQuery) -> Updates State.
      on: {
        SURVEY_SUBMITTED: {
          target: 'email_transcript_processing',
        },
        SURVEY_SKIPPED: {
          target: 'email_transcript_processing',
        },
      },
    },
    email_transcript_processing: {
      description:
        'System is generating PDF/HTML transcript and sending via Email Provider. UI Behavior: Show Sending transcript... spinner.',
      // n8n Logic: Calls emailTranscript endpoint. Generates file, calls SendGrid/Gmail.
      on: {
        SUCCESS: {
          target: 'email_transcript_sent',
        },
        FAILURE: {
          target: 'email_transcript_failed',
        },
      },
    },
    timeout: {
      description:
        'Session timed out due to user inactivity. UI Behavior: Show Session Timed Out message. Disable input. Offer Restart button.',
      // n8n Logic: Frontend hits timeout n8n endpoint. n8n updates status to timeout and closes session.
      on: {
        AUTO_TRANSCRIPT: {
          // Optional configuration
          target: 'email_transcript_processing',
        },
        RESTART_CLICK: {
          target: 'idle',
        },
      },
    },
    email_transcript_sent: {
      type: 'final',
      description:
        'Transcript successfully sent. UI Behavior: Show success message. Show Start New Chat button.',
    },
    email_transcript_failed: {
      type: 'final',
      description:
        'Failed to send transcript. UI Behavior: Show error message. Show Start New Chat button.',
    },
  },
});
