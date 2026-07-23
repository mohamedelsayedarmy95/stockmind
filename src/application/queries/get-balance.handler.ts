import { QueryHandler, IQueryHandler } from '@nestjs/cqrs';
import { GetBalanceQuery } from './get-balance.query';
import { StockService } from '../../infrastructure/repositories/stock.service';

@QueryHandler(GetBalanceQuery)
export class GetBalanceHandler implements IQueryHandler<GetBalanceQuery> {
  constructor(private readonly stock: StockService) {}

  execute(q: GetBalanceQuery) {
    return this.stock.getBalance(q.companyId, q.productId, q.warehouseId);
  }
}
