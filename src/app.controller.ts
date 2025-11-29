import {
  Controller,
  Post,
  Body,
  Sse,
  Query,
  MessageEvent,
  BadRequestException,
} from '@nestjs/common';
import { AppService } from './app.service';
import { Observable } from 'rxjs';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Post('trigger')
  async trigger(@Body() payload: Record<string, unknown>) {
    const { sessionId, ...data } = payload;
    if (typeof sessionId !== 'string') {
      throw new BadRequestException('sessionId must be a string');
    }
    // Use the new AppService with State Machine
    await this.appService.handleTrigger(sessionId, data);
    return { success: true };
  }

  @Post('api/internal/message')
  handleInternalMessage(@Body() payload: Record<string, unknown>) {
    const { sessionId, ...message } = payload;
    if (typeof sessionId !== 'string') {
      throw new BadRequestException('sessionId must be a string');
    }
    this.appService.injectMessage(sessionId, message);
    return { success: true };
  }

  @Sse('stream')
  stream(@Query('sessionId') sessionId: string): Observable<MessageEvent> {
    console.log(`Stream request received. SessionId: '${sessionId}'`);
    if (!sessionId) {
      console.error('SessionId is missing or empty');
      throw new BadRequestException('sessionId is required');
    }
    return this.appService.getSessionStream(sessionId);
  }
}
