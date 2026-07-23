import { IQuery } from '@nestjs/cqrs';

export class GetMovementHistoryQuery implements IQuery {
  constructor(
    public readonly companyId: string,
    public readonly productId: string,
  ) {}
}
