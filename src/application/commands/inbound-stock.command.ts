import { ICommand } from '@nestjs/cqrs';
import { InboundDto } from '../dtos/stock/inbound.dto';

export class InboundStockCommand implements ICommand {
  constructor(
    public readonly userId: string,
    public readonly companyId: string,
    public readonly dto: InboundDto,
    public readonly correlationId?: string,
  ) {}
}
