import { IQuery } from '@nestjs/cqrs';

export class GetProductListQuery implements IQuery {
  constructor(public readonly companyId: string) {}
}
