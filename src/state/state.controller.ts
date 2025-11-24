import { Body, Controller, Post, Logger } from '@nestjs/common';
import { StateService, ChatMode } from './state.service';

@Controller('api/state')
export class StateController {
  private readonly logger = new Logger(StateController.name);

  constructor(private readonly stateService: StateService) {}

  @Post('agent')
  async setAgentMode(@Body() body: { sessionId: string }) {
    this.logger.log(`Setting session ${body.sessionId} to AGENT mode`);
    const currentState = await this.stateService.getSessionState(body.sessionId);
    const newMetadata = { ...currentState.metadata, liveAgentRequested: true };
    await this.stateService.updateState(body.sessionId, { 
      mode: ChatMode.AGENT,
      metadata: newMetadata
    });
    return { success: true, mode: ChatMode.AGENT };
  }

  @Post('bot')
  async setBotMode(@Body() body: { sessionId: string }) {
    this.logger.log(`Setting session ${body.sessionId} to BOT mode`);
    await this.stateService.setMode(body.sessionId, ChatMode.BOT);
    return { success: true, mode: ChatMode.BOT };
  }

  @Post('datastore')
  async addToDatastore(@Body() body: { sessionId: string; payload?: any }) {
    this.logger.log(`Adding to datastore for session ${body.sessionId}`);
    if (body.payload) {
      const currentState = await this.stateService.getSessionState(body.sessionId);
      const newMetadata = { ...currentState.metadata, ...body.payload };
      await this.stateService.updateState(body.sessionId, { metadata: newMetadata });
    }
    return { success: true, action: 'added_to_datastore' };
  }

  @Post('end')
  async endChat(@Body() body: { sessionId: string }) {
    this.logger.log(`Ending chat for session ${body.sessionId}`);
    const currentState = await this.stateService.getSessionState(body.sessionId);
    const newMetadata = { ...currentState.metadata, endchat: true };
    await this.stateService.updateState(body.sessionId, { 
      mode: ChatMode.BOT, 
      waiting_webhook_url: undefined,
      metadata: newMetadata
    });
    return { success: true, action: 'end_chat' };
  }

  @Post('email')
  async triggerEmail(@Body() body: { sessionId: string; payload?: any }) {
    this.logger.log(`Triggering email for session ${body.sessionId}`);
    const currentState = await this.stateService.getSessionState(body.sessionId);
    const newMetadata = { ...currentState.metadata, emailRequested: true, ...body.payload };
    await this.stateService.updateState(body.sessionId, { metadata: newMetadata });
    return { success: true, action: 'email_triggered' };
  }
}
