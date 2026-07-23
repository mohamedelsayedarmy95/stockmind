import { CommandHandler, ICommandHandler, EventBus } from '@nestjs/cqrs';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CreateProductCommand } from './create-product.command';
import { ProductService } from '../../infrastructure/repositories/product.service';
import { ProductCreatedEvent } from '../../domain/events/product-created.event';

@CommandHandler(CreateProductCommand)
export class CreateProductHandler implements ICommandHandler<CreateProductCommand> {
  constructor(
    private readonly products: ProductService,
    private readonly events: EventEmitter2,
    private readonly cqrsEventBus: EventBus,
  ) {}

  async execute(cmd: CreateProductCommand) {
    const product = await this.products.create(cmd.companyId, cmd.dto);

    const event = new ProductCreatedEvent(
      product.id,
      cmd.companyId,
      cmd.userId,
      product.sku,
      cmd.correlationId,
    );
    this.events.emit(ProductCreatedEvent.NAME, event);
    this.cqrsEventBus.publish(event);

    return product;
  }
}
