import { QueryHandler, IQueryHandler } from '@nestjs/cqrs';
import { GetProductListQuery } from './get-product-list.query';
import { ProductService } from '../../infrastructure/repositories/product.service';

@QueryHandler(GetProductListQuery)
export class GetProductListHandler implements IQueryHandler<GetProductListQuery> {
  constructor(private readonly products: ProductService) {}

  execute(q: GetProductListQuery) {
    return this.products.findAll(q.companyId);
  }
}
