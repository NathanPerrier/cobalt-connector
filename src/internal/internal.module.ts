import { Module } from '@nestjs/common';
import { InternalController } from './internal.controller';
import { EventsModule } from '../events/events.module';
import { StateModule } from '../state/state.module';

@Module({
  imports: [EventsModule, StateModule],
  controllers: [InternalController],
})
export class InternalModule {}
