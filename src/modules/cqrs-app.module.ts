import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { TypeOrmModule } from '@nestjs/typeorm';

// Entities the handlers depend on (via injected services)
import { Product } from '../domain/entities/product.entity';
import { Warehouse } from '../domain/entities/warehouse.entity';
import { ProductWarehouse } from '../domain/entities/product-warehouse.entity';
import { StockMovement } from '../domain/entities/stock-movement.entity';
import { Category } from '../domain/entities/category.entity';
import { UnitOfMeasure } from '../domain/entities/unit-of-measure.entity';

// Services (infrastructure)
import { ProductService } from '../infrastructure/repositories/product.service';
import { StockService } from '../infrastructure/repositories/stock.service';
import { WarehouseService } from '../infrastructure/repositories/warehouse.service';

// Commands / Handlers
import { InboundStockHandler } from '../application/commands/inbound-stock.handler';
import { OutboundStockHandler } from '../application/commands/outbound-stock.handler';
import { AdjustStockHandler } from '../application/commands/adjust-stock.handler';
import { TransferStockHandler } from '../application/commands/transfer-stock.handler';
import { CreateProductHandler } from '../application/commands/create-product.handler';

// Queries / Handlers
import { GetBalanceHandler } from '../application/queries/get-balance.handler';
import { GetMovementHistoryHandler } from '../application/queries/get-movement-history.handler';
import { GetProductListHandler } from '../application/queries/get-product-list.handler';

// Event Listeners
import { StockReceivedListener } from '../application/event-handlers/stock-received.listener';
import { StockIssuedListener } from '../application/event-handlers/stock-issued.listener';
import { ProductCreatedListener } from '../application/event-handlers/product-created.listener';
import { FirebaseNotificationListener } from '../application/event-handlers/firebase-notification.listener';

const CommandHandlers = [
  InboundStockHandler,
  OutboundStockHandler,
  AdjustStockHandler,
  TransferStockHandler,
  CreateProductHandler,
];

const QueryHandlers = [
  GetBalanceHandler,
  GetMovementHistoryHandler,
  GetProductListHandler,
];

const EventListeners = [
  StockReceivedListener,
  StockIssuedListener,
  ProductCreatedListener,
  FirebaseNotificationListener,
];

@Module({
  imports: [
    CqrsModule,
    TypeOrmModule.forFeature([
      Product, Warehouse, ProductWarehouse, StockMovement, Category, UnitOfMeasure,
    ]),
  ],
  providers: [
    ProductService,
    StockService,
    WarehouseService,
    ...CommandHandlers,
    ...QueryHandlers,
    ...EventListeners,
  ],
  exports: [ProductService, StockService, WarehouseService, CqrsModule],
})
export class CqrsAppModule {}
