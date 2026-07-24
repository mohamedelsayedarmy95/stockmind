import { api } from '@/api/client';
import { Product, BalanceResponse, StockMovement } from '@/api/types';
import {
  ProductRepository,
  WarehouseRepository,
  StockRepository,
  Warehouse,
  NewProduct,
  MovementInput,
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

class ApiStockRepository implements StockRepository {
  async balance(productId: string, warehouseId: string): Promise<BalanceResponse> {
    const { data } = await api.get<BalanceResponse>(`/stock/balance/${productId}/${warehouseId}`);
    return data;
  }
  async move(input: MovementInput): Promise<StockMovement> {
    const { kind, ...body } = input;
    const { data } = await api.post<StockMovement>(`/stock/${kind}`, body);
    return data;
  }
  async movements(productId: string): Promise<StockMovement[]> {
    const { data } = await api.get<StockMovement[]>(`/stock/movements/${productId}`);
    return data;
  }
}

export const apiRepositories: Repositories = {
  products: new ApiProductRepository(),
  warehouses: new ApiWarehouseRepository(),
  stock: new ApiStockRepository(),
};
