import { IQuery } from '@nestjs/cqrs';

export class GetMovementHistoryQuery implements IQuery {
  constructor(
    public readonly companyId: string,
    public readonly productId: string,
    // The viewer: a Staff member only sees movements of the warehouses they were granted.
    public readonly userId?: string,
  ) {}
}
