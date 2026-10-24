import { Module } from '@nestjs/common';
import { StockController } from '../presentation/controllers/stock.controller';
import { OperationLookupService } from '../infrastructure/repositories/operation-lookup.service';
import { HistoryGenerationService } from '../infrastructure/repositories/history-generation.service';
import { RecoveryController } from '../presentation/controllers/recovery.controller';
import { CqrsAppModule } from './cqrs-app.module';

@Module({
  imports: [CqrsAppModule],
  controllers: [StockController, RecoveryController],
  providers: [OperationLookupService, HistoryGenerationService],
})
export class StockModule {}
