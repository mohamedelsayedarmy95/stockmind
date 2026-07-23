import { ICommand } from '@nestjs/cqrs';
import { CreateProductDto } from '../dtos/product/create-product.dto';

export class CreateProductCommand implements ICommand {
  constructor(
    public readonly userId: string,
    public readonly companyId: string,
    public readonly dto: CreateProductDto,
    public readonly correlationId?: string,
  ) {}
}
