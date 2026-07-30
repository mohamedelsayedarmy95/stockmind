import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { AdjustStockCommand } from './adjust-stock.command';
import { StockService } from '../../infrastructure/repositories/stock.service';
import { FcmService } from '../../infrastructure/firebase/fcm.service';

@CommandHandler(AdjustStockCommand)
export class AdjustStockHandler implements ICommandHandler<AdjustStockCommand> {
  constructor(
    private readonly stock: StockService,
    private readonly fcmService: FcmService,
  ) {}

  async execute(command: AdjustStockCommand) {
    const { userId, companyId, dto } = command;
    const result = await this.stock.adjustment(userId, companyId, dto);

    // Send fire-and-forget notification
    const quantity = Math.abs(parseFloat(dto.quantity));
    this.fcmService
      .sendStockNotification(userId, 'STOCK_ADJUSTED', dto.productId, quantity)
      .catch((error) => {
        console.error('Failed to send stock adjusted notification:', error);
      });

    return result;
  }
}