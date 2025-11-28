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
  constructor(
    private readonly appService: AppService,
  ) {}

  @Post('trigger')
  async trigger(@Body() payload: any) {
    const { sessionId, ...data } = payload;
    if (!sessionId) {
      throw new BadRequestException('sessionId is required');
    }
    // Use the new AppService with State Machine
    await this.appService.handleTrigger(sessionId, data);
    return { success: true };
  }

  @Post('api/internal/message')
  async handleInternalMessage(@Body() payload: any) {
    const { sessionId, ...message } = payload;
    if (!sessionId) {
      throw new BadRequestException('sessionId is required');
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
