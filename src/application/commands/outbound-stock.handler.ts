import { CommandHandler, ICommandHandler, EventBus } from '@nestjs/cqrs';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OutboundStockCommand } from './outbound-stock.command';
import { StockService } from '../../infrastructure/repositories/stock.service';
import { StockIssuedEvent } from '../../domain/events/stock-issued.event';

@CommandHandler(OutboundStockCommand)
export class OutboundStockHandler implements ICommandHandler<OutboundStockCommand> {
  constructor(
    private readonly stock: StockService,
    private readonly events: EventEmitter2,
    private readonly cqrsEventBus: EventBus,
  ) {}

  async execute(cmd: OutboundStockCommand) {
    const movement = await this.stock.outbound(cmd.userId, cmd.companyId, cmd.dto);

    const event = new StockIssuedEvent(
      cmd.dto.productId,
      cmd.dto.warehouseId,
      cmd.companyId,
      cmd.userId,
      cmd.dto.quantity,
      movement.runningBalance,
      cmd.correlationId,
    );
    this.events.emit(StockIssuedEvent.NAME, event);
    this.cqrsEventBus.publish(event);

    return movement;
  }
}
