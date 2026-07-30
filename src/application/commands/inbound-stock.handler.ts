import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { InboundStockCommand } from './inbound-stock.command';
import { StockService } from '../../infrastructure/repositories/stock.service';
import { FcmService } from '../../infrastructure/firebase/fcm.service';

@CommandHandler(InboundStockCommand)
export class InboundStockHandler implements ICommandHandler<InboundStockCommand> {
  constructor(
    private readonly stock: StockService,
    private readonly fcmService: FcmService,
  ) {}

  async execute(command: InboundStockCommand) {
    const { userId, companyId, dto } = command;
    const result = await this.stock.inbound(userId, companyId, dto);

    // Send fire-and-forget notification
    this.fcmService
      .sendStockNotification(userId, 'STOCK_RECEIVED', dto.productId, parseFloat(dto.quantity))
      .catch((error) => {
        console.error('Failed to send stock received notification:', error);
      });

    return result;
  }
}