/**
 * Series 07 on a real PostgreSQL: safe replacement of an operation that a history change erased (S1) and the
 * history-generation contract (S2).
 *
 * "Restores" here rewind a warehouse of a throwaway company inside the test database, as a backup restore would (the
 * movements after a revision and their key records disappear, the counter and the balance go back). Nothing here talks to
 * a hosted database. Needs a PostgreSQL and JWT secrets; skipped without them.
 *
 * Invariants exercised (numbers refer to the Series 07 mandate): I1 no automatic replay, I3 human decision (acknowledge +
 * authenticated), I4 state semantics, I5 server-side atomicity, I6 provenance, I7 security, I9/I10 compatibility.
 */
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { randomBytes, randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { AppModule } from '@/app.module';

const RUN = Boolean(process.env.DB_HOST && process.env.JWT_ACCESS_SECRET && process.env.JWT_REFRESH_SECRET);
const TAG = randomBytes(4).toString('hex');
const password = () => `Aa1!${randomBytes(8).toString('hex')}`;
const ROTATE_CONFIRM = 'ROTATE_HISTORY_GENERATION';
const REASON = 'Restore of the primary database from the 02:00 snapshot after an incident (test)';

interface Receipt { id: string; revision: string; historyGeneration: string }

(RUN ? describe : describe.skip)('recovery integrity: safe replacement and history generations (PostgreSQL)', () => {
  jest.setTimeout(240_000);
  let app: INestApplication;
  let db: DataSource;
  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  let owner: string; let ownerId: string;
  let manager: string;
  let staff: string; let staffId: string;
  let otherOwner: string;
  let w1: string; let w2: string;
  let product: string;
  let companyId: string;
  let otherCompanyId: string;

  const move = (token: string, kind: 'inbound' | 'outbound', quantity: string, key: string, warehouseId = w1) =>
    http().post(`/api/v1/stock/${kind}`).set(auth(token)).set('Idempotency-Key', key)
      .send({ productId: product, warehouseId, quantity });
  const lookup = (token: string, operations: Array<{ key: string; movementId?: string }>) =>
    http().post('/api/v1/stock/operations/lookup').set(auth(token)).send({ operations }).expect(200).then((r) => r.body as {
      generation: string; operations: Array<Record<string, any>>;
    });
  const changes = (token: string, query: Record<string, string> = {}, warehouseId = w1) =>
    http().get(`/api/v1/stock/changes/${warehouseId}`).set(auth(token)).query(query);
  const generationOf = async () =>
    (await db.query(`SELECT history_generation::text AS g FROM companies WHERE id = $1`, [companyId]))[0].g as string;
  const revisionOf = async (w = w1) =>
    (await db.query(`SELECT stock_revision::text AS r FROM warehouses WHERE id = $1`, [w]))[0].r as string;
  const balanceOf = async (w = w1) =>
    Number((await db.query(`SELECT base_quantity FROM product_warehouse WHERE product_id = $1 AND warehouse_id = $2`, [product, w]))[0]?.base_quantity ?? 0);
  const movementCount = async () => (await db.query(`SELECT count(*)::int AS n FROM stock_movements`))[0].n as number;
  const replacementRows = async () => db.query(`SELECT * FROM stock_replacements WHERE company_id = $1 ORDER BY created_at`, [companyId]);

  const rotate = (token: string, body: object = { reason: REASON, confirm: ROTATE_CONFIRM }) =>
    http().post('/api/v1/recovery/history-generation/rotate').set(auth(token)).send(body);

  const body = (key: string, receipt: Receipt, generation: string, quantity = '4', extra: object = {}) => ({
    originalKey: key, originalMovementId: receipt.id, productId: product, warehouseId: w1, quantity,
    expectedGeneration: generation, acknowledge: true, receiptRevision: receipt.revision,
    receiptConfirmedAt: '2026-10-24T20:00:00.000Z', receiptGeneration: receipt.historyGeneration, ...extra,
  });
  const replace = (token: string, kind: 'inbound' | 'outbound', replacementKey: string, payload: object) =>
    http().post(`/api/v1/stock/replacements/${kind}`).set(auth(token)).set('Idempotency-Key', replacementKey).send(payload);

  /** Rewinds `w` to `revision`: later movements and the key records of those movements are gone. */
  const restoreTo = async (revision: string, opts: { keepKeyRecords?: boolean; warehouseId?: string } = {}) => {
    const w = opts.warehouseId ?? w1;
    await db.transaction(async (m) => {
      const gone: Array<{ id: string }> = await m.query(`SELECT id FROM stock_movements WHERE warehouse_id = $1 AND revision > $2`, [w, revision]);
      await m.query(`DELETE FROM stock_movements WHERE warehouse_id = $1 AND revision > $2`, [w, revision]);
      if (!opts.keepKeyRecords && gone.length) {
        await m.query(`DELETE FROM stock_idempotency_keys WHERE response->>'id' = ANY($1::text[])`, [gone.map((g) => g.id)]);
      }
      await m.query(
        `UPDATE product_warehouse pw SET base_quantity = COALESCE(
           (SELECT running_balance FROM stock_movements WHERE warehouse_id = $1 AND product_id = $2 ORDER BY revision DESC LIMIT 1), 0)
         WHERE pw.warehouse_id = $1 AND pw.product_id = $2`, [w, product]);
      await m.query(`UPDATE warehouses SET stock_revision = $2 WHERE id = $1`, [w, revision]);
    });
  };

  /** The erased original comes back as a ledger row (a late request, a second restore, an operator re-import). */
  const reinsertOriginal = async (receipt: Receipt, quantity: number) => {
    const next = String(Number(await revisionOf()) + 1);
    await db.query(
      `INSERT INTO stock_movements (id, product_id, warehouse_id, user_id, movement_type, reference_type, quantity_change, running_balance, revision)
       VALUES ($1, $2, $3, $4, 'OUTBOUND', 'SALE', $5, $6, $7)`, [receipt.id, product, w1, staffId, -quantity, await balanceOf(), next]);
    await db.query(`UPDATE warehouses SET stock_revision = $2 WHERE id = $1`, [w1, next]);
  };

  /** The user's operation: confirmed, then erased by a restore. Returns what the client keeps (key + receipt). */
  const lostOperation = async (token: string, kind: 'inbound' | 'outbound' = 'outbound', quantity = '4') => {
    const before = await revisionOf();
    const key = randomUUID();
    const sent = (await move(token, kind, quantity, key).expect(201)).body as Receipt;
    await restoreTo(before);
    return { key, receipt: sent };
  };

  beforeAll(async () => {
    process.env.RECOVERY_OPERATIONS_ENABLED = 'true';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, '127.0.0.1'); // listen once: concurrent supertest requests otherwise reset each other's sockets
    db = app.get(DataSource);

    const reg = await http().post('/api/v1/auth/register').send({
      companyName: `Recovery ${TAG}`, name: 'Owner', email: `rec.${TAG}@example.test`, password: password(),
    }).expect(201);
    owner = reg.body.accessToken; ownerId = reg.body.user.id;
    w1 = reg.body.defaultWarehouse.id;
    companyId = reg.body.user.companyId ?? (await db.query(`SELECT company_id FROM users WHERE id = $1`, [ownerId]))[0].company_id;
    w2 = (await http().post('/api/v1/warehouses').set(auth(owner)).send({ name: 'Second' }).expect(201)).body.id;
    product = (await http().post('/api/v1/products').set(auth(owner)).send({ name: 'Bolt', sku: `RC-${TAG}` }).expect(201)).body.id;
    await move(owner, 'inbound', '500', randomUUID()).expect(201);
    await move(owner, 'inbound', '50', randomUUID(), w2).expect(201);

    const invite = (b: object) => http().post('/api/v1/team/invitations').set(auth(owner)).send(b).expect(201);
    const m = await invite({ email: `rc.manager.${TAG}@example.test`, role: 'Manager' });
    const s = await invite({ email: `rc.staff.${TAG}@example.test`, role: 'Staff', warehouseIds: [w1, w2] });
    manager = (await http().post('/api/v1/auth/accept-invitation').send({ token: m.body.token, name: 'M', password: password() }).expect(201)).body.accessToken;
    const joined = await http().post('/api/v1/auth/accept-invitation').send({ token: s.body.token, name: 'S', password: password() }).expect(201);
    staff = joined.body.accessToken; staffId = joined.body.user.id;

    const other = await http().post('/api/v1/auth/register').send({
      companyName: `Other ${TAG}`, name: 'Other', email: `rc.other.${TAG}@example.test`, password: password(),
    }).expect(201);
    otherOwner = other.body.accessToken;
    otherCompanyId = (await db.query(`SELECT company_id FROM users WHERE id = $1`, [other.body.user.id]))[0].company_id;
  });

  afterAll(async () => {
    delete process.env.RECOVERY_OPERATIONS_ENABLED;
    await app?.close();
  });

  // ============================================================================================ S2: generations

  describe('S2: history generation', () => {
    it('every sync answer and every lookup carries the company generation; ordinary activity never changes it; no-store', async () => {
      const g = await generationOf();
      const snap = await changes(staff).expect(200);
      expect(snap.body).toMatchObject({ mode: 'snapshot', generation: g, reset: false });
      expect(snap.headers['cache-control']).toBe('no-store');
      await move(staff, 'inbound', '1', randomUUID()).expect(201);
      const delta = await changes(staff, { since: snap.body.revision, anchor: snap.body.anchor ?? '', generation: g }).expect(200);
      expect(delta.body).toMatchObject({ mode: 'delta', generation: g, reset: false });
      expect((await lookup(staff, [{ key: randomUUID() }])).generation).toBe(g);
      expect(await generationOf()).toBe(g);
    });

    it('a malformed generation is a 400, not a silent pass', async () => {
      await changes(staff, { since: '1', generation: 'not-a-uuid' }).expect(400);
    });

    it('a rotation answers a client that holds the old generation with a snapshot and reset, though its cursor is valid', async () => {
      const g1 = await generationOf();
      const snap = (await changes(staff).expect(200)).body;
      const rotated = (await rotate(owner).expect(200)).body;
      expect(rotated.previousGeneration).toBe(g1);
      expect(rotated.generation).not.toBe(g1);

      const after = (await changes(staff, { since: snap.revision, anchor: snap.anchor ?? '', generation: g1 }).expect(200)).body;
      expect(after).toMatchObject({ mode: 'snapshot', reset: true, resetReason: 'generation', generation: rotated.generation });
      // having adopted the new generation, the same cursor continues normally
      const again = (await changes(staff, { since: after.revision, anchor: after.anchor ?? '', generation: rotated.generation }).expect(200)).body;
      expect(again).toMatchObject({ mode: 'delta', reset: false, generation: rotated.generation });
    });

    it('revision numbers reused after a restore cannot hide a generation change; a legacy client below the floor is reset once', async () => {
      const g1 = await generationOf();
      const before = await revisionOf();
      const sent = (await move(staff, 'outbound', '2', randomUUID()).expect(201)).body as Receipt; // takes revision before+1
      const clientCursor = { since: sent.revision, generation: g1 }; // a client that applied it, WITHOUT an anchor
      await restoreTo(before);
      const reused = (await move(manager, 'outbound', '1', randomUUID()).expect(201)).body as Receipt;
      expect(reused.revision).toBe(sent.revision); // same number, a different movement
      expect(reused.id).not.toBe(sent.id);

      // without the generation contract nothing tells this cursor apart from the new history (the pre-Series-07 gap)
      const old = (await changes(staff, { since: clientCursor.since }).expect(200)).body;
      expect(old.reset).toBe(false);

      await move(manager, 'inbound', '1', randomUUID()).expect(201); // history moves on: the floor will lie above the cursor
      const rotated = (await rotate(owner).expect(200)).body;
      const upgraded = (await changes(staff, { since: sent.revision, generation: g1 }).expect(200)).body;
      expect(upgraded).toMatchObject({ mode: 'snapshot', reset: true, resetReason: 'generation' });
      const legacy = (await changes(staff, { since: sent.revision }).expect(200)).body; // no generation sent
      expect(legacy).toMatchObject({ mode: 'snapshot', reset: true, resetReason: 'floor' });
      // a legacy client that is at or above the floor (it re-synced after the rotation) continues
      const current = await revisionOf();
      expect((await changes(staff, { since: current }).expect(200)).body).toMatchObject({ mode: 'delta', reset: false });
      expect(rotated.warehouseFloors[w1]).toBe(current);
    });

    it('several generations in a row: each rotation invalidates exactly the clients that have not adopted it', async () => {
      const g = [await generationOf()];
      for (let i = 0; i < 3; i++) g.push((await rotate(owner).expect(200)).body.generation);
      expect(new Set(g).size).toBe(4);
      const rev = await revisionOf();
      for (const old of g.slice(0, 3)) {
        expect((await changes(staff, { since: rev, generation: old }).expect(200)).body).toMatchObject({ reset: true, resetReason: 'generation' });
      }
      expect((await changes(staff, { since: rev, generation: g[3] }).expect(200)).body).toMatchObject({ reset: false, mode: 'delta' });
    });

    it('a 304 (If-None-Match) cannot hide a generation change: the body, and so the ETag, carries the generation', async () => {
      const first = await changes(staff).expect(200);
      const etag = first.headers.etag as string;
      expect(etag).toBeTruthy();
      await changes(staff).set('If-None-Match', etag).expect(304); // unchanged history: revalidation works
      await rotate(owner).expect(200);
      const after = await changes(staff).set('If-None-Match', etag).expect(200); // changed generation: a full answer
      expect(after.body.generation).not.toBe(first.body.generation);
      expect(after.headers.etag).not.toBe(etag);
    });

    it('rotation is authenticated, Admin-only, switchable off, confirmed and reasoned; and audited', async () => {
      await http().post('/api/v1/recovery/history-generation/rotate').send({ reason: REASON, confirm: ROTATE_CONFIRM }).expect(401);
      await rotate(staff).expect(403);
      await rotate(manager).expect(403);
      await http().get('/api/v1/recovery/history-generation').set(auth(manager)).expect(403);
      await rotate(owner, { reason: 'too short', confirm: ROTATE_CONFIRM }).expect(400);
      await rotate(owner, { reason: REASON, confirm: 'yes' }).expect(400);
      await rotate(owner, { reason: REASON }).expect(400);

      process.env.RECOVERY_OPERATIONS_ENABLED = 'false';
      try {
        const off = await rotate(owner).expect(403);
        expect(off.body.code).toBe('recovery-disabled');
      } finally {
        process.env.RECOVERY_OPERATIONS_ENABLED = 'true';
      }

      const g = await generationOf();
      const ok = (await rotate(owner).expect(200)).body;
      const [event] = await db.query(
        `SELECT * FROM history_generation_events WHERE company_id = $1 ORDER BY created_at DESC LIMIT 1`, [companyId]);
      expect(event).toMatchObject({ actor_user_id: ownerId, reason: REASON, kind: 'rotation' });
      expect(event.previous_generation).toBe(g);
      expect(event.new_generation).toBe(ok.generation);
      expect(event.warehouse_floors[w1]).toBe(await revisionOf(w1));
      await new Promise((r) => setTimeout(r, 400)); // audit writes are asynchronous
      const audit = await db.query(`SELECT actor_user_id, status_code FROM audit_logs WHERE http_path LIKE '%history-generation/rotate%' ORDER BY created_at DESC LIMIT 1`);
      expect(audit[0]).toMatchObject({ actor_user_id: ownerId, status_code: 200 });

      const view = (await http().get('/api/v1/recovery/history-generation').set(auth(owner)).expect(200)).body;
      expect(view.generation).toBe(ok.generation);
      expect(view.events[0]).toMatchObject({ newGeneration: ok.generation, actorUserId: ownerId });
    });

    it('rotating one company never touches another: tenant isolation of the generation and of the events', async () => {
      const otherBefore = (await db.query(`SELECT history_generation::text AS g FROM companies WHERE id = $1`, [otherCompanyId]))[0].g;
      await rotate(owner).expect(200);
      expect((await db.query(`SELECT history_generation::text AS g FROM companies WHERE id = $1`, [otherCompanyId]))[0].g).toBe(otherBefore);
      expect((await http().get('/api/v1/recovery/history-generation').set(auth(otherOwner)).expect(200)).body.events).toEqual([]);
    });

    it('the receipt of a write names the generation it was issued in, and a replay keeps it', async () => {
      const g1 = await generationOf();
      const key = randomUUID();
      const first = (await move(staff, 'inbound', '1', key).expect(201)).body;
      await rotate(owner).expect(200);
      const replayed = (await move(staff, 'inbound', '1', key).expect(201)).body;
      expect(first.historyGeneration).toBe(g1);
      expect(replayed).toMatchObject({ replayed: true, id: first.id, historyGeneration: g1 }); // the history it was committed in
      expect((await move(staff, 'inbound', '1', randomUUID()).expect(201)).body.historyGeneration).toBe(await generationOf());
    });
  });

  // ================================================================================================== S1: replace

  describe('S1: server-enforced replacement', () => {
    it('replaces an operation the history lost: new movement, own key, provenance, structured outcome; a repeat replays it', async () => {
      const { key, receipt } = await lostOperation(staff);
      expect((await lookup(staff, [{ key, movementId: receipt.id }])).operations[0]).toEqual({ key, status: 'absent' });
      const g = await generationOf();
      const stockBefore = await balanceOf();
      const revBefore = Number(await revisionOf());
      const count = await movementCount();

      const rk = randomUUID();
      const res = await replace(staff, 'outbound', rk, body(key, receipt, g)).expect(201);
      expect(res.body).toMatchObject({
        outcome: 'replaced', productId: product, warehouseId: w1, userId: staffId, movementType: 'OUTBOUND',
        historyGeneration: g, replacement: { originalKey: key, originalMovementId: receipt.id, generationAtDecision: g },
      });
      expect(res.body.id).not.toBe(receipt.id);
      expect(Number(res.body.revision)).toBe(revBefore + 1);
      expect(Number(res.body.quantityChange)).toBe(-4);
      expect(await balanceOf()).toBe(stockBefore - 4); // the ledger moved once
      expect(await movementCount()).toBe(count + 1);

      const [mv] = await db.query(`SELECT notes, user_id FROM stock_movements WHERE id = $1`, [res.body.id]);
      expect(mv.user_id).toBe(staffId);
      expect(mv.notes).toBe(`Replacement of action ${key.slice(0, 8)} (absent from server history after a restore)`);

      const [prov] = await replacementRows();
      expect(prov).toMatchObject({
        actor_user_id: staffId, warehouse_id: w1, original_key: key, original_movement_id: receipt.id,
        replacement_key: rk, replacement_movement_id: res.body.id, generation_at_decision: g, original_status: 'absent',
      });
      expect(prov.original_claim).toMatchObject({ kind: 'outbound', quantity: '4', receiptRevision: receipt.revision, claimedByClient: true });

      // the same request again (lost response, double tap, app restart): the stored outcome, no second movement
      const repeat = await replace(staff, 'outbound', rk, body(key, receipt, g)).expect(201);
      expect(repeat.body).toMatchObject({ replayed: true, id: res.body.id, outcome: 'replaced' });
      expect(await movementCount()).toBe(count + 1);
      expect(await balanceOf()).toBe(stockBefore - 4);
      expect((await replacementRows()).length).toBe(1);

      // later, the delta carries the replacement like any movement
      const delta = (await changes(staff, { since: String(revBefore), generation: g }).expect(200)).body;
      expect(delta.movements.map((m: { id: string }) => m.id)).toContain(res.body.id);
    });

    it('lookup afterwards: the original is "superseded" (indeterminate, never absent), the replacement is present and linked', async () => {
      const { key, receipt } = await lostOperation(staff, 'inbound', '3');
      const g = await generationOf();
      const rk = randomUUID();
      const done = (await replace(staff, 'inbound', rk, body(key, receipt, g, '3')).expect(201)).body;
      const [orig, repl] = (await lookup(staff, [{ key, movementId: receipt.id }, { key: rk }])).operations;
      expect(orig).toEqual({ key, status: 'indeterminate', reason: 'superseded', replacement: { key: rk, movementId: done.id, present: true } });
      expect(repl).toMatchObject({ key: rk, status: 'present', movement: { id: done.id }, replacementOf: { key, movementId: receipt.id, originalPresent: false } });
    });

    it('refuses while the original is present (key record), and changes nothing', async () => {
      const key = randomUUID();
      const sent = (await move(staff, 'outbound', '2', key).expect(201)).body as Receipt;
      const snap = [await movementCount(), await balanceOf(), await revisionOf(), (await replacementRows()).length];
      const res = await replace(staff, 'outbound', randomUUID(), body(key, sent, await generationOf(), '2')).expect(409);
      expect(res.body).toMatchObject({ code: 'original-present', details: { movementId: sent.id } });
      expect([await movementCount(), await balanceOf(), await revisionOf(), (await replacementRows()).length]).toEqual(snap);
      // and nothing fenced the key: a retry of the ORIGINAL is still just a replay
      expect((await move(staff, 'outbound', '2', key).expect(201)).body.replayed).toBe(true);
    });

    it('refuses by the receipt movement id when the key record was cleaned up but the movement stayed', async () => {
      const key = randomUUID();
      const sent = (await move(staff, 'outbound', '1', key).expect(201)).body as Receipt;
      await db.query(`DELETE FROM stock_idempotency_keys WHERE idempotency_key = $1`, [key]);
      const res = await replace(staff, 'outbound', randomUUID(), body(key, sent, await generationOf(), '1')).expect(409);
      expect(res.body.code).toBe('original-present');
      // the fence was rolled back with the refusal: no tombstone is left behind
      expect(await db.query(`SELECT 1 FROM stock_idempotency_keys WHERE idempotency_key = $1`, [key])).toEqual([]);
    });

    it('fails closed when the evidence is partial: a key record without its movement is indeterminate', async () => {
      const before = await revisionOf();
      const key = randomUUID();
      const sent = (await move(staff, 'outbound', '1', key).expect(201)).body as Receipt;
      await restoreTo(before, { keepKeyRecords: true });
      const res = await replace(staff, 'outbound', randomUUID(), body(key, sent, await generationOf(), '1')).expect(409);
      expect(res.body).toMatchObject({ code: 'original-indeterminate', details: { reason: 'receipt-without-movement' } });
      expect((await replacementRows()).filter((p: { original_key: string }) => p.original_key === key)).toEqual([]);
    });

    it('fails closed when a request with the original key has not finished (claim without response)', async () => {
      const key = randomUUID();
      await db.query(`INSERT INTO stock_idempotency_keys (company_id, user_id, idempotency_key, request_hash) VALUES ($1, $2, $3, repeat('c', 64))`, [companyId, staffId, key]);
      const res = await replace(staff, 'outbound', randomUUID(), body(key, { id: randomUUID(), revision: '1', historyGeneration: await generationOf() }, await generationOf(), '1')).expect(409);
      expect(res.body).toMatchObject({ code: 'original-indeterminate', details: { reason: 'in-progress' } });
      await db.query(`DELETE FROM stock_idempotency_keys WHERE idempotency_key = $1`, [key]);
    });

    it('fails closed when the original lives in a warehouse the caller may no longer use', async () => {
      const key = randomUUID();
      const sentInW2 = (await move(staff, 'outbound', '1', key, w2).expect(201)).body as Receipt;
      await http().put(`/api/v1/team/members/${staffId}/warehouses`).set(auth(owner)).send({ warehouseIds: [w1] }).expect(200);
      try {
        const res = await replace(staff, 'outbound', randomUUID(), body(key, sentInW2, await generationOf(), '1')).expect(409);
        expect(res.body.code).toBe('original-unavailable');
        expect(res.body.details ?? {}).not.toHaveProperty('movementId'); // nothing about it is disclosed
      } finally {
        await http().put(`/api/v1/team/members/${staffId}/warehouses`).set(auth(owner)).send({ warehouseIds: [w1, w2] }).expect(200);
      }
    });

    it('the original becomes present between the review and the submission: refused, and stock is unchanged', async () => {
      const { key, receipt } = await lostOperation(staff);
      const g = await generationOf();
      expect((await lookup(staff, [{ key, movementId: receipt.id }])).operations[0].status).toBe('absent');
      // the original comes back (a late request, a second restore, an operator re-import): its key record and movement
      const snap = [await balanceOf(), await revisionOf(), (await replacementRows()).length];
      await reinsertOriginal(receipt, 4);
      await db.query(
        `INSERT INTO stock_idempotency_keys (company_id, user_id, idempotency_key, request_hash, response) VALUES ($1, $2, $3, repeat('d', 64), $4::jsonb)`,
        [companyId, staffId, key, JSON.stringify({ id: receipt.id })]);
      const res = await replace(staff, 'outbound', randomUUID(), body(key, receipt, g)).expect(409);
      expect(res.body.code).toBe('original-present');
      expect(await balanceOf()).toBe(snap[0]);
      expect((await replacementRows()).length).toBe(snap[2]);
    });

    it('a late request with the original key after the replacement is refused, never applied', async () => {
      const { key, receipt } = await lostOperation(staff);
      const g = await generationOf();
      await replace(staff, 'outbound', randomUUID(), body(key, receipt, g)).expect(201);
      const count = await movementCount();
      const late = await move(staff, 'outbound', '4', key).expect(422); // fenced: "already used for a different request"
      expect(String(late.body.message)).toMatch(/Idempotency-Key/);
      expect(await movementCount()).toBe(count);
    });

    it('the original and the replacement race: exactly one wins, the stock moves once, over many rounds', async () => {
      const wins = { original: 0, replacement: 0 };
      for (let i = 0; i < 12; i++) {
        const before = await revisionOf();
        const key = randomUUID();
        const sent = (await move(staff, 'inbound', '1', key).expect(201)).body as Receipt;
        await restoreTo(before); // the original is gone; its request is "in flight" again
        const g = await generationOf();
        const stock = await balanceOf();
        const [orig, repl] = await Promise.all([
          move(staff, 'inbound', '1', key),
          replace(staff, 'inbound', randomUUID(), body(key, sent, g, '1')),
        ]);
        if (orig.status === 201) {
          // the original request landed first: the replacement sees it in the history and refuses
          expect(repl.status).toBe(409);
          expect(repl.body.code).toBe('original-present');
          wins.original++;
        } else {
          // the replacement fenced the key first: the late original is refused, not applied
          expect(orig.status).toBe(422);
          expect(repl.status).toBe(201);
          wins.replacement++;
        }
        expect(await balanceOf()).toBe(stock + 1); // exactly one unit entered, whichever won
      }
      expect(wins.original + wins.replacement).toBe(12);
    });

    it('concurrent replacements of one operation with different keys: one movement, the others are "already replaced"', async () => {
      const { key, receipt } = await lostOperation(staff);
      const g = await generationOf();
      const stock = await balanceOf();
      const count = await movementCount();
      const results = await Promise.all(Array.from({ length: 8 }, () => replace(staff, 'outbound', randomUUID(), body(key, receipt, g))));
      const ok = results.filter((r) => r.status === 201);
      const refused = results.filter((r) => r.status === 409);
      expect(ok.length).toBe(1);
      expect(refused.length).toBe(7);
      for (const r of refused) expect(r.body.code).toBe('already-replaced');
      expect(await movementCount()).toBe(count + 1);
      expect(await balanceOf()).toBe(stock - 4);
      expect((await replacementRows()).filter((p: { original_key: string }) => p.original_key === key).length).toBe(1);
    });

    it('concurrent identical requests (double tap): one movement, the rest replay it', async () => {
      const { key, receipt } = await lostOperation(staff);
      const g = await generationOf();
      const rk = randomUUID();
      const stock = await balanceOf();
      const results = await Promise.all(Array.from({ length: 8 }, () => replace(staff, 'outbound', rk, body(key, receipt, g))));
      expect(results.every((r) => r.status === 201)).toBe(true);
      expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
      expect(results.filter((r) => !r.body.replayed).length).toBe(1);
      expect(await balanceOf()).toBe(stock - 4);
    });

    it('the same replacement key with a different request is refused (422), nothing applied', async () => {
      const { key, receipt } = await lostOperation(staff);
      const g = await generationOf();
      const rk = randomUUID();
      await replace(staff, 'outbound', rk, body(key, receipt, g)).expect(201);
      const other = await lostOperation(staff);
      const count = await movementCount();
      await replace(staff, 'outbound', rk, body(other.key, other.receipt, g)).expect(422);
      expect(await movementCount()).toBe(count);
    });

    it('a changed generation refuses with the current one; the person reviews again, and a new attempt succeeds', async () => {
      const { key, receipt } = await lostOperation(staff);
      const reviewed = await generationOf();
      const rotated = (await rotate(owner).expect(200)).body.generation;
      const rk = randomUUID();
      const stale = await replace(staff, 'outbound', rk, body(key, receipt, reviewed)).expect(409);
      expect(stale.body).toMatchObject({ code: 'stale-generation', details: { currentGeneration: rotated } });
      expect((await replacementRows()).filter((p: { original_key: string }) => p.original_key === key)).toEqual([]);
      expect(await db.query(`SELECT 1 FROM stock_idempotency_keys WHERE idempotency_key = ANY($1)`, [[key, rk]])).toEqual([]); // fence and claim rolled back
      const ok = (await replace(staff, 'outbound', randomUUID(), body(key, receipt, rotated)).expect(201)).body;
      expect(ok.historyGeneration).toBe(rotated);
      expect(receipt.historyGeneration).not.toBe(rotated); // original and replacement receipts: different generations
      expect((await replacementRows()).find((p: { original_key: string }) => p.original_key === key)).toMatchObject({ generation_at_decision: rotated });
    });

    it('rotation and replacement race: never a 5xx, and every committed replacement is recorded under the generation it saw', async () => {
      for (let i = 0; i < 6; i++) {
        const { key, receipt } = await lostOperation(staff, 'inbound', '1');
        const g = await generationOf();
        const [rot, rep] = await Promise.all([rotate(owner), replace(staff, 'inbound', randomUUID(), body(key, receipt, g, '1'))]);
        expect(rot.status).toBe(200);
        expect([201, 409]).toContain(rep.status);
        if (rep.status === 201) {
          expect(rep.body.replacement.generationAtDecision).toBe(g);
        } else {
          expect(rep.body.code).toBe('stale-generation');
        }
      }
    });

    it('outbound replacement the stock cannot cover: refused as insufficient-stock, nothing fenced, works once stock exists', async () => {
      const { key, receipt } = await lostOperation(staff, 'outbound', '4');
      const g = await generationOf();
      const have = await balanceOf();
      await db.query(`UPDATE product_warehouse SET base_quantity = 1 WHERE product_id = $1 AND warehouse_id = $2`, [product, w1]);
      const rk = randomUUID();
      try {
        const res = await replace(staff, 'outbound', rk, body(key, receipt, g)).expect(409);
        expect(res.body.code).toBe('insufficient-stock');
        expect(await db.query(`SELECT 1 FROM stock_idempotency_keys WHERE idempotency_key = ANY($1)`, [[key, rk]])).toEqual([]);
      } finally {
        await db.query(`UPDATE product_warehouse SET base_quantity = $3 WHERE product_id = $1 AND warehouse_id = $2`, [product, w1, have]);
      }
      await replace(staff, 'outbound', rk, body(key, receipt, g)).expect(201); // the same key and request, now possible
    });

    it('security: authentication, permissions, warehouse access, tenant boundaries, and revoked access during the review', async () => {
      const { key, receipt } = await lostOperation(staff);
      const g = await generationOf();
      const payload = body(key, receipt, g);
      await http().post('/api/v1/stock/replacements/outbound').set('Idempotency-Key', randomUUID()).send(payload).expect(401);
      // another company's user cannot name this company's warehouse
      await replace(otherOwner, 'outbound', randomUUID(), payload).expect(404);
      // revoked while the screen was open: refused immediately, nothing recorded
      await http().put(`/api/v1/team/members/${staffId}/warehouses`).set(auth(owner)).send({ warehouseIds: [] }).expect(200);
      try {
        await replace(staff, 'outbound', randomUUID(), payload).expect(404);
      } finally {
        await http().put(`/api/v1/team/members/${staffId}/warehouses`).set(auth(owner)).send({ warehouseIds: [w1, w2] }).expect(200);
      }
      expect((await replacementRows()).filter((p: { original_key: string }) => p.original_key === key)).toEqual([]);
      // a Manager using the staff member's key id gets only a movement of their OWN: the staff key space is not fenced
      const own = (await replace(manager, 'outbound', randomUUID(), payload).expect(201)).body;
      expect(own.userId).not.toBe(staffId);
      expect((await lookup(staff, [{ key, movementId: receipt.id }])).operations[0]).toEqual({ key, status: 'absent' });
      expect((await lookup(manager, [{ key }])).operations[0]).toMatchObject({ status: 'indeterminate', reason: 'superseded' });
      expect((await lookup(otherOwner, [{ key }])).operations[0]).toEqual({ key, status: 'absent' });
    });

    it('validation: the idempotency key, the evidence and the explicit decision are all required; nothing extra is accepted', async () => {
      const { key, receipt } = await lostOperation(staff);
      const g = await generationOf();
      const good = body(key, receipt, g);
      const send = (b: object, k: string | null = randomUUID()) => {
        const req = http().post('/api/v1/stock/replacements/outbound').set(auth(staff));
        return (k ? req.set('Idempotency-Key', k) : req).send(b);
      };
      await send(good, null).expect(400); // no Idempotency-Key
      await send(good, 'short').expect(400);
      await send(good, key).expect(400); // the replacement needs its OWN key
      await send({ ...good, acknowledge: false }).expect(400); // no human decision
      const { acknowledge: _a, ...noAck } = good;
      await send(noAck).expect(400);
      const { originalMovementId: _m, ...noEvidence } = good;
      await send(noEvidence).expect(400); // required evidence missing: fail closed
      await send({ ...good, expectedGeneration: 'nope' }).expect(400);
      await send({ ...good, quantity: '-1' }).expect(400);
      await send({ ...good, extra: 'x' }).expect(400);
      await send({ ...good, quantity: '0' }).expect(400);
      expect((await replacementRows()).filter((p: { original_key: string }) => p.original_key === key)).toEqual([]);
    });

    it('audit: the replacement is attributed to its actor and carries no credentials', async () => {
      const { key, receipt } = await lostOperation(staff, 'inbound', '1');
      await replace(staff, 'inbound', randomUUID(), body(key, receipt, await generationOf(), '1')).expect(201);
      await new Promise((r) => setTimeout(r, 400));
      const rows = await db.query(
        `SELECT actor_user_id, entity_type, status_code, new_values FROM audit_logs WHERE http_path LIKE '%replacements/inbound%' ORDER BY created_at DESC LIMIT 1`);
      expect(rows[0]).toMatchObject({ actor_user_id: staffId, entity_type: 'stock', status_code: 201 });
      expect(JSON.stringify(rows[0].new_values)).not.toMatch(/Bearer|eyJ|password/i);
    });

    it('later restores: the original and the replacement coexisting is flagged, with both identities, and nothing is changed', async () => {
      const { key, receipt } = await lostOperation(staff, 'outbound', '2');
      const g = await generationOf();
      const rk = randomUUID();
      const done = (await replace(staff, 'outbound', rk, body(key, receipt, g, '2')).expect(201)).body;
      // an operator re-imports the lost ledger row (runbook section 4): the original is back next to its replacement
      await reinsertOriginal(receipt, 2);
      const stock =[await balanceOf(), await movementCount(), await revisionOf()];
      const [orig, repl] = (await lookup(staff, [{ key, movementId: receipt.id }, { key: rk }])).operations;
      expect(orig).toMatchObject({ status: 'present', reason: 'coexisting-replacement', movement: { id: receipt.id }, replacement: { key: rk, movementId: done.id, present: true } });
      expect(repl).toMatchObject({ status: 'present', reason: 'coexisting-replacement', replacementOf: { key, movementId: receipt.id, originalPresent: true } });
      expect([await balanceOf(), await movementCount(), await revisionOf()]).toEqual(stock); // lookups never change history
      // the operator's evidence query (runbook): the coexisting pairs
      const pairs = await db.query(
        `SELECT r.original_key, r.replacement_key FROM stock_replacements r
         WHERE r.company_id = $1 AND EXISTS (SELECT 1 FROM stock_movements o WHERE o.id = r.original_movement_id)
           AND EXISTS (SELECT 1 FROM stock_movements n WHERE n.id = r.replacement_movement_id)`, [companyId]);
      expect(pairs.map((p: { original_key: string }) => p.original_key)).toContain(key);
    });

    it('a second restore that removes the replacement but brings the original back: the original is present, the replacement is not', async () => {
      const { key, receipt } = await lostOperation(staff, 'outbound', '2');
      const rk = randomUUID();
      const done = (await replace(staff, 'outbound', rk, body(key, receipt, await generationOf(), '2')).expect(201)).body;
      await db.query(`DELETE FROM stock_movements WHERE id = $1`, [done.id]); // the replacement is lost by the second restore
      await reinsertOriginal(receipt, 2);
      const [orig, repl] = (await lookup(staff, [{ key, movementId: receipt.id }, { key: rk }])).operations;
      expect(orig).toMatchObject({ status: 'present', replacement: { key: rk, present: false } });
      expect(orig.reason).toBeUndefined(); // not a coexistence: only one of the two is in this history
      expect(repl).toMatchObject({ key: rk, status: 'indeterminate', reason: 'receipt-without-movement' });
      await db.query(`UPDATE product_warehouse SET base_quantity = 500 WHERE product_id = $1 AND warehouse_id = $2`, [product, w1]);
    });

    it('ordinary writes are unchanged: same status codes, same body plus the additive generation, other users unaffected', async () => {
      const key = randomUUID();
      const res = await move(staff, 'inbound', '2', key).expect(201);
      expect(res.body).toMatchObject({ productId: product, warehouseId: w1, movementType: 'INBOUND', historyGeneration: await generationOf() });
      expect(typeof res.body.revision).toBe('string');
      await move(staff, 'outbound', '100000', randomUUID()).expect(409); // insufficient stock, as before
      await http().post('/api/v1/stock/outbound').set(auth(staff)).send({ productId: product, warehouseId: w1, quantity: '1' }).expect(201); // no key: still allowed
    });

    it('mixed load: replacements, rotations, ordinary writes and syncs together never deadlock or fail with a 5xx', async () => {
      const ops: Array<Promise<{ status: number }>> = [];
      for (let i = 0; i < 6; i++) {
        const { key, receipt } = await lostOperation(staff, 'inbound', '1');
        const g = await generationOf();
        ops.push(replace(staff, 'inbound', randomUUID(), body(key, receipt, g, '1')));
        ops.push(move(manager, 'inbound', '1', randomUUID()));
        ops.push(changes(staff, { since: '0' }));
        if (i % 2 === 0) ops.push(rotate(owner));
        ops.push(http().post('/api/v1/stock/transfer').set(auth(owner)).send({ productId: product, fromWarehouseId: w1, toWarehouseId: w2, quantity: '1' }));
      }
      const results = await Promise.all(ops);
      expect(results.filter((r) => r.status >= 500)).toEqual([]);
    });
  });
});
