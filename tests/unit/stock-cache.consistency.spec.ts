/**
 * F2 regression: no stock read that starts after a write has been acknowledged may return pre-write data.
 *
 * Deterministic interleavings with in-memory fakes (no real database or Redis):
 * - FakeDb stages writes per transaction, makes them visible only on commit, and serialises writers with row
 *   locks like SELECT ... FOR UPDATE. Its commit and reader steps can be held to force a precise interleaving.
 * - FakeRedis follows the RedisService contract (a failed invalidation disables the cache, like the real one).
 * Real concurrency on PostgreSQL is checked separately against the running app.
 */
import { randomUUID } from 'crypto';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { StockService } from '../../src/infrastructure/repositories/stock.service';

const COMPANY_A = 'company-a';
const COMPANY_B = 'company-b';
const PRODUCT = 'product-1';
const WAREHOUSE = 'warehouse-1';
const USER = 'user-1';
const rowKey = (p: unknown, w: unknown) => `${p}|${w}`;

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}
const deferred = (): Deferred => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};
const until = async (condition: () => boolean) => {
  for (let i = 0; i < 200 && !condition(); i++) await new Promise((r) => setImmediate(r));
  if (!condition()) throw new Error('condition not reached');
};

type MovementRow = Record<string, unknown>;

class FakeDb {
  balances = new Map<string, string>([[rowKey(PRODUCT, WAREHOUSE), '10.000000']]);
  movements: MovementRow[] = [];
  private locks = new Map<string, Promise<void>>();
  commitGate: Deferred | null = null;
  commitPending = false;
  readGate: Deferred | null = null;
  readPending = false;
  failInsert = false;

  private async lock(key: string, held: Array<() => void>) {
    while (this.locks.has(key)) await this.locks.get(key);
    let release!: () => void;
    this.locks.set(key, new Promise<void>((r) => (release = () => { this.locks.delete(key); r(); })));
    held.push(release);
  }

  // Readers see committed data at the moment they read; a held reader resumes later with that snapshot.
  async read<T>(snapshot: () => T): Promise<T> {
    const value = snapshot();
    if (this.readGate) {
      this.readPending = true;
      await this.readGate.promise;
      this.readPending = false;
    }
    return value;
  }

  readonly revisions = new Map<string, number>();

  createQueryRunner() {
    const staged = new Map<string, string>();
    const stagedMovements: MovementRow[] = [];
    const held: Array<() => void> = [];
    const releaseAll = () => held.splice(0).forEach((release) => release());
    return {
      connect: async () => undefined,
      startTransaction: async () => undefined,
      release: async () => undefined,
      query: async (sql: string, params: unknown[]) => {
        if (sql.includes('INSERT INTO product_warehouse')) {
          const key = rowKey(params[0], params[1]);
          if (!this.balances.has(key) && !staged.has(key)) staged.set(key, '0.000000');
          return [];
        }
        if (sql.includes('FOR UPDATE')) {
          const key = rowKey(params[0], params[1]);
          await this.lock(key, held);
          const value = staged.get(key) ?? this.balances.get(key);
          return value === undefined ? [] : [{ base_quantity: value }];
        }
        if (sql.includes('INSERT INTO stock_movements')) {
          if (this.failInsert) throw new Error('synthetic database write failure');
          const row = {
            id: randomUUID(), product_id: params[0], warehouse_id: params[1], user_id: params[2],
            movement_type: params[3], reference_type: params[4], quantity_change: params[5],
            running_balance: params[6], notes: params[7], revision: params[8], created_at: new Date(),
          };
          stagedMovements.push(row);
          return [row];
        }
        if (sql.includes('UPDATE warehouses SET stock_revision')) {
          // Stock writes number themselves per warehouse; TypeORM returns [rows, affected] for UPDATE.
          const next = (this.revisions.get(params[0] as string) ?? 0) + 1;
          this.revisions.set(params[0] as string, next);
          return [[{ stock_revision: String(next) }], 1];
        }
        if (sql.includes('UPDATE product_warehouse')) {
          staged.set(rowKey(params[1], params[2]), params[0] as string);
          return [];
        }
        throw new Error(`unexpected SQL in fake: ${sql}`);
      },
      commitTransaction: async () => {
        if (this.commitGate) {
          this.commitPending = true;
          await this.commitGate.promise;
          this.commitPending = false;
        }
        staged.forEach((value, key) => this.balances.set(key, value));
        this.movements.push(...stagedMovements);
        releaseAll();
      },
      rollbackTransaction: async () => releaseAll(),
    };
  }
}

class FakeRedis {
  store = new Map<string, string>();
  disabled = false;
  failNextInvalidation = false;
  calls = 0;
  generateKey = (prefix: string, ...args: string[]) => [prefix, ...args].join(':');
  private failed() {
    if (!this.failNextInvalidation) return false;
    this.failNextInvalidation = false;
    this.disabled = true; // RedisService.disable(): the cache is not trusted any more
    return true;
  }
  async get(key: string) { this.calls++; return this.disabled ? null : this.store.get(key) ?? null; }
  async set(key: string, value: string) { this.calls++; if (!this.disabled) this.store.set(key, value); }
  async del(key: string) { this.calls++; if (this.disabled || this.failed()) return; this.store.delete(key); }
  async getGeneration(scope: string) {
    this.calls++;
    if (this.disabled) return null;
    const key = `cache:generation:${scope}`;
    if (!this.store.has(key)) this.store.set(key, randomUUID());
    return this.store.get(key)!;
  }
  async bumpGeneration(scope: string) {
    this.calls++;
    if (this.disabled || this.failed()) return;
    this.store.set(`cache:generation:${scope}`, randomUUID());
  }
}

function setup() {
  const db = new FakeDb();
  const redis = new FakeRedis();
  const owned = (companyId: string) => companyId === COMPANY_A;
  const productRepo = { findOne: async ({ where }: any) => (where.id === PRODUCT && owned(where.companyId) ? { id: PRODUCT } : null) };
  const warehouseRepo = { findOne: async ({ where }: any) => (where.id === WAREHOUSE && owned(where.companyId) ? { id: WAREHOUSE } : null) };
  const pwRepo = {
    query: (_sql: string, params: unknown[]) =>
      db.read(() => {
        const value = db.balances.get(rowKey(params[0], params[1]));
        return value === undefined ? [] : [{ base_quantity: value }];
      }),
  };
  const movementRepo = {
    find: ({ where }: any) =>
      db.read(() =>
        db.movements
          .filter((m) => m.product_id === where.productId && (!where.warehouseId || m.warehouse_id === where.warehouseId))
          .map((m) => ({
            id: m.id, productId: m.product_id, warehouseId: m.warehouse_id, userId: m.user_id,
            movementType: m.movement_type, referenceType: m.reference_type, referenceId: null,
            quantityChange: m.quantity_change, runningBalance: m.running_balance, notes: m.notes,
            createdAt: m.created_at, warehouse: { id: m.warehouse_id, name: 'Main' }, user: { id: m.user_id, name: 'U' },
          })),
      ),
  };
  const service = new StockService(
    pwRepo as any, movementRepo as any, productRepo as any, warehouseRepo as any,
    { createQueryRunner: () => db.createQueryRunner() } as any, redis as any,
  );
  const balance = async () => (await service.getBalance(COMPANY_A, PRODUCT, WAREHOUSE)).baseQuantity;
  const history = async () => (await service.getMovements(COMPANY_A, PRODUCT)).length;
  const inbound = (quantity: string) => service.inbound(USER, COMPANY_A, { productId: PRODUCT, warehouseId: WAREHOUSE, quantity } as any);
  const outbound = (quantity: string) => service.outbound(USER, COMPANY_A, { productId: PRODUCT, warehouseId: WAREHOUSE, quantity } as any);
  return { db, redis, service, balance, history, inbound, outbound };
}

describe('F2: stock reads after an acknowledged write are never stale', () => {
  it('successful commit: the next read returns the new balance', async () => {
    const t = setup();
    expect(await t.balance()).toBe('10.000000'); // cached
    await t.inbound('5');
    expect(await t.balance()).toBe('15.000000');
  });

  it('a read while the commit is still pending cannot pin the old balance after the write returns', async () => {
    const t = setup();
    t.db.commitGate = deferred();
    const write = t.inbound('5');
    await until(() => t.db.commitPending);
    expect(await t.balance()).toBe('10.000000'); // concurrent read: old value is legitimate here
    t.db.commitGate.resolve();
    await write;
    expect(await t.balance()).toBe('15.000000');
  });

  it('a reader that read before the commit and stores after the invalidation does not leave a stale entry', async () => {
    const t = setup();
    const heldRead = deferred();
    t.db.readGate = heldRead;
    const read = t.balance(); // snapshot: 10, paused before it caches the value
    await until(() => t.db.readPending);
    t.db.readGate = null;
    await t.inbound('5'); // commit and invalidation are complete
    heldRead.resolve(); // the slow reader now stores what it read before the commit
    expect(await read).toBe('10.000000'); // concurrent with the write: old value is legitimate for this read
    expect(await t.balance()).toBe('15.000000');
  });

  it('the same race on movement history: a new movement is visible right after the write returns', async () => {
    const t = setup();
    const heldRead = deferred();
    t.db.readGate = heldRead;
    const read = t.history(); // snapshot: 0 movements, paused before caching
    await until(() => t.db.readPending);
    t.db.readGate = null;
    await t.inbound('5');
    heldRead.resolve();
    expect(await read).toBe(0); // concurrent with the write: old list is legitimate for this read
    expect(await t.history()).toBe(1);
  });

  it('rollback (insufficient stock): balance and cached value stay correct', async () => {
    const t = setup();
    expect(await t.balance()).toBe('10.000000');
    await expect(t.outbound('50')).rejects.toBeInstanceOf(ConflictException);
    expect(t.db.balances.get(rowKey(PRODUCT, WAREHOUSE))).toBe('10.000000');
    expect(await t.balance()).toBe('10.000000');
  });

  it('database write failure: the write is rejected and reads stay correct', async () => {
    const t = setup();
    expect(await t.balance()).toBe('10.000000');
    t.db.failInsert = true;
    await expect(t.inbound('5')).rejects.toThrow('synthetic database write failure');
    t.db.failInsert = false;
    expect(await t.balance()).toBe('10.000000');
    expect(t.db.movements).toHaveLength(0);
  });

  it('cache invalidation failure: the write succeeds and later reads come from the database', async () => {
    const t = setup();
    expect(await t.balance()).toBe('10.000000');
    t.redis.failNextInvalidation = true;
    await t.inbound('5');
    expect(await t.balance()).toBe('15.000000');
  });

  it('Redis disconnected: every read is served correctly from the database', async () => {
    const t = setup();
    t.redis.disabled = true;
    await t.inbound('5');
    expect(await t.balance()).toBe('15.000000');
    expect(await t.history()).toBe(1);
  });

  it('competing writers are serialised: exactly one of two overdrawing outbounds succeeds', async () => {
    const t = setup();
    const results = await Promise.allSettled([t.outbound('6'), t.outbound('6')]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(await t.balance()).toBe('4.000000');
    expect(await t.history()).toBe(1);
  });

  it('cross-company access is rejected before any cache access', async () => {
    const t = setup();
    await t.balance();
    const before = t.redis.calls;
    await expect(t.service.getBalance(COMPANY_B, PRODUCT, WAREHOUSE)).rejects.toBeInstanceOf(NotFoundException);
    await expect(t.service.getMovements(COMPANY_B, PRODUCT)).rejects.toBeInstanceOf(NotFoundException);
    expect(t.redis.calls).toBe(before);
  });
});
