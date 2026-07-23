import { Module } from '@nestjs/common';
import { ProductController } from '../presentation/controllers/product.controller';
import { CqrsAppModule } from './cqrs-app.module';

@Module({
  imports: [CqrsAppModule],
  controllers: [ProductController],
})
export class ProductModule {}
