import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StateService, ChatMode } from '../state/state.service';
import axios from 'axios';

@Injectable()
export class OrchestratorService {
  private readonly logger = new Logger(OrchestratorService.name);

  constructor(
    private readonly stateService: StateService,
    private readonly configService: ConfigService,
  ) {}

  async handleUserMessage(sessionId: string, message: string) {
    this.logger.log(`Handling message for session ${sessionId}: ${message}`);

    const state = await this.stateService.getSessionState(sessionId);

    // We route to n8n regardless of mode, letting the workflow handle the logic based on the 'mode' field.
    // if (state.mode === ChatMode.AGENT) {
    //   this.logger.log(`Routing message to Live Agent for session ${sessionId}`);
    //   // TODO: Implement Firebase/Live Agent routing
    //   return;
    // }

    // Default to BOT mode logic
    if (state.waiting_webhook_url) {
      this.logger.log(`Resuming workflow for session ${sessionId}`);
      try {
        await axios.post(state.waiting_webhook_url, {
          sessionId,
          message,
          mode: state.mode,
          endchat: state.metadata?.endchat || false,
          emailRequested: state.metadata?.emailRequested || false,
          liveAgentRequested: state.metadata?.liveAgentRequested || false,
          ...state.metadata,
        });
      } catch (error) {
        this.logger.error(`Failed to resume workflow: ${error.message}`);
      }
    } else {
      this.logger.log(`Starting new workflow for session ${sessionId}`);
      // TODO: Lookup the correct Start Webhook URL for the bot associated with this session
      // For now, we assume a default webhook URL for testing
      const startWebhookUrl = this.configService.get<string>('N8N_WEBHOOK_URL') || 'http://localhost:5678/webhook/c1dd680a-69a2-4788-a6a2-06f33306a2c1/cobalt-start';
      
      try {
        await axios.post(startWebhookUrl, {
          sessionId,
          message,
          mode: state.mode,
          endchat: state.metadata?.endchat || false,
          emailRequested: state.metadata?.emailRequested || false,
          liveAgentRequested: state.metadata?.liveAgentRequested || false,
          ...state.metadata,
        });
      } catch (error) {
        this.logger.error(`Failed to start workflow: ${error.message}`);
      }
    }
  }
}
