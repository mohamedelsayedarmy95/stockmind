import { Product, BalanceResponse, StockMovement } from '@/api/types';
import { getDb, query } from '@/db/database';
import { newId, now } from '@/db/util';
import {
  ProductRepository,
  WarehouseRepository,
  StockRepository,
  Warehouse,
  NewProduct,
  MovementInput,
  Repositories,
} from '../repositories';

// ── Row shapes as stored in SQLite ──────────────────────────────────────────
interface ProductRow {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  category_id: string | null;
  image_url: string | null;
}
interface WarehouseRow {
  id: string;
  name: string;
  is_active: number;
}
interface BalanceRow {
  quantity: number;
}
interface MovementRow {
  id: string;
  type: string;
  quantity: number;
  balance_after: number;
  notes: string | null;
  created_at: number;
}

function toProduct(r: ProductRow): Product {
  return {
    id: r.id,
    name: r.name,
    sku: r.sku,
    barcode: r.barcode,
    categoryId: r.category_id,
    imageUrl: r.image_url,
  };
}

async function logActivity(
  action: string,
  entity: string,
  entityId: string | null,
  detail: string | null,
): Promise<void> {
  const ts = now();
  await getDb().execute(
    `INSERT INTO activity_log (id, action, entity, entity_id, detail, created_at, updated_at, sync_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
    [newId(), action, entity, entityId, detail, ts, ts],
  );
}

class LocalProductRepository implements ProductRepository {
  async list(): Promise<Product[]> {
    const rows = await query<ProductRow>(
      `SELECT id, name, sku, barcode, category_id, image_url
       FROM products WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE`,
    );
    return rows.map(toProduct);
  }

  async findByBarcode(barcode: string): Promise<Product | undefined> {
    const rows = await query<ProductRow>(
      `SELECT id, name, sku, barcode, category_id, image_url
       FROM products WHERE barcode = ? AND deleted_at IS NULL LIMIT 1`,
      [barcode],
    );
    return rows[0] ? toProduct(rows[0]) : undefined;
  }

  async create(input: NewProduct): Promise<Product> {
    const id = newId();
    const ts = now();
    await getDb().execute(
      `INSERT INTO products (id, name, sku, barcode, category_id, created_at, updated_at, sync_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [id, input.name, input.sku, input.barcode ?? null, input.categoryId ?? null, ts, ts],
    );
    await logActivity('create', 'product', id, input.name);
    return { id, name: input.name, sku: input.sku, barcode: input.barcode ?? null, categoryId: input.categoryId ?? null };
  }
}

class LocalWarehouseRepository implements WarehouseRepository {
  async list(): Promise<Warehouse[]> {
    const rows = await query<WarehouseRow>(
      `SELECT id, name, is_active FROM warehouses WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE`,
    );
    return rows.map((r) => ({ id: r.id, name: r.name, isActive: r.is_active === 1 }));
  }

  async create(input: { name: string }): Promise<Warehouse> {
    const id = newId();
    const ts = now();
    await getDb().execute(
      `INSERT INTO warehouses (id, name, is_active, created_at, updated_at, sync_status)
       VALUES (?, ?, 1, ?, ?, 'pending')`,
      [id, input.name, ts, ts],
    );
    await logActivity('create', 'warehouse', id, input.name);
    return { id, name: input.name, isActive: true };
  }

  /** Guarantees at least one warehouse exists (offline accounts start empty). */
  async ensureDefault(): Promise<Warehouse> {
    const existing = await this.list();
    if (existing.length > 0) return existing[0];
    return this.create({ name: 'Main Warehouse' });
  }
}

class LocalStockRepository implements StockRepository {
  private async currentQuantity(productId: string, warehouseId: string): Promise<number> {
    const rows = await query<BalanceRow>(
      `SELECT quantity FROM stock_balances WHERE product_id = ? AND warehouse_id = ? AND deleted_at IS NULL LIMIT 1`,
      [productId, warehouseId],
    );
    return rows[0]?.quantity ?? 0;
  }

  async balance(productId: string, warehouseId: string): Promise<BalanceResponse> {
    const quantity = await this.currentQuantity(productId, warehouseId);
    return { productId, warehouseId, baseQuantity: String(quantity) };
  }

  async movements(productId: string): Promise<StockMovement[]> {
    const rows = await query<MovementRow>(
      `SELECT id, type, quantity, balance_after, notes, created_at
       FROM stock_movements WHERE product_id = ? AND deleted_at IS NULL ORDER BY created_at DESC`,
      [productId],
    );
    return rows.map((r) => ({
      id: r.id,
      type: r.type,
      quantity: String(r.quantity),
      balanceAfter: String(r.balance_after),
      notes: r.notes,
      createdAt: new Date(r.created_at).toISOString(),
    }));
  }

  async move(input: MovementInput): Promise<StockMovement> {
    const qty = Number(input.quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      throw new Error('Invalid quantity');
    }

    const db = getDb();
    const movementId = newId();
    const ts = now();
    let balanceAfter = 0;

    await db.transaction(async (tx) => {
      const balRows = (
        await tx.execute(
          `SELECT id, quantity FROM stock_balances WHERE product_id = ? AND warehouse_id = ? AND deleted_at IS NULL LIMIT 1`,
          [input.productId, input.warehouseId],
        )
      ).rows as Array<{ id: string; quantity: number }>;

      const current = balRows[0]?.quantity ?? 0;
      const delta = input.kind === 'inbound' ? qty : -qty;
      balanceAfter = current + delta;
      if (balanceAfter < 0) {
        throw new Error('INSUFFICIENT_STOCK');
      }

      if (balRows[0]) {
        await tx.execute(
          `UPDATE stock_balances SET quantity = ?, updated_at = ?, sync_status = 'pending' WHERE id = ?`,
          [balanceAfter, ts, balRows[0].id],
        );
      } else {
        await tx.execute(
          `INSERT INTO stock_balances (id, product_id, warehouse_id, quantity, created_at, updated_at, sync_status)
           VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
          [newId(), input.productId, input.warehouseId, balanceAfter, ts, ts],
        );
      }

      await tx.execute(
        `INSERT INTO stock_movements (id, product_id, warehouse_id, type, quantity, balance_after, notes, created_at, updated_at, sync_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
        [movementId, input.productId, input.warehouseId, input.kind, qty, balanceAfter, input.notes ?? null, ts, ts],
      );

      await tx.execute(
        `INSERT INTO activity_log (id, action, entity, entity_id, detail, created_at, updated_at, sync_status)
         VALUES (?, ?, 'stock', ?, ?, ?, ?, 'pending')`,
        [newId(), input.kind, input.productId, `${input.kind} ${qty}`, ts, ts],
      );
    });

    return {
      id: movementId,
      type: input.kind,
      quantity: String(qty),
      balanceAfter: String(balanceAfter),
      notes: input.notes ?? null,
      createdAt: new Date(ts).toISOString(),
    };
  }
}

export const localRepositories: Repositories = {
  products: new LocalProductRepository(),
  warehouses: new LocalWarehouseRepository(),
  stock: new LocalStockRepository(),
};
