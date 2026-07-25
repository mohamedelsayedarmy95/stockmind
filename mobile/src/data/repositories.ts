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
  /** Weight of ONE unit — enables counting a pile by total weight. */
  unitWeightKg?: number | null;
  lifecycleStatus?: string | null;
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

// ── Product Constitution ch.3: hierarchy, batches, serials, reservations ────

/** Physical container levels, coarsest → finest. */
export type StorageUnitType = 'pallet' | 'rack' | 'shelf' | 'bin' | 'carton' | 'unit';

export const STORAGE_UNIT_TYPES: StorageUnitType[] = [
  'pallet',
  'rack',
  'shelf',
  'bin',
  'carton',
  'unit',
];

/**
 * A node in a section's storage tree. `path` is the materialized ancestry
 * ('/rootId/childId/selfId/'), so a subtree is one `LIKE '/id/%'` scan.
 */
export interface StorageUnit {
  id: string;
  warehouseId: string;
  storeId: string;
  parentId: string | null;
  name: string;
  unitType: StorageUnitType;
  path: string;
  depth: number;
  sortOrder: number;
  /** On-hand quantity held by this unit and everything beneath it. */
  totalQuantity: number;
}

export interface NewStorageUnit {
  warehouseId: string;
  storeId: string;
  parentId?: string | null;
  name: string;
  unitType: StorageUnitType;
}

/** A lot of one product. Expiry drives FEFO; receipt date drives FIFO/LIFO. */
export interface Batch {
  id: string;
  productId: string;
  batchCode: string;
  expiryDate: string | null;
  receivedAt: string;
  /** On-hand quantity of this batch in the warehouse that was queried. */
  quantity: number;
}

/**
 * Dispatch strategy.
 *   fefo — first expired, first out (batches with no expiry go last)
 *   fifo — oldest receipt first
 *   lifo — newest receipt first
 */
export type PickStrategy = 'fefo' | 'fifo' | 'lifo';

export const PICK_STRATEGIES: PickStrategy[] = ['fefo', 'fifo', 'lifo'];

/** How a dispatch was actually satisfied, batch by batch. */
export interface PickLine {
  batchId: string;
  batchCode: string;
  quantity: number;
}

export interface Serial {
  id: string;
  productId: string;
  serialNumber: string;
  batchId: string | null;
  status: string;
  warehouseId: string | null;
}

export interface SerialMovementEntry {
  id: string;
  action: string;
  note: string | null;
  createdAt: string;
}

export type ReservationStatus = 'active' | 'released' | 'fulfilled';

export interface Reservation {
  id: string;
  productId: string;
  warehouseId: string;
  batchId: string | null;
  quantity: number;
  status: ReservationStatus;
  reference: string | null;
  createdAt: string;
}

/**
 * On-hand vs. actually-issuable. Reservations hold stock without deducting
 * it, so `available` is what a new dispatch may consume.
 */
export interface AvailabilitySnapshot {
  onHand: number;
  reserved: number;
  available: number;
}

/** Product lifecycle states (constitution ch.3 art.1). */
export type ProductLifecycle =
  | 'active'
  | 'quarantined'
  | 'expired'
  | 'reserved'
  | 'quality_check'
  | 'disposed'
  | 'blocked'
  | 'lost'
  | 'damaged'
  | 'returned';

export const PRODUCT_LIFECYCLES: ProductLifecycle[] = [
  'active',
  'quarantined',
  'expired',
  'reserved',
  'quality_check',
  'disposed',
  'blocked',
  'lost',
  'damaged',
  'returned',
];

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
  /** Storage unit (pallet/shelf/bin) the stock lands in or leaves from. */
  storageUnitId?: string;
  /** INBOUND: lot code to receive under. Created on first use. */
  batchCode?: string;
  /** INBOUND: expiry for the lot above (epoch millis). Drives FEFO later. */
  expiryDate?: number | null;
  /** OUTBOUND: how to choose which lots to consume. Defaults to FEFO. */
  pickStrategy?: PickStrategy;
  /** Serial numbers being received or issued alongside this movement. */
  serialNumbers?: string[];
}

/** Result of a movement, including which lots a dispatch actually drew from. */
export interface MovementResult extends StockMovement {
  picks?: PickLine[];
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
  move(input: MovementInput): Promise<MovementResult>;
  movements(productId: string): Promise<StockMovement[]>;
  dashboardStats(): Promise<DashboardStats>;
  transfer(input: TransferInput): Promise<void>;
  storeBreakdown(productId: string, warehouseId: string): Promise<StoreBalance[]>;
  /** On-hand vs reserved vs issuable for a product in one warehouse. */
  availability(productId: string, warehouseId: string): Promise<AvailabilitySnapshot>;
}

export interface StorageUnitRepository {
  /** Whole tree for a section, ordered so parents precede their children. */
  listByStore(storeId: string): Promise<StorageUnit[]>;
  create(input: NewStorageUnit): Promise<StorageUnit>;
  /** Removes the unit and everything beneath it. */
  remove(id: string): Promise<void>;
}

export interface BatchRepository {
  /** Lots of a product that still hold stock in the given warehouse. */
  listByProduct(productId: string, warehouseId: string): Promise<Batch[]>;
}

export interface SerialRepository {
  listByProduct(productId: string): Promise<Serial[]>;
  history(serialId: string): Promise<SerialMovementEntry[]>;
}

export interface ReservationRepository {
  listByProduct(productId: string, warehouseId: string): Promise<Reservation[]>;
  create(input: {
    productId: string;
    warehouseId: string;
    quantity: number;
    reference?: string | null;
  }): Promise<Reservation>;
  release(id: string): Promise<void>;
  fulfill(id: string): Promise<void>;
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
  storageUnits: StorageUnitRepository;
  batches: BatchRepository;
  serials: SerialRepository;
  reservations: ReservationRepository;
}
