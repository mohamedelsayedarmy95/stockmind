import { ICommand } from '@nestjs/cqrs';
import { AdjustmentDto } from '../dtos/stock/adjustment.dto';

export class AdjustStockCommand implements ICommand {
  constructor(
    public readonly userId: string,
    public readonly companyId: string,
    public readonly dto: AdjustmentDto,
    public readonly correlationId?: string,
    // Client-chosen Idempotency-Key: a retry with the same key replays the first result.
    public readonly idempotencyKey?: string,
  ) {}
}
