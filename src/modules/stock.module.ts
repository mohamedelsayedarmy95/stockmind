import { Module } from '@nestjs/common';
import { StockController } from '../presentation/controllers/stock.controller';
import { OperationLookupService } from '../infrastructure/repositories/operation-lookup.service';
import { CqrsAppModule } from './cqrs-app.module';

@Module({
  imports: [CqrsAppModule],
  controllers: [StockController],
  providers: [OperationLookupService],
})
export class StockModule {}
