import { Module } from '@nestjs/common';
import { StockController } from '../presentation/controllers/stock.controller';
import { CqrsAppModule } from './cqrs-app.module';

@Module({
  imports: [CqrsAppModule],
  controllers: [StockController],
})
export class StockModule {}
