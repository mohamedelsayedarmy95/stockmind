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
  TransferInput,
  DashboardStats,
  StoreBalance,
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
  async move(input: MovementInput): Promise<StockMovement> {
    // Backend's inbound/outbound DTOs don't accept storeId (whitelist-only
    // validation would 400 the whole request) — section detail is
    // offline-only until a matching endpoint exists.
    const { kind, storeId: _storeId, ...body } = input;
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
};
