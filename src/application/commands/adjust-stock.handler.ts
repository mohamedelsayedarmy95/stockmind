import { CommandHandler, ICommandHandler, EventBus } from '@nestjs/cqrs';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AdjustStockCommand } from './adjust-stock.command';
import { StockService } from '../../infrastructure/repositories/stock.service';
import { FcmService } from '../../infrastructure/firebase/fcm.service';
import { StockAdjustedEvent } from '../../domain/events/stock-adjusted.event';

@CommandHandler(AdjustStockCommand)
export class AdjustStockHandler implements ICommandHandler<AdjustStockCommand> {
  constructor(
    private readonly stock: StockService,
    private readonly events: EventEmitter2,
    private readonly cqrsEventBus: EventBus,
    private readonly fcmService: FcmService,
  ) {}

  async execute(cmd: AdjustStockCommand) {
    const movement = await this.stock.adjustment(cmd.userId, cmd.companyId, cmd.dto);

    // Published like every stock event (production does the same); no listener writes an audit row for it yet.
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

    // Fire-and-forget push; a failed notification never fails the movement.
    this.fcmService
      .sendStockNotification(cmd.userId, 'STOCK_ADJUSTED', cmd.dto.productId, Math.abs(parseFloat(cmd.dto.quantity)))
      .catch((error) => {
        console.error('Failed to send stock adjusted notification:', error);
      });

    return movement;
  }
}
