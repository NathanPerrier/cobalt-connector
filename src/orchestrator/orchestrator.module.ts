import { Module } from '@nestjs/common';
import { OrchestratorService } from './orchestrator.service';
import { StateModule } from '../state/state.module';

@Module({
  imports: [StateModule],
  providers: [OrchestratorService],
  exports: [OrchestratorService],
})
export class OrchestratorModule {}
