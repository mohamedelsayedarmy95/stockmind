import { api } from '@/api/client';
import { Product, BalanceResponse, StockMovement, ActivityEntry } from '@/api/types';
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
    const { data } = await api.get<Product[]>('/products');
    return data;
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
    const { data } = await api.get<Warehouse[]>('/warehouses');
    return data;
  }
  async create(input: { name: string }): Promise<Warehouse> {
    const { data } = await api.post<Warehouse>('/warehouses', input);
    return data;
  }
  async ensureDefault(): Promise<Warehouse> {
    const list = await this.list();
    if (list.length > 0) return list.find((w) => w.isActive !== false) ?? list[0];
    return this.create({ name: 'Main Warehouse' });
  }
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
      ...body
    } = input;
    const { data } = await api.post<StockMovement>(`/stock/${kind}`, body);
    return data;
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
    const { fromStoreId: _fromStoreId, toStoreId: _toStoreId, ...body } = input;
    await api.post('/stock/transfer', body);
  }

  // No backend endpoint for section-level breakdown yet.
  async storeBreakdown(): Promise<StoreBalance[]> {
    return [];
  }

  // Reservations are an offline-only concept for now, so availability
  // reduces to plain on-hand from the server's balance endpoint.
  async availability(productId: string, warehouseId: string): Promise<AvailabilitySnapshot> {
    const balance = await this.balance(productId, warehouseId);
    const onHand = Number(balance.baseQuantity) || 0;
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
