import { CommandHandler, ICommandHandler, EventBus } from '@nestjs/cqrs';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { TransferStockCommand } from './transfer-stock.command';
import { StockService } from '../../infrastructure/repositories/stock.service';
import { StockIssuedEvent } from '../../domain/events/stock-issued.event';
import { StockReceivedEvent } from '../../domain/events/stock-received.event';

@CommandHandler(TransferStockCommand)
export class TransferStockHandler implements ICommandHandler<TransferStockCommand> {
  constructor(
    private readonly stock: StockService,
    private readonly events: EventEmitter2,
    private readonly cqrsEventBus: EventBus,
  ) {}

  async execute(cmd: TransferStockCommand) {
    const result = await this.stock.transfer(cmd.userId, cmd.companyId, cmd.dto);

    const outEvent = new StockIssuedEvent(
      cmd.dto.productId, cmd.dto.fromWarehouseId, cmd.companyId,
      cmd.userId, cmd.dto.quantity, result.out.runningBalance, cmd.correlationId,
    );
    const inEvent = new StockReceivedEvent(
      cmd.dto.productId, cmd.dto.toWarehouseId, cmd.companyId,
      cmd.userId, cmd.dto.quantity, result.in.runningBalance, cmd.correlationId,
    );
    this.events.emit(StockIssuedEvent.NAME, outEvent);
    this.events.emit(StockReceivedEvent.NAME, inEvent);
    this.cqrsEventBus.publish(outEvent);
    this.cqrsEventBus.publish(inEvent);

    return result;
  }
}
