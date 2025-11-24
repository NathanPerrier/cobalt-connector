import { Body, Controller, Post } from '@nestjs/common';
import { EventsGateway } from '../events/events.gateway';

@Controller('api/internal')
export class InternalController {
  constructor(private readonly eventsGateway: EventsGateway) {}

  @Post('message')
  async sendMessageToClient(@Body() body: { sessionId: string; type: string; content: string }) {
    console.log('Received internal message for client:', body);
    this.eventsGateway.sendMessageToClient(body.sessionId, {
      type: body.type,
      content: body.content,
    });
    return { success: true };
  }
}
