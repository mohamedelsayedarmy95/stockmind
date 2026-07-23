import { IQuery } from '@nestjs/cqrs';

export class GetBalanceQuery implements IQuery {
  constructor(
    public readonly companyId: string,
    public readonly productId: string,
    public readonly warehouseId: string,
  ) {}
}
