import { QueryHandler, IQueryHandler } from '@nestjs/cqrs';
import { GetMovementHistoryQuery } from './get-movement-history.query';
import { StockService } from '../../infrastructure/repositories/stock.service';

@QueryHandler(GetMovementHistoryQuery)
export class GetMovementHistoryHandler implements IQueryHandler<GetMovementHistoryQuery> {
  constructor(private readonly stock: StockService) {}

  execute(q: GetMovementHistoryQuery) {
    return this.stock.getMovements(q.companyId, q.productId);
  }
}
