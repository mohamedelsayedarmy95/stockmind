import { randomUUID } from 'expo-crypto';
import { api } from '@/api/client';
import { Product, BalanceResponse, StockMovement, ActivityEntry } from '@/api/types';
import { httpStatusOf } from '@/domain/auth-flow';
import { sendIdempotent } from '@/domain/idempotent-write';
import { StockIntent } from '@/domain/outbox';
import { submitIntent } from '@/sync/outbox-drain';
import { withReferenceFallback } from '@/sync/reference-cache';

/** A queued intent the server refused (or whose outcome needs review); shaped like an HTTP error for the screens. */
export class IntentRefusedError extends Error {
  readonly response: { status: number | undefined };
  constructor(readonly intent: StockIntent) {
    super(`INTENT_${intent.state}`);
    this.name = 'IntentRefusedError';
    this.response = { status: intent.lastError?.status ?? undefined };
  }
}
import {
  ProductRepository,
  WarehouseRepository,
  StoreRepository,
  StockRepository,
  ActivityRepository,
  Warehouse,
  Store,
  NewProduct,
  UpdateProduct,
  MovementInput,
  MovementResult,
  TransferInput,
  DashboardStats,
  StoreBalance,
  StorageUnitRepository,
  BatchRepository,
  SerialRepository,
  ReservationRepository,
  StorageUnit,
  NewStorageUnit,
  Batch,
  Serial,
  SerialMovementEntry,
  Reservation,
  AvailabilitySnapshot,
  Repositories,
} from '../repositories';

/**
 * Cloud-backed repositories — the SAME contracts as the local ones, wrapping the
 * existing HTTP client. Kept ISOLATED here so the Online mode (and the future
 * sync layer) can use them without any change to hooks or screens. Not the
 * active path in the offline-first phase.
 */

class ApiProductRepository implements ProductRepository {
  async list(): Promise<Product[]> {
    return withReferenceFallback('products', async () => (await api.get<Product[]>('/products')).data);
  }
  async create(input: NewProduct): Promise<Product> {
    const { data } = await api.post<Product>('/products', input);
    return data;
  }
  async findByBarcode(barcode: string): Promise<Product | undefined> {
    const list = await this.list();
    return list.find((p) => p.barcode === barcode);
  }
  async update(id: string, input: UpdateProduct): Promise<Product> {
    // Backend UpdateProductDto doesn't expose costPrice, so it's dropped here.
    const { costPrice: _costPrice, ...rest } = input;
    const { data } = await api.patch<Product>(`/products/${id}`, rest);
    return data;
  }
  async remove(id: string): Promise<void> {
    await api.delete(`/products/${id}`);
  }
}

class ApiWarehouseRepository implements WarehouseRepository {
  async list(): Promise<Warehouse[]> {
    return withReferenceFallback('warehouses', async () => (await api.get<Warehouse[]>('/warehouses')).data);
  }
  async create(input: { name: string }): Promise<Warehouse> {
    const { data } = await api.post<Warehouse>('/warehouses', input);
    return data;
  }
  async ensureDefault(): Promise<Warehouse> {
    // The server creates a company's first warehouse at registration, and a Staff member only sees the warehouses
    // granted to them: an empty list means "no access", never "create one".
    const list = await this.list();
    if (list.length > 0) return list.find((w) => w.isActive !== false) ?? list[0];
    throw new Error('NO_WAREHOUSE_ACCESS');
  }
}

/**
 * Every online stock write carries an Idempotency-Key: the caller's key for this user action when it has one (so a
 * manual retry reuses it), otherwise a fresh one. Transient failures are retried with the same key; the server
 * replays the first result instead of moving the stock twice.
 */
function postStockWrite<T>(path: string, body: object, key: string | undefined): Promise<T> {
  return sendIdempotent(
    key ?? randomUUID(),
    async (k) => (await api.post<T>(path, body, { headers: { 'Idempotency-Key': k } })).data,
    { statusOf: httpStatusOf },
  );
}

class ApiStoreRepository implements StoreRepository {
  // No backend endpoint for warehouse sub-stores yet — report empty rather
  // than fabricate rows.
  async listByWarehouse(_warehouseId: string): Promise<Store[]> {
    return [];
  }
  async create(input: { warehouseId: string; name: string }): Promise<Store> {
    const { data } = await api.post<Store>(`/warehouses/${input.warehouseId}/stores`, {
      name: input.name,
    });
    return data;
  }
  // Map layout is a local-only concept until sections sync to the backend.
  async updatePosition(): Promise<void> {}
}

class ApiStockRepository implements StockRepository {
  async balance(productId: string, warehouseId: string): Promise<BalanceResponse> {
    const { data } = await api.get<BalanceResponse>(`/stock/balance/${productId}/${warehouseId}`);
    return data;
  }
  async move(input: MovementInput): Promise<MovementResult> {
    // The backend's inbound/outbound DTOs are whitelist-validated, so any
    // field it doesn't know (section, unit, lot, strategy, serials) would
    // 400 the whole request. These stay offline-only until matching
    // endpoints exist.
    const {
      kind,
      storeId: _storeId,
      storageUnitId: _storageUnitId,
      batchCode: _batchCode,
      expiryDate: _expiryDate,
      pickStrategy: _pickStrategy,
      serialNumbers: _serialNumbers,
      idempotencyKey,
      ...body
    } = input;
    // Receipts and dispatches go through the durable outbox: confirmed now when the server answers, otherwise kept
    // on the device (same key, same payload) until it does. The intent id is the action's Idempotency-Key.
    const intent = await submitIntent({ id: idempotencyKey ?? randomUUID(), kind, payload: body });
    const result = (id: string, balanceAfter: string, queued: boolean): MovementResult => ({
      id, type: kind, quantity: body.quantity, balanceAfter, createdAt: new Date(intent.createdAt).toISOString(),
      ...(queued ? { queued, sending: intent.state === 'SENDING' } : {}),
    });
    if (intent.state === 'CONFIRMED') {
      return result(intent.result?.movementId || intent.id, intent.result?.runningBalance ?? '', false);
    }
    if (intent.state === 'PENDING' || intent.state === 'SENDING') return result(intent.id, '', true);
    throw new IntentRefusedError(intent);
  }
  async movements(productId: string): Promise<StockMovement[]> {
    const { data } = await api.get<StockMovement[]>(`/stock/movements/${productId}`);
    return data;
  }

  // No backend aggregate endpoint yet (see GET /analytics/overview in the
  // backlog) — report "unavailable" rather than fabricating a number.
  async dashboardStats(): Promise<DashboardStats> {
    return { stockValue: null, pendingSyncCount: null };
  }

  async transfer(input: TransferInput): Promise<void> {
    // Same whitelist-DTO constraint as move() above.
    const { fromStoreId: _fromStoreId, toStoreId: _toStoreId, idempotencyKey, ...body } = input;
    await postStockWrite('/stock/transfer', body, idempotencyKey);
  }

  // No backend endpoint for section-level breakdown yet.
  async storeBreakdown(): Promise<StoreBalance[]> {
    return [];
  }

  // Reservations are an offline-only concept for now, so availability
  // reduces to plain on-hand from the server's balance endpoint.
  async availability(productId: string, warehouseId: string): Promise<AvailabilitySnapshot> {
    const balance = await this.balance(productId, warehouseId);
    const onHand = Number(balance.baseQuantity);
    // Series 13 / R-37: an unreadable figure is a failed request (the screen says "unknown"), never a zero.
    if (balance.baseQuantity === '' || !Number.isFinite(onHand)) throw new Error('INVALID_BALANCE');
    return { onHand, reserved: 0, available: onHand };
  }
}

/**
 * The WMS-depth features below (storage-unit trees, lots, serials,
 * reservations) have no backend counterpart yet — they are local-only until
 * the cloud-sync phase adds matching endpoints. Reporting empty beats
 * inventing rows the server never returned.
 */
class ApiStorageUnitRepository implements StorageUnitRepository {
  async listByStore(): Promise<StorageUnit[]> {
    return [];
  }
  async create(_input: NewStorageUnit): Promise<StorageUnit> {
    throw new Error('NOT_SUPPORTED_ONLINE');
  }
  async remove(): Promise<void> {}
}

class ApiBatchRepository implements BatchRepository {
  async listByProduct(): Promise<Batch[]> {
    return [];
  }
}

class ApiSerialRepository implements SerialRepository {
  async listByProduct(): Promise<Serial[]> {
    return [];
  }
  async history(): Promise<SerialMovementEntry[]> {
    return [];
  }
}

class ApiReservationRepository implements ReservationRepository {
  async listByProduct(): Promise<Reservation[]> {
    return [];
  }
  async create(): Promise<Reservation> {
    throw new Error('NOT_SUPPORTED_ONLINE');
  }
  async release(): Promise<void> {}
  async fulfill(): Promise<void> {}
}

class ApiActivityRepository implements ActivityRepository {
  // No backend audit-log-read endpoint exposed to the mobile client yet.
  async list(): Promise<ActivityEntry[]> {
    return [];
  }
}

export const apiRepositories: Repositories = {
  products: new ApiProductRepository(),
  warehouses: new ApiWarehouseRepository(),
  stores: new ApiStoreRepository(),
  stock: new ApiStockRepository(),
  activity: new ApiActivityRepository(),
  storageUnits: new ApiStorageUnitRepository(),
  batches: new ApiBatchRepository(),
  serials: new ApiSerialRepository(),
  reservations: new ApiReservationRepository(),
};
