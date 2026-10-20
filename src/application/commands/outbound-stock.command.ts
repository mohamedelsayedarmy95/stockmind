import { ICommand } from '@nestjs/cqrs';
import { OutboundDto } from '../dtos/stock/outbound.dto';

export class OutboundStockCommand implements ICommand {
  constructor(
    public readonly userId: string,
    public readonly companyId: string,
    public readonly dto: OutboundDto,
    public readonly correlationId?: string,
    // Client-chosen Idempotency-Key: a retry with the same key replays the first result.
    public readonly idempotencyKey?: string,
  ) {}
}
