import { QueryHandler, IQueryHandler } from '@nestjs/cqrs';
import { GetMovementHistoryQuery } from './get-movement-history.query';
import { StockService } from '../../infrastructure/repositories/stock.service';
import { WarehouseAccessService } from '../../infrastructure/security/warehouse-access.service';

@QueryHandler(GetMovementHistoryQuery)
export class GetMovementHistoryHandler implements IQueryHandler<GetMovementHistoryQuery> {
  constructor(
    private readonly stock: StockService,
    private readonly access: WarehouseAccessService,
  ) {}

  async execute(q: GetMovementHistoryQuery) {
    const allowed = q.userId ? await this.access.scope(q.userId, q.companyId) : null;
    return this.stock.getMovements(q.companyId, q.productId, undefined, allowed);
  }
}
