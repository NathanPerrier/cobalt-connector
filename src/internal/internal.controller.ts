import { Body, Controller, Post, Logger } from '@nestjs/common';
import { EventsGateway } from '../events/events.gateway';
import { StateService, ChatMode } from '../state/state.service';

@Controller('api/internal')
export class InternalController {
  private readonly logger = new Logger(InternalController.name);

  constructor(
    private readonly eventsGateway: EventsGateway,
    private readonly stateService: StateService,
  ) {}

  @Post('message')
  async sendMessageToClient(@Body() body: { sessionId: string; type: string; content: string }) {
    this.logger.log(`Received internal message for client ${body.sessionId}`);
    this.eventsGateway.sendMessageToClient(body.sessionId, {
      type: body.type,
      content: body.content,
    });
    return { success: true };
  }

  @Post('agent_chat')
  async switchToAgentChat(@Body() body: { sessionId: string }) {
    this.logger.log(`Switching session ${body.sessionId} to AGENT mode`);
    await this.stateService.setMode(body.sessionId, ChatMode.AGENT);
    return { success: true, mode: ChatMode.AGENT };
  }

  @Post('bot_chat')
  async switchToBotChat(@Body() body: { sessionId: string }) {
    this.logger.log(`Switching session ${body.sessionId} to BOT mode`);
    await this.stateService.setMode(body.sessionId, ChatMode.BOT);
    return { success: true, mode: ChatMode.BOT };
  }

  @Post('firebase')
  async triggerFirebase(@Body() body: { sessionId: string; action?: string }) {
    this.logger.log(`Triggering Firebase action for session ${body.sessionId}`);
    // Store firebase trigger in metadata for now
    await this.stateService.updateState(body.sessionId, {
      metadata: { firebase_active: true, last_action: 'firebase' }
    });
    return { success: true, message: 'Firebase trigger recorded' };
  }

  @Post('endchat_trigger')
  async triggerEndChat(@Body() body: { sessionId: string }) {
    this.logger.log(`Ending chat for session ${body.sessionId}`);
    // Reset state or mark as ended
    await this.stateService.updateState(body.sessionId, {
      mode: ChatMode.BOT, // Revert to bot? or specific ENDED state?
      waiting_webhook_url: undefined,
      metadata: { ended: true }
    });
    return { success: true, message: 'Chat ended' };
  }

  @Post('email_trigger')
  async triggerEmail(@Body() body: { sessionId: string; email: string }) {
    this.logger.log(`Triggering email for session ${body.sessionId}`);
    await this.stateService.updateState(body.sessionId, {
      metadata: { email_trigger: true, email: body.email }
    });
    return { success: true, message: 'Email trigger recorded' };
  }
}
