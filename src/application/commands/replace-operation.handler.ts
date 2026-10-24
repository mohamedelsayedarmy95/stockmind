import { CommandHandler, ICommandHandler, EventBus } from '@nestjs/cqrs';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ReplaceOperationCommand } from './replace-operation.command';
import { StockReplacementService } from '../../infrastructure/repositories/stock-replacement.service';
import { FcmService } from '../../infrastructure/firebase/fcm.service';
import { StockReceivedEvent } from '../../domain/events/stock-received.event';
import { StockIssuedEvent } from '../../domain/events/stock-issued.event';

/** Same events and push as an ordinary receipt/dispatch: a replacement is a real stock movement. */
@CommandHandler(ReplaceOperationCommand)
export class ReplaceOperationHandler implements ICommandHandler<ReplaceOperationCommand> {
  constructor(
    private readonly replacements: StockReplacementService,
    private readonly events: EventEmitter2,
    private readonly cqrsEventBus: EventBus,
    private readonly fcmService: FcmService,
  ) {}

  async execute(cmd: ReplaceOperationCommand) {
    const result = await this.replacements.replace(cmd.userId, cmd.companyId, cmd.kind, cmd.replacementKey, cmd.dto);
    // A replay wrote nothing: its event and push were sent by the first request.
    if (result.replayed) return result;

    const inbound = cmd.kind === 'inbound';
    const args = [
      cmd.dto.productId, cmd.dto.warehouseId, cmd.companyId, cmd.userId, cmd.dto.quantity, result.runningBalance,
      cmd.correlationId,
    ] as const;
    const event = inbound ? new StockReceivedEvent(...args) : new StockIssuedEvent(...args);
    this.events.emit(inbound ? StockReceivedEvent.NAME : StockIssuedEvent.NAME, event);
    this.cqrsEventBus.publish(event);

    this.fcmService
      .sendStockNotification(cmd.userId, inbound ? 'STOCK_RECEIVED' : 'STOCK_SHIPPED', cmd.dto.productId, parseFloat(cmd.dto.quantity))
      .catch((error) => {
        console.error('Failed to send stock notification:', error);
      });
    return result;
  }
}
