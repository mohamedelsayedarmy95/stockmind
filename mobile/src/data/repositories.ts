import { Product, BalanceResponse, StockMovement, ActivityEntry } from '@/api/types';

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

export interface Store {
  id: string;
  warehouseId: string;
  name: string;
  /** Freeform placement on the interactive warehouse map, in canvas px. */
  posX: number | null;
  posY: number | null;
  /** Total on-hand units across all products in this section. */
  totalQuantity: number;
}

export interface NewProduct {
  name: string;
  sku: string;
  barcode?: string | null;
  categoryId?: string | null;
  costPrice?: number | null;
}

export type UpdateProduct = Partial<NewProduct>;

export interface TransferInput {
  productId: string;
  fromWarehouseId: string;
  toWarehouseId: string;
  quantity: string;
  notes?: string;
  /** Optional section-level detail — ignored by the (not-yet-built) backend. */
  fromStoreId?: string;
  toStoreId?: string;
}

/** Per-section breakdown of on-hand quantity for a product within a warehouse. */
export interface StoreBalance {
  storeId: string;
  storeName: string;
  quantity: number;
}

/**
 * Dashboard aggregates. `null` (not 0) means "not computable in this mode
 * yet" — e.g. online mode has no local pending-change queue — so the UI can
 * tell "really zero" apart from "unavailable" instead of showing a fake 0.
 */
export interface DashboardStats {
  stockValue: number | null;
  pendingSyncCount: number | null;
}

export type MovementKind = 'inbound' | 'outbound';

export interface MovementInput {
  kind: MovementKind;
  productId: string;
  warehouseId: string;
  quantity: string;
  notes?: string;
  /** Optional section-level detail — ignored by the (not-yet-built) backend. */
  storeId?: string;
}

export interface ProductRepository {
  list(): Promise<Product[]>;
  create(input: NewProduct): Promise<Product>;
  findByBarcode(barcode: string): Promise<Product | undefined>;
  update(id: string, input: UpdateProduct): Promise<Product>;
  remove(id: string): Promise<void>;
}

export interface WarehouseRepository {
  list(): Promise<Warehouse[]>;
  create(input: { name: string }): Promise<Warehouse>;
  ensureDefault(): Promise<Warehouse>;
}

export interface StoreRepository {
  listByWarehouse(warehouseId: string): Promise<Store[]>;
  create(input: { warehouseId: string; name: string }): Promise<Store>;
  updatePosition(storeId: string, x: number, y: number): Promise<void>;
}

export interface StockRepository {
  balance(productId: string, warehouseId: string): Promise<BalanceResponse>;
  move(input: MovementInput): Promise<StockMovement>;
  movements(productId: string): Promise<StockMovement[]>;
  dashboardStats(): Promise<DashboardStats>;
  transfer(input: TransferInput): Promise<void>;
  storeBreakdown(productId: string, warehouseId: string): Promise<StoreBalance[]>;
}

export interface ActivityRepository {
  list(): Promise<ActivityEntry[]>;
}

export interface Repositories {
  products: ProductRepository;
  warehouses: WarehouseRepository;
  stores: StoreRepository;
  stock: StockRepository;
  activity: ActivityRepository;
}
