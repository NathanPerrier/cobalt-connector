import { Module } from '@nestjs/common';
import { InternalController } from './internal.controller';
import { EventsModule } from '../events/events.module';

@Module({
  imports: [EventsModule],
  controllers: [InternalController],
})
export class InternalModule {}
