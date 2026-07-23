import { Product } from '../entities/product.entity';

export const PRODUCT_REPOSITORY_TOKEN = Symbol('IProductRepository');

export interface IProductRepository {
  findById(companyId: string, id: string): Promise<Product | null>;
  findAll(companyId: string): Promise<Product[]>;
  findBySku(companyId: string, sku: string): Promise<Product | null>;
  save(product: Partial<Product>): Promise<Product>;
  softDelete(companyId: string, id: string, deletedBy: string): Promise<void>;
}
