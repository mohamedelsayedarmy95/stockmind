import { ICommand } from '@nestjs/cqrs';
import { TransferDto } from '../dtos/stock/transfer.dto';

export class TransferStockCommand implements ICommand {
  constructor(
    public readonly userId: string,
    public readonly companyId: string,
    public readonly dto: TransferDto,
    public readonly correlationId?: string,
  ) {}
}
