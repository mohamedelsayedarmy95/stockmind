import { Product, BalanceResponse, StockMovement } from '@/api/types';

/**
 * Repository contracts — the data-access seam.
 *
 * Use cases and query hooks depend ONLY on these interfaces, never on a concrete
 * source. Today the offline provider returns SQLite-backed implementations; the
 * cloud-sync phase will add API-backed ones with the SAME signatures, so no
 * hook or screen changes when sync lands.
 */

export interface Warehouse {
  id: string;
  name: string;
  isActive?: boolean;
}

export interface NewProduct {
  name: string;
  sku: string;
  barcode?: string | null;
  categoryId?: string | null;
}

export type MovementKind = 'inbound' | 'outbound';

export interface MovementInput {
  kind: MovementKind;
  productId: string;
  warehouseId: string;
  quantity: string;
  notes?: string;
}

export interface ProductRepository {
  list(): Promise<Product[]>;
  create(input: NewProduct): Promise<Product>;
  findByBarcode(barcode: string): Promise<Product | undefined>;
}

export interface WarehouseRepository {
  list(): Promise<Warehouse[]>;
  create(input: { name: string }): Promise<Warehouse>;
  ensureDefault(): Promise<Warehouse>;
}

export interface StockRepository {
  balance(productId: string, warehouseId: string): Promise<BalanceResponse>;
  move(input: MovementInput): Promise<StockMovement>;
  movements(productId: string): Promise<StockMovement[]>;
}

export interface Repositories {
  products: ProductRepository;
  warehouses: WarehouseRepository;
  stock: StockRepository;
}
