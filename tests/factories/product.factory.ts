import { randomUUID } from 'crypto';
import { Product } from '../../src/domain/entities/product.entity';

export function makeProduct(overrides: Partial<Product> = {}): Product {
  const p = new Product();
  p.id = randomUUID();
  p.publicId = randomUUID();
  p.companyId = overrides.companyId ?? randomUUID();
  p.name = overrides.name ?? 'Test Product';
  p.sku = overrides.sku ?? `SKU-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  p.barcode = overrides.barcode ?? null;
  p.imageUrl = null;
  p.weight = null;
  p.volume = null;
  p.expiryDate = null;
  p.categoryId = null;
  p.deletedAt = null;
  p.deletedBy = null;
  p.version = 1;
  p.createdAt = new Date();
  Object.assign(p, overrides);
  return p;
}
