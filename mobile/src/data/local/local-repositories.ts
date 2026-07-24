import { Product, BalanceResponse, StockMovement, ActivityEntry } from '@/api/types';
import type { Transaction } from '@op-engineering/op-sqlite';
import { getDb, query } from '@/db/database';
import { newId, now } from '@/db/util';
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

// ── Row shapes as stored in SQLite ──────────────────────────────────────────
interface ProductRow {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  category_id: string | null;
  image_url: string | null;
  cost_price: number | null;
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
interface ActivityRow {
  id: string;
  action: string;
  entity: string;
  entity_id: string | null;
  detail: string | null;
  created_at: number;
}
interface StoreRow {
  id: string;
  warehouse_id: string;
  name: string;
  pos_x: number | null;
  pos_y: number | null;
  total_quantity: number;
}

function toProduct(r: ProductRow): Product {
  return {
    id: r.id,
    name: r.name,
    sku: r.sku,
    barcode: r.barcode,
    categoryId: r.category_id,
    imageUrl: r.image_url,
    costPrice: r.cost_price,
  };
}

/**
 * Applies `delta` to a product's on-hand quantity within one specific store
 * (section), inside the caller's transaction. Throws INSUFFICIENT_STOCK if
 * the section itself doesn't have enough — a section can never go negative
 * even if the warehouse total (checked separately by the caller) would allow
 * it, since a bin can't dispense more than what's recorded as put away in it.
 */
async function applyStoreDelta(
  tx: Transaction,
  productId: string,
  warehouseId: string,
  storeId: string,
  delta: number,
  ts: number,
): Promise<number> {
  const rows = (
    await tx.execute(
      `SELECT id, quantity FROM stock_balances_by_store
       WHERE product_id = ? AND store_id = ? AND deleted_at IS NULL LIMIT 1`,
      [productId, storeId],
    )
  ).rows as unknown as Array<{ id: string; quantity: number }>;

  const current = rows[0]?.quantity ?? 0;
  const after = current + delta;
  if (after < 0) {
    throw new Error('INSUFFICIENT_STOCK');
  }

  if (rows[0]) {
    await tx.execute(
      `UPDATE stock_balances_by_store SET quantity = ?, updated_at = ?, sync_status = 'pending' WHERE id = ?`,
      [after, ts, rows[0].id],
    );
  } else {
    await tx.execute(
      `INSERT INTO stock_balances_by_store (id, product_id, warehouse_id, store_id, quantity, created_at, updated_at, sync_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [newId(), productId, warehouseId, storeId, after, ts, ts],
    );
  }
  return after;
}

export async function logActivity(
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
      `SELECT id, name, sku, barcode, category_id, image_url, cost_price
       FROM products WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE`,
    );
    return rows.map(toProduct);
  }

  async findByBarcode(barcode: string): Promise<Product | undefined> {
    const rows = await query<ProductRow>(
      `SELECT id, name, sku, barcode, category_id, image_url, cost_price
       FROM products WHERE barcode = ? AND deleted_at IS NULL LIMIT 1`,
      [barcode],
    );
    return rows[0] ? toProduct(rows[0]) : undefined;
  }

  async create(input: NewProduct): Promise<Product> {
    const id = newId();
    const ts = now();
    await getDb().execute(
      `INSERT INTO products (id, name, sku, barcode, category_id, cost_price, created_at, updated_at, sync_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [id, input.name, input.sku, input.barcode ?? null, input.categoryId ?? null, input.costPrice ?? null, ts, ts],
    );
    await logActivity('create', 'product', id, input.name);
    return {
      id,
      name: input.name,
      sku: input.sku,
      barcode: input.barcode ?? null,
      categoryId: input.categoryId ?? null,
      costPrice: input.costPrice ?? null,
    };
  }

  async update(id: string, input: UpdateProduct): Promise<Product> {
    const existingRows = await query<ProductRow>(
      `SELECT id, name, sku, barcode, category_id, image_url, cost_price
       FROM products WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
      [id],
    );
    const existing = existingRows[0];
    if (!existing) throw new Error('NOT_FOUND');

    const merged: ProductRow = {
      ...existing,
      name: input.name ?? existing.name,
      sku: input.sku ?? existing.sku,
      barcode: input.barcode !== undefined ? input.barcode : existing.barcode,
      category_id: input.categoryId !== undefined ? input.categoryId : existing.category_id,
      cost_price: input.costPrice !== undefined ? input.costPrice : existing.cost_price,
    };

    await getDb().execute(
      `UPDATE products SET name = ?, sku = ?, barcode = ?, category_id = ?, cost_price = ?,
         updated_at = ?, sync_status = 'pending' WHERE id = ?`,
      [merged.name, merged.sku, merged.barcode, merged.category_id, merged.cost_price, now(), id],
    );
    await logActivity('update', 'product', id, merged.name);
    return toProduct(merged);
  }

  async remove(id: string): Promise<void> {
    const ts = now();
    await getDb().execute(
      `UPDATE products SET deleted_at = ?, sync_status = 'pending' WHERE id = ?`,
      [ts, id],
    );
    await logActivity('delete', 'product', id, null);
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

class LocalStoreRepository implements StoreRepository {
  async listByWarehouse(warehouseId: string): Promise<Store[]> {
    const rows = await query<StoreRow>(
      `SELECT s.id, s.warehouse_id, s.name, s.pos_x, s.pos_y,
         COALESCE(
           (SELECT SUM(b.quantity) FROM stock_balances_by_store b
            WHERE b.store_id = s.id AND b.deleted_at IS NULL),
           0
         ) AS total_quantity
       FROM stores s
       WHERE s.warehouse_id = ? AND s.deleted_at IS NULL
       ORDER BY s.name COLLATE NOCASE`,
      [warehouseId],
    );
    return rows.map((r) => ({
      id: r.id,
      warehouseId: r.warehouse_id,
      name: r.name,
      posX: r.pos_x,
      posY: r.pos_y,
      totalQuantity: r.total_quantity,
    }));
  }

  async create(input: { warehouseId: string; name: string }): Promise<Store> {
    const id = newId();
    const ts = now();
    await getDb().execute(
      `INSERT INTO stores (id, warehouse_id, name, created_at, updated_at, sync_status)
       VALUES (?, ?, ?, ?, ?, 'pending')`,
      [id, input.warehouseId, input.name, ts, ts],
    );
    await logActivity('create', 'store', id, input.name);
    return { id, warehouseId: input.warehouseId, name: input.name, posX: null, posY: null, totalQuantity: 0 };
  }

  async updatePosition(storeId: string, x: number, y: number): Promise<void> {
    await getDb().execute(
      `UPDATE stores SET pos_x = ?, pos_y = ?, updated_at = ?, sync_status = 'pending' WHERE id = ?`,
      [x, y, now(), storeId],
    );
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

      if (input.storeId) {
        await applyStoreDelta(tx, input.productId, input.warehouseId, input.storeId, delta, ts);
      }

      await tx.execute(
        `INSERT INTO stock_movements (id, product_id, warehouse_id, store_id, type, quantity, balance_after, notes, created_at, updated_at, sync_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
        [movementId, input.productId, input.warehouseId, input.storeId ?? null, input.kind, qty, balanceAfter, input.notes ?? null, ts, ts],
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

  async dashboardStats(): Promise<DashboardStats> {
    const valueRows = await query<{ value: number | null }>(
      `SELECT SUM(p.cost_price * b.quantity) AS value
       FROM stock_balances b
       JOIN products p ON p.id = b.product_id
       WHERE b.deleted_at IS NULL AND p.deleted_at IS NULL`,
    );
    const pendingRows = await query<{ cnt: number }>(
      `SELECT
         (SELECT COUNT(*) FROM products WHERE sync_status = 'pending' AND deleted_at IS NULL) +
         (SELECT COUNT(*) FROM warehouses WHERE sync_status = 'pending' AND deleted_at IS NULL) +
         (SELECT COUNT(*) FROM stock_movements WHERE sync_status = 'pending' AND deleted_at IS NULL)
         AS cnt`,
    );
    return {
      stockValue: valueRows[0]?.value ?? null,
      pendingSyncCount: pendingRows[0]?.cnt ?? 0,
    };
  }

  async transfer(input: TransferInput): Promise<void> {
    const qty = Number(input.quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      throw new Error('Invalid quantity');
    }
    // Allow same-warehouse transfers when they move stock between two
    // different sections — only reject a true no-op (identical warehouse
    // AND identical section, including "no section" on both sides).
    if (
      input.fromWarehouseId === input.toWarehouseId &&
      (input.fromStoreId ?? null) === (input.toStoreId ?? null)
    ) {
      throw new Error('SAME_LOCATION');
    }

    const db = getDb();
    const ts = now();

    await db.transaction(async (tx) => {
      const fromRows = (
        await tx.execute(
          `SELECT id, quantity FROM stock_balances WHERE product_id = ? AND warehouse_id = ? AND deleted_at IS NULL LIMIT 1`,
          [input.productId, input.fromWarehouseId],
        )
      ).rows as Array<{ id: string; quantity: number }>;
      const fromCurrent = fromRows[0]?.quantity ?? 0;
      const fromAfter = fromCurrent - qty;
      if (fromAfter < 0) {
        throw new Error('INSUFFICIENT_STOCK');
      }

      if (fromRows[0]) {
        await tx.execute(
          `UPDATE stock_balances SET quantity = ?, updated_at = ?, sync_status = 'pending' WHERE id = ?`,
          [fromAfter, ts, fromRows[0].id],
        );
      } else {
        await tx.execute(
          `INSERT INTO stock_balances (id, product_id, warehouse_id, quantity, created_at, updated_at, sync_status)
           VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
          [newId(), input.productId, input.fromWarehouseId, fromAfter, ts, ts],
        );
      }

      const toRows = (
        await tx.execute(
          `SELECT id, quantity FROM stock_balances WHERE product_id = ? AND warehouse_id = ? AND deleted_at IS NULL LIMIT 1`,
          [input.productId, input.toWarehouseId],
        )
      ).rows as Array<{ id: string; quantity: number }>;
      const toAfter = (toRows[0]?.quantity ?? 0) + qty;

      if (toRows[0]) {
        await tx.execute(
          `UPDATE stock_balances SET quantity = ?, updated_at = ?, sync_status = 'pending' WHERE id = ?`,
          [toAfter, ts, toRows[0].id],
        );
      } else {
        await tx.execute(
          `INSERT INTO stock_balances (id, product_id, warehouse_id, quantity, created_at, updated_at, sync_status)
           VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
          [newId(), input.productId, input.toWarehouseId, toAfter, ts, ts],
        );
      }

      if (input.fromStoreId) {
        await applyStoreDelta(tx, input.productId, input.fromWarehouseId, input.fromStoreId, -qty, ts);
      }
      if (input.toStoreId) {
        await applyStoreDelta(tx, input.productId, input.toWarehouseId, input.toStoreId, qty, ts);
      }

      await tx.execute(
        `INSERT INTO stock_movements (id, product_id, warehouse_id, store_id, type, quantity, balance_after, notes, created_at, updated_at, sync_status)
         VALUES (?, ?, ?, ?, 'outbound', ?, ?, ?, ?, ?, 'pending')`,
        [newId(), input.productId, input.fromWarehouseId, input.fromStoreId ?? null, qty, fromAfter, input.notes ?? 'transfer out', ts, ts],
      );
      await tx.execute(
        `INSERT INTO stock_movements (id, product_id, warehouse_id, store_id, type, quantity, balance_after, notes, created_at, updated_at, sync_status)
         VALUES (?, ?, ?, ?, 'inbound', ?, ?, ?, ?, ?, 'pending')`,
        [newId(), input.productId, input.toWarehouseId, input.toStoreId ?? null, qty, toAfter, input.notes ?? 'transfer in', ts, ts],
      );

      await tx.execute(
        `INSERT INTO activity_log (id, action, entity, entity_id, detail, created_at, updated_at, sync_status)
         VALUES (?, 'transfer', 'stock', ?, ?, ?, ?, 'pending')`,
        [newId(), input.productId, `transfer ${qty}`, ts, ts],
      );
    });
  }

  async storeBreakdown(productId: string, warehouseId: string): Promise<StoreBalance[]> {
    const rows = await query<{ store_id: string; store_name: string; quantity: number }>(
      `SELECT b.store_id AS store_id, s.name AS store_name, b.quantity AS quantity
       FROM stock_balances_by_store b
       JOIN stores s ON s.id = b.store_id
       WHERE b.product_id = ? AND b.warehouse_id = ? AND b.deleted_at IS NULL AND s.deleted_at IS NULL
       ORDER BY s.name COLLATE NOCASE`,
      [productId, warehouseId],
    );
    return rows.map((r) => ({ storeId: r.store_id, storeName: r.store_name, quantity: r.quantity }));
  }
}

class LocalActivityRepository implements ActivityRepository {
  async list(): Promise<ActivityEntry[]> {
    const rows = await query<ActivityRow>(
      `SELECT id, action, entity, entity_id, detail, created_at
       FROM activity_log WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 200`,
    );
    return rows.map((r) => ({
      id: r.id,
      action: r.action,
      entity: r.entity,
      entityId: r.entity_id,
      detail: r.detail,
      createdAt: new Date(r.created_at).toISOString(),
    }));
  }
}

export const localRepositories: Repositories = {
  products: new LocalProductRepository(),
  warehouses: new LocalWarehouseRepository(),
  stores: new LocalStoreRepository(),
  stock: new LocalStockRepository(),
  activity: new LocalActivityRepository(),
};
