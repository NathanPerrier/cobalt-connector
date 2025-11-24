import { Module } from '@nestjs/common';
import { EventsGateway } from './events.gateway';
import { OrchestratorModule } from '../orchestrator/orchestrator.module';

@Module({
  imports: [OrchestratorModule],
  providers: [EventsGateway],
  exports: [EventsGateway],
})
export class EventsModule {}
