import { CommandHandler, ICommandHandler, EventBus } from '@nestjs/cqrs';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InboundStockCommand } from './inbound-stock.command';
import { StockService } from '../../infrastructure/repositories/stock.service';
import { FcmService } from '../../infrastructure/firebase/fcm.service';
import { StockReceivedEvent } from '../../domain/events/stock-received.event';

@CommandHandler(InboundStockCommand)
export class InboundStockHandler implements ICommandHandler<InboundStockCommand> {
  constructor(
    private readonly stock: StockService,
    private readonly events: EventEmitter2,
    private readonly cqrsEventBus: EventBus,
    private readonly fcmService: FcmService,
  ) {}

  async execute(cmd: InboundStockCommand) {
    const movement = await this.stock.inbound(cmd.userId, cmd.companyId, cmd.dto);

    // The listeners write the STOCK_RECEIVED audit row; the event is part of the write, not optional.
    const event = new StockReceivedEvent(
      cmd.dto.productId,
      cmd.dto.warehouseId,
      cmd.companyId,
      cmd.userId,
      cmd.dto.quantity,
      movement.runningBalance,
      cmd.correlationId,
    );
    this.events.emit(StockReceivedEvent.NAME, event);
    this.cqrsEventBus.publish(event);

    // Fire-and-forget push; a failed notification never fails the movement.
    this.fcmService
      .sendStockNotification(cmd.userId, 'STOCK_RECEIVED', cmd.dto.productId, parseFloat(cmd.dto.quantity))
      .catch((error) => {
        console.error('Failed to send stock received notification:', error);
      });

    return movement;
  }
}
