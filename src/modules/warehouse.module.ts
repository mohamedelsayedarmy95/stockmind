import { Module } from '@nestjs/common';
import { WarehouseController } from '../presentation/controllers/warehouse.controller';
import { CqrsAppModule } from './cqrs-app.module';

@Module({
  imports: [CqrsAppModule],
  controllers: [WarehouseController],
})
export class WarehouseModule {}
