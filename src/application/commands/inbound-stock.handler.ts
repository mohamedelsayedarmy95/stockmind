import { CommandHandler, ICommandHandler, EventBus } from '@nestjs/cqrs';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InboundStockCommand } from './inbound-stock.command';
import { StockService } from '../../infrastructure/repositories/stock.service';
import { StockReceivedEvent } from '../../domain/events/stock-received.event';

@CommandHandler(InboundStockCommand)
export class InboundStockHandler implements ICommandHandler<InboundStockCommand> {
  constructor(
    private readonly stock: StockService,
    private readonly events: EventEmitter2,
    private readonly cqrsEventBus: EventBus,
  ) {}

  async execute(cmd: InboundStockCommand) {
    const movement = await this.stock.inbound(cmd.userId, cmd.companyId, cmd.dto);

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

    return movement;
  }
}
