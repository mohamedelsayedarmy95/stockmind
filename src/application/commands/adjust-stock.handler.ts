import { CommandHandler, ICommandHandler, EventBus } from '@nestjs/cqrs';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AdjustStockCommand } from './adjust-stock.command';
import { StockService } from '../../infrastructure/repositories/stock.service';
import { StockAdjustedEvent } from '../../domain/events/stock-adjusted.event';

@CommandHandler(AdjustStockCommand)
export class AdjustStockHandler implements ICommandHandler<AdjustStockCommand> {
  constructor(
    private readonly stock: StockService,
    private readonly events: EventEmitter2,
    private readonly cqrsEventBus: EventBus,
  ) {}

  async execute(cmd: AdjustStockCommand) {
    const movement = await this.stock.adjustment(cmd.userId, cmd.companyId, cmd.dto);

    const event = new StockAdjustedEvent(
      cmd.dto.productId,
      cmd.dto.warehouseId,
      cmd.companyId,
      cmd.userId,
      cmd.dto.quantity,
      movement.runningBalance,
      cmd.dto.reason,
      cmd.correlationId,
    );
    this.events.emit(StockAdjustedEvent.NAME, event);
    this.cqrsEventBus.publish(event);

    return movement;
  }
}
