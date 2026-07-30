import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { OutboundStockCommand } from './outbound-stock.command';
import { StockService } from '../../infrastructure/repositories/stock.service';
import { FcmService } from '../../infrastructure/firebase/fcm.service';

@CommandHandler(OutboundStockCommand)
export class OutboundStockHandler implements ICommandHandler<OutboundStockCommand> {
  constructor(
    private readonly stock: StockService,
    private readonly fcmService: FcmService,
  ) {}

  async execute(command: OutboundStockCommand) {
    const { userId, companyId, dto } = command;
    const result = await this.stock.outbound(userId, companyId, dto);

    // Send fire-and-forget notification
    this.fcmService
      .sendStockNotification(userId, 'STOCK_SHIPPED', dto.productId, parseFloat(dto.quantity))
      .catch((error) => {
        console.error('Failed to send stock shipped notification:', error);
      });

    return result;
  }
}