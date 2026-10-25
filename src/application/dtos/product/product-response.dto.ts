import { Product } from '../../../domain/entities/product.entity';

/**
 * Public shape of a product in API responses (Series 09 / S0).
 *
 * Explicit allowlist, same pattern as MovementResponseDto: a column the Product entity gains later is NOT serialized until
 * it is added here on purpose. `costPrice` is the one financial field and is present ONLY for a caller holding
 * `item.view_cost` — for everyone else the KEY IS ABSENT (not null), so a client cannot tell "hidden" from "never set"
 * and cannot confuse a missing price with a zero one. Soft-delete bookkeeping (deletedAt/deletedBy) is internal and is
 * not part of the contract.
 */
export interface ProductResponseDto {
  id: string;
  publicId: string;
  companyId: string;
  name: string;
  sku: string;
  barcode: string | null;
  imageUrl: string | null;
  categoryId: string | null;
  category?: { id: string; name: string; parentId: string | null } | null;
  weight: string | null;
  volume: string | null;
  expiryDate: Date | null;
  version: number;
  createdAt: Date;
  unitsOfMeasure?: Array<{ id: string; uomType: string; code: string; conversionFactorToBase: string }>;
  /** Present only when the caller may view cost. */
  costPrice?: string | null;
}

export function toProductResponse(product: Product, opts: { includeCost: boolean }): ProductResponseDto {
  const out: ProductResponseDto = {
    id: product.id,
    publicId: product.publicId,
    companyId: product.companyId,
    name: product.name,
    sku: product.sku,
    barcode: product.barcode,
    imageUrl: product.imageUrl,
    categoryId: product.categoryId,
    weight: product.weight,
    volume: product.volume,
    expiryDate: product.expiryDate,
    version: product.version,
    createdAt: product.createdAt,
  };
  if (product.category !== undefined) {
    out.category = product.category
      ? { id: product.category.id, name: product.category.name, parentId: product.category.parentId }
      : null;
  }
  if (product.unitsOfMeasure !== undefined) {
    out.unitsOfMeasure = product.unitsOfMeasure.map((u) => ({
      id: u.id,
      uomType: u.uomType,
      code: u.code,
      conversionFactorToBase: u.conversionFactorToBase,
    }));
  }
  if (opts.includeCost) out.costPrice = product.costPrice;
  return out;
}
