import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { CreateProductCommand } from './create-product.command';
import { ProductService } from '../../infrastructure/repositories/product.service';

@CommandHandler(CreateProductCommand)
export class CreateProductHandler implements ICommandHandler<CreateProductCommand> {
  constructor(private readonly products: ProductService) {}

  async execute(cmd: CreateProductCommand) {
    return this.products.create(cmd.companyId, cmd.dto);
  }
}