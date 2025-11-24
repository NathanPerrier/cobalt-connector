import { Injectable } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';

export enum ChatMode {
  BOT = 'bot_chat',
  AGENT = 'agent_chat',
}

export interface SessionState {
  mode: ChatMode;
  metadata?: Record<string, any>;
  waiting_webhook_url?: string;
}

@Injectable()
export class StateService {
  constructor(private readonly redisService: RedisService) {}

  async getSessionState(sessionId: string): Promise<SessionState> {
    const session = await this.redisService.getSession(sessionId);
    // Default to BOT mode if not set
    return {
      mode: session?.mode || ChatMode.BOT,
      waiting_webhook_url: session?.waiting_webhook_url,
      metadata: session?.metadata || {},
    };
  }

  async updateState(sessionId: string, update: Partial<SessionState>): Promise<void> {
    await this.redisService.setSession(sessionId, update);
  }

  async setMode(sessionId: string, mode: ChatMode): Promise<void> {
    await this.updateState(sessionId, { mode });
  }
}
