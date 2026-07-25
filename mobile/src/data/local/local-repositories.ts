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
  MovementResult,
  TransferInput,
  DashboardStats,
  StoreBalance,
  StorageUnitRepository,
  BatchRepository,
  SerialRepository,
  ReservationRepository,
  StorageUnit,
  StorageUnitType,
  NewStorageUnit,
  Batch,
  Serial,
  SerialMovementEntry,
  Reservation,
  ReservationStatus,
  AvailabilitySnapshot,
  PickStrategy,
  PickLine,
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
  unit_weight_kg: number | null;
  lifecycle_status: string | null;
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
    unitWeightKg: r.unit_weight_kg,
    lifecycleStatus: r.lifecycle_status,
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

/**
 * Finds the lot with this code for the product, creating it on first receipt.
 * `expiryDate` is only applied at creation — an existing lot keeps its own.
 */
async function resolveBatch(
  tx: Transaction,
  productId: string,
  batchCode: string,
  expiryDate: number | null,
  ts: number,
): Promise<string> {
  const rows = (
    await tx.execute(
      `SELECT id FROM batches WHERE product_id = ? AND batch_code = ? AND deleted_at IS NULL LIMIT 1`,
      [productId, batchCode],
    )
  ).rows as unknown as Array<{ id: string }>;
  if (rows[0]) return rows[0].id;

  const id = newId();
  await tx.execute(
    `INSERT INTO batches (id, product_id, batch_code, expiry_date, received_at, created_at, updated_at, sync_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
    [id, productId, batchCode, expiryDate, ts, ts, ts],
  );
  return id;
}

/** Applies a signed delta to one lot's quantity at one location. */
async function applyBatchDelta(
  tx: Transaction,
  batchId: string,
  productId: string,
  warehouseId: string,
  storeId: string,
  storageUnitId: string,
  delta: number,
  ts: number,
): Promise<void> {
  const rows = (
    await tx.execute(
      `SELECT id, quantity FROM stock_batch_balances
       WHERE batch_id = ? AND warehouse_id = ? AND store_id = ? AND storage_unit_id = ? AND deleted_at IS NULL LIMIT 1`,
      [batchId, warehouseId, storeId, storageUnitId],
    )
  ).rows as unknown as Array<{ id: string; quantity: number }>;

  const after = (rows[0]?.quantity ?? 0) + delta;
  if (after < 0) throw new Error('INSUFFICIENT_STOCK');

  if (rows[0]) {
    await tx.execute(
      `UPDATE stock_batch_balances SET quantity = ?, updated_at = ?, sync_status = 'pending' WHERE id = ?`,
      [after, ts, rows[0].id],
    );
  } else {
    await tx.execute(
      `INSERT INTO stock_batch_balances (id, batch_id, product_id, warehouse_id, store_id, storage_unit_id, quantity, created_at, updated_at, sync_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [newId(), batchId, productId, warehouseId, storeId, storageUnitId, after, ts, ts],
    );
  }
}

/**
 * Chooses which lots satisfy a dispatch, honouring the strategy:
 *   FEFO — soonest expiry first, undated lots last (they can't expire on us)
 *   FIFO — oldest receipt first
 *   LIFO — newest receipt first
 * Returns [] when the product has no lot-tracked stock at all, in which case
 * the caller falls back to a plain unbatched movement.
 */
async function pickBatches(
  tx: Transaction,
  productId: string,
  warehouseId: string,
  needed: number,
  strategy: PickStrategy,
): Promise<Array<{ batchId: string; batchCode: string; storeId: string; storageUnitId: string; take: number }>> {
  const order =
    strategy === 'fifo'
      ? 'b.received_at ASC'
      : strategy === 'lifo'
        ? 'b.received_at DESC'
        : '(b.expiry_date IS NULL) ASC, b.expiry_date ASC, b.received_at ASC';

  const rows = (
    await tx.execute(
      `SELECT sb.id, sb.batch_id, sb.quantity, sb.store_id, sb.storage_unit_id, b.batch_code
       FROM stock_batch_balances sb
       JOIN batches b ON b.id = sb.batch_id
       WHERE sb.product_id = ? AND sb.warehouse_id = ? AND sb.quantity > 0
         AND sb.deleted_at IS NULL AND b.deleted_at IS NULL
       ORDER BY ${order}`,
      [productId, warehouseId],
    )
  ).rows as unknown as Array<{
    batch_id: string;
    quantity: number;
    store_id: string;
    storage_unit_id: string;
    batch_code: string;
  }>;

  if (rows.length === 0) return [];

  const picks: Array<{ batchId: string; batchCode: string; storeId: string; storageUnitId: string; take: number }> = [];
  let remaining = needed;
  for (const row of rows) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, row.quantity);
    picks.push({
      batchId: row.batch_id,
      batchCode: row.batch_code,
      storeId: row.store_id,
      storageUnitId: row.storage_unit_id,
      take,
    });
    remaining -= take;
  }
  if (remaining > 0) throw new Error('INSUFFICIENT_STOCK');
  return picks;
}

/** Registers received serials, or marks issued ones, and logs each move. */
async function recordSerials(
  tx: Transaction,
  serialNumbers: string[],
  input: {
    productId: string;
    warehouseId: string;
    storeId: string | null;
    storageUnitId: string | null;
    batchId: string | null;
    kind: 'inbound' | 'outbound';
    movementId: string;
  },
  ts: number,
): Promise<void> {
  for (const raw of serialNumbers) {
    const serialNumber = raw.trim();
    if (!serialNumber) continue;

    const existing = (
      await tx.execute(
        `SELECT id FROM serials WHERE product_id = ? AND serial_number = ? AND deleted_at IS NULL LIMIT 1`,
        [input.productId, serialNumber],
      )
    ).rows as unknown as Array<{ id: string }>;

    const status = input.kind === 'inbound' ? 'in_stock' : 'issued';
    let serialId: string;

    if (existing[0]) {
      serialId = existing[0].id;
      await tx.execute(
        `UPDATE serials SET status = ?, warehouse_id = ?, store_id = ?, storage_unit_id = ?,
           batch_id = COALESCE(?, batch_id), updated_at = ?, sync_status = 'pending' WHERE id = ?`,
        [
          status,
          input.kind === 'inbound' ? input.warehouseId : null,
          input.kind === 'inbound' ? input.storeId : null,
          input.kind === 'inbound' ? input.storageUnitId : null,
          input.batchId,
          ts,
          serialId,
        ],
      );
    } else {
      serialId = newId();
      await tx.execute(
        `INSERT INTO serials (id, product_id, serial_number, batch_id, status, warehouse_id, store_id, storage_unit_id, created_at, updated_at, sync_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
        [
          serialId,
          input.productId,
          serialNumber,
          input.batchId,
          status,
          input.kind === 'inbound' ? input.warehouseId : null,
          input.kind === 'inbound' ? input.storeId : null,
          input.kind === 'inbound' ? input.storageUnitId : null,
          ts,
          ts,
        ],
      );
    }

    await tx.execute(
      `INSERT INTO serial_movements (id, serial_id, movement_id, action, from_warehouse_id, to_warehouse_id, note, created_at, updated_at, sync_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [
        newId(),
        serialId,
        input.movementId,
        input.kind,
        input.kind === 'outbound' ? input.warehouseId : null,
        input.kind === 'inbound' ? input.warehouseId : null,
        null,
        ts,
        ts,
      ],
    );
  }
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
      `SELECT id, name, sku, barcode, category_id, image_url, cost_price, unit_weight_kg, lifecycle_status
       FROM products WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE`,
    );
    return rows.map(toProduct);
  }

  async findByBarcode(barcode: string): Promise<Product | undefined> {
    const rows = await query<ProductRow>(
      `SELECT id, name, sku, barcode, category_id, image_url, cost_price, unit_weight_kg, lifecycle_status
       FROM products WHERE barcode = ? AND deleted_at IS NULL LIMIT 1`,
      [barcode],
    );
    return rows[0] ? toProduct(rows[0]) : undefined;
  }

  async create(input: NewProduct): Promise<Product> {
    const id = newId();
    const ts = now();
    await getDb().execute(
      `INSERT INTO products (id, name, sku, barcode, category_id, cost_price, unit_weight_kg, lifecycle_status, created_at, updated_at, sync_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [
        id,
        input.name,
        input.sku,
        input.barcode ?? null,
        input.categoryId ?? null,
        input.costPrice ?? null,
        input.unitWeightKg ?? null,
        input.lifecycleStatus ?? 'active',
        ts,
        ts,
      ],
    );
    await logActivity('create', 'product', id, input.name);
    return {
      id,
      name: input.name,
      sku: input.sku,
      barcode: input.barcode ?? null,
      categoryId: input.categoryId ?? null,
      costPrice: input.costPrice ?? null,
      unitWeightKg: input.unitWeightKg ?? null,
      lifecycleStatus: input.lifecycleStatus ?? 'active',
    };
  }

  async update(id: string, input: UpdateProduct): Promise<Product> {
    const existingRows = await query<ProductRow>(
      `SELECT id, name, sku, barcode, category_id, image_url, cost_price, unit_weight_kg, lifecycle_status
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
      unit_weight_kg: input.unitWeightKg !== undefined ? input.unitWeightKg : existing.unit_weight_kg,
      lifecycle_status:
        input.lifecycleStatus !== undefined ? input.lifecycleStatus : existing.lifecycle_status,
    };

    await getDb().execute(
      `UPDATE products SET name = ?, sku = ?, barcode = ?, category_id = ?, cost_price = ?,
         unit_weight_kg = ?, lifecycle_status = ?, updated_at = ?, sync_status = 'pending' WHERE id = ?`,
      [
        merged.name,
        merged.sku,
        merged.barcode,
        merged.category_id,
        merged.cost_price,
        merged.unit_weight_kg,
        merged.lifecycle_status,
        now(),
        id,
      ],
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

  async move(input: MovementInput): Promise<MovementResult> {
    const qty = Number(input.quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      throw new Error('Invalid quantity');
    }

    const db = getDb();
    const movementId = newId();
    const ts = now();
    const strategy: PickStrategy = input.pickStrategy ?? 'fefo';
    let balanceAfter = 0;
    let picks: PickLine[] = [];

    await db.transaction(async (tx) => {
      // ── Warehouse-level balance stays the single source of truth ─────────
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

      // A dispatch may not eat into stock that is already promised elsewhere.
      if (input.kind === 'outbound') {
        const resRows = (
          await tx.execute(
            `SELECT COALESCE(SUM(quantity), 0) AS reserved FROM reservations
             WHERE product_id = ? AND warehouse_id = ? AND status = 'active' AND deleted_at IS NULL`,
            [input.productId, input.warehouseId],
          )
        ).rows as unknown as Array<{ reserved: number }>;
        const reserved = resRows[0]?.reserved ?? 0;
        if (current - reserved < qty) {
          throw new Error('RESERVED_STOCK');
        }
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

      const storeKey = input.storeId ?? '';
      const unitKey = input.storageUnitId ?? '';
      let primaryBatchId: string | null = null;

      if (input.kind === 'inbound') {
        // Receiving under a lot code creates the lot on first use.
        if (input.batchCode?.trim()) {
          primaryBatchId = await resolveBatch(
            tx,
            input.productId,
            input.batchCode.trim(),
            input.expiryDate ?? null,
            ts,
          );
          await applyBatchDelta(
            tx,
            primaryBatchId,
            input.productId,
            input.warehouseId,
            storeKey,
            unitKey,
            qty,
            ts,
          );
          picks = [{ batchId: primaryBatchId, batchCode: input.batchCode.trim(), quantity: qty }];
        }
      } else {
        // Dispatch: let the strategy decide which lots to draw down. With no
        // lot-tracked stock this returns [] and we fall back to a plain move.
        const chosen = await pickBatches(tx, input.productId, input.warehouseId, qty, strategy);
        for (const pick of chosen) {
          await applyBatchDelta(
            tx,
            pick.batchId,
            input.productId,
            input.warehouseId,
            pick.storeId,
            pick.storageUnitId,
            -pick.take,
            ts,
          );
        }
        picks = chosen.map((p) => ({ batchId: p.batchId, batchCode: p.batchCode, quantity: p.take }));
        primaryBatchId = chosen.length === 1 ? chosen[0].batchId : null;
      }

      await tx.execute(
        `INSERT INTO stock_movements (id, product_id, warehouse_id, store_id, storage_unit_id, batch_id, pick_strategy, type, quantity, balance_after, notes, created_at, updated_at, sync_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
        [
          movementId,
          input.productId,
          input.warehouseId,
          input.storeId ?? null,
          input.storageUnitId ?? null,
          primaryBatchId,
          input.kind === 'outbound' ? strategy : null,
          input.kind,
          qty,
          balanceAfter,
          input.notes ?? null,
          ts,
          ts,
        ],
      );

      if (input.serialNumbers?.length) {
        await recordSerials(
          tx,
          input.serialNumbers,
          {
            productId: input.productId,
            warehouseId: input.warehouseId,
            storeId: input.storeId ?? null,
            storageUnitId: input.storageUnitId ?? null,
            batchId: primaryBatchId,
            kind: input.kind,
            movementId,
          },
          ts,
        );
      }

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
      picks: picks.length > 0 ? picks : undefined,
    };
  }

  async availability(productId: string, warehouseId: string): Promise<AvailabilitySnapshot> {
    const onHand = await this.currentQuantity(productId, warehouseId);
    const rows = await query<{ reserved: number }>(
      `SELECT COALESCE(SUM(quantity), 0) AS reserved FROM reservations
       WHERE product_id = ? AND warehouse_id = ? AND status = 'active' AND deleted_at IS NULL`,
      [productId, warehouseId],
    );
    const reserved = rows[0]?.reserved ?? 0;
    return { onHand, reserved, available: Math.max(0, onHand - reserved) };
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

class LocalStorageUnitRepository implements StorageUnitRepository {
  async listByStore(storeId: string): Promise<StorageUnit[]> {
    // Ordering by the materialized path yields a depth-first pre-order walk:
    // '/a/' sorts before '/a/b/', and '/a/…' before '/b/…'.
    const rows = await query<{
      id: string;
      warehouse_id: string;
      store_id: string;
      parent_id: string | null;
      name: string;
      unit_type: string;
      path: string;
      depth: number;
      sort_order: number;
      total_quantity: number;
    }>(
      `SELECT su.id, su.warehouse_id, su.store_id, su.parent_id, su.name, su.unit_type,
              su.path, su.depth, su.sort_order,
              COALESCE((
                SELECT SUM(sb.quantity) FROM stock_batch_balances sb
                JOIN storage_units d ON d.id = sb.storage_unit_id
                WHERE d.path LIKE su.path || '%' AND sb.deleted_at IS NULL AND d.deleted_at IS NULL
              ), 0) AS total_quantity
       FROM storage_units su
       WHERE su.store_id = ? AND su.deleted_at IS NULL
       ORDER BY su.path`,
      [storeId],
    );
    return rows.map((r) => ({
      id: r.id,
      warehouseId: r.warehouse_id,
      storeId: r.store_id,
      parentId: r.parent_id,
      name: r.name,
      unitType: r.unit_type as StorageUnitType,
      path: r.path,
      depth: r.depth,
      sortOrder: r.sort_order,
      totalQuantity: r.total_quantity,
    }));
  }

  async create(input: NewStorageUnit): Promise<StorageUnit> {
    const id = newId();
    const ts = now();

    let path = `/${id}/`;
    let depth = 0;
    if (input.parentId) {
      const parents = await query<{ path: string; depth: number }>(
        `SELECT path, depth FROM storage_units WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
        [input.parentId],
      );
      const parent = parents[0];
      if (!parent) throw new Error('PARENT_NOT_FOUND');
      path = `${parent.path}${id}/`;
      depth = parent.depth + 1;
    }

    await getDb().execute(
      `INSERT INTO storage_units (id, warehouse_id, store_id, parent_id, name, unit_type, path, depth, sort_order, created_at, updated_at, sync_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 'pending')`,
      [id, input.warehouseId, input.storeId, input.parentId ?? null, input.name, input.unitType, path, depth, ts, ts],
    );
    await logActivity('create', 'storage_unit', id, input.name);

    return {
      id,
      warehouseId: input.warehouseId,
      storeId: input.storeId,
      parentId: input.parentId ?? null,
      name: input.name,
      unitType: input.unitType,
      path,
      depth,
      sortOrder: 0,
      totalQuantity: 0,
    };
  }

  async remove(id: string): Promise<void> {
    const rows = await query<{ path: string }>(
      `SELECT path FROM storage_units WHERE id = ? LIMIT 1`,
      [id],
    );
    const path = rows[0]?.path;
    if (!path) return;
    // One statement removes the unit and its whole subtree.
    await getDb().execute(
      `UPDATE storage_units SET deleted_at = ?, sync_status = 'pending' WHERE path LIKE ? || '%'`,
      [now(), path],
    );
    await logActivity('delete', 'storage_unit', id, null);
  }
}

class LocalBatchRepository implements BatchRepository {
  async listByProduct(productId: string, warehouseId: string): Promise<Batch[]> {
    const rows = await query<{
      id: string;
      product_id: string;
      batch_code: string;
      expiry_date: number | null;
      received_at: number;
      quantity: number;
    }>(
      `SELECT b.id, b.product_id, b.batch_code, b.expiry_date, b.received_at,
              COALESCE(SUM(sb.quantity), 0) AS quantity
       FROM batches b
       LEFT JOIN stock_batch_balances sb
         ON sb.batch_id = b.id AND sb.warehouse_id = ? AND sb.deleted_at IS NULL
       WHERE b.product_id = ? AND b.deleted_at IS NULL
       GROUP BY b.id
       ORDER BY (b.expiry_date IS NULL) ASC, b.expiry_date ASC, b.received_at ASC`,
      [warehouseId, productId],
    );
    return rows.map((r) => ({
      id: r.id,
      productId: r.product_id,
      batchCode: r.batch_code,
      expiryDate: r.expiry_date != null ? new Date(r.expiry_date).toISOString() : null,
      receivedAt: new Date(r.received_at).toISOString(),
      quantity: r.quantity,
    }));
  }
}

class LocalSerialRepository implements SerialRepository {
  async listByProduct(productId: string): Promise<Serial[]> {
    const rows = await query<{
      id: string;
      product_id: string;
      serial_number: string;
      batch_id: string | null;
      status: string;
      warehouse_id: string | null;
    }>(
      `SELECT id, product_id, serial_number, batch_id, status, warehouse_id
       FROM serials WHERE product_id = ? AND deleted_at IS NULL
       ORDER BY status, serial_number`,
      [productId],
    );
    return rows.map((r) => ({
      id: r.id,
      productId: r.product_id,
      serialNumber: r.serial_number,
      batchId: r.batch_id,
      status: r.status,
      warehouseId: r.warehouse_id,
    }));
  }

  async history(serialId: string): Promise<SerialMovementEntry[]> {
    const rows = await query<{ id: string; action: string; note: string | null; created_at: number }>(
      `SELECT id, action, note, created_at FROM serial_movements
       WHERE serial_id = ? AND deleted_at IS NULL ORDER BY created_at DESC`,
      [serialId],
    );
    return rows.map((r) => ({
      id: r.id,
      action: r.action,
      note: r.note,
      createdAt: new Date(r.created_at).toISOString(),
    }));
  }
}

class LocalReservationRepository implements ReservationRepository {
  async listByProduct(productId: string, warehouseId: string): Promise<Reservation[]> {
    const rows = await query<{
      id: string;
      product_id: string;
      warehouse_id: string;
      batch_id: string | null;
      quantity: number;
      status: string;
      reference: string | null;
      created_at: number;
    }>(
      `SELECT id, product_id, warehouse_id, batch_id, quantity, status, reference, created_at
       FROM reservations WHERE product_id = ? AND warehouse_id = ? AND deleted_at IS NULL
       ORDER BY (status = 'active') DESC, created_at DESC`,
      [productId, warehouseId],
    );
    return rows.map((r) => ({
      id: r.id,
      productId: r.product_id,
      warehouseId: r.warehouse_id,
      batchId: r.batch_id,
      quantity: r.quantity,
      status: r.status as ReservationStatus,
      reference: r.reference,
      createdAt: new Date(r.created_at).toISOString(),
    }));
  }

  async create(input: {
    productId: string;
    warehouseId: string;
    quantity: number;
    reference?: string | null;
  }): Promise<Reservation> {
    if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
      throw new Error('Invalid quantity');
    }
    // Never promise more than is actually free right now.
    const snapshot = await localRepositories.stock.availability(input.productId, input.warehouseId);
    if (input.quantity > snapshot.available) {
      throw new Error('INSUFFICIENT_STOCK');
    }

    const id = newId();
    const ts = now();
    await getDb().execute(
      `INSERT INTO reservations (id, product_id, warehouse_id, batch_id, quantity, status, reference, created_at, updated_at, sync_status)
       VALUES (?, ?, ?, NULL, ?, 'active', ?, ?, ?, 'pending')`,
      [id, input.productId, input.warehouseId, input.quantity, input.reference ?? null, ts, ts],
    );
    await logActivity('reserve', 'stock', input.productId, `reserved ${input.quantity}`);

    return {
      id,
      productId: input.productId,
      warehouseId: input.warehouseId,
      batchId: null,
      quantity: input.quantity,
      status: 'active',
      reference: input.reference ?? null,
      createdAt: new Date(ts).toISOString(),
    };
  }

  private async setStatus(id: string, status: ReservationStatus, action: string): Promise<void> {
    await getDb().execute(
      `UPDATE reservations SET status = ?, updated_at = ?, sync_status = 'pending' WHERE id = ?`,
      [status, now(), id],
    );
    await logActivity(action, 'stock', id, null);
  }

  async release(id: string): Promise<void> {
    await this.setStatus(id, 'released', 'release');
  }

  async fulfill(id: string): Promise<void> {
    await this.setStatus(id, 'fulfilled', 'fulfill');
  }
}

export const localRepositories: Repositories = {
  products: new LocalProductRepository(),
  warehouses: new LocalWarehouseRepository(),
  stores: new LocalStoreRepository(),
  stock: new LocalStockRepository(),
  activity: new LocalActivityRepository(),
  storageUnits: new LocalStorageUnitRepository(),
  batches: new LocalBatchRepository(),
  serials: new LocalSerialRepository(),
  reservations: new LocalReservationRepository(),
};
