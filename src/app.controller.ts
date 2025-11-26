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
  async trigger(@Body() payload: any) {
    return this.appService.triggerAction(payload);
  }

  @Post('api/internal/message')
  async handleInternalMessage(@Body() payload: any) {
    const { sessionId, ...message } = payload;
    if (!sessionId) {
      throw new BadRequestException('sessionId is required');
    }
    return this.appService.saveMessage(sessionId, message);
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
