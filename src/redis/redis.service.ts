import { Injectable } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisService {
  private readonly redis: Redis;

  constructor() {
    // TODO: Use environment variables for host/port
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
    });
  }

  async setSession(socketId: string, data: any): Promise<void> {
    // Merge with existing data if possible, or just overwrite
    // For now, simple overwrite or merge logic
    const existing = await this.getSession(socketId) || {};
    const merged = { ...existing, ...data };
    await this.redis.set(`session:${socketId}`, JSON.stringify(merged));
  }

  async getSession(socketId: string): Promise<any> {
    const data = await this.redis.get(`session:${socketId}`);
    return data ? JSON.parse(data) : null;
  }

  async deleteSession(socketId: string): Promise<void> {
    await this.redis.del(`session:${socketId}`);
  }
}
