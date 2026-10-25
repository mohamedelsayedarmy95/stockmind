// Seeds SYNTHETIC test data into the throwaway local backend for StockMind QA Online Preview (Series 12).
// LOCAL BACKEND ONLY: refuses any URL that is not loopback. Idempotent: if the accounts exist it only reports them.
//
//   node mobile/scripts/qa-seed-synthetic.mjs [http://127.0.0.1:3000/api/v1]
//
// The accounts below exist ONLY in a disposable local database (stockmind_qa_*); these credentials are test values for that
// database and grant nothing anywhere else. Roles: Owner/Admin (registers the company), Manager (company-wide by design),
// Staff (warehouse W1 only, via the legacy assignment). A scoped Warehouse Manager cannot be created while the server runs
// CAPABILITY_MODE=shadow (the API answers PROFILE_NOT_ENFORCED), so none is seeded.
import { randomUUID } from 'node:crypto';

const API = process.argv[2] ?? 'http://127.0.0.1:3000/api/v1';
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+\/api\/v1\/?$/.test(API)) {
  throw new Error(`Refusing ${API}: the synthetic seed only runs against a loopback local backend.`);
}

export const QA_SYNTHETIC_PASSWORD = 'QaLocal-Only-2026!';
export const ACCOUNTS = {
  owner: { email: 'owner@qa.stockmind.test', name: 'QA Owner (synthetic)' },
  manager: { email: 'manager@qa.stockmind.test', name: 'QA Manager (synthetic)' },
  staff: { email: 'staff@qa.stockmind.test', name: 'QA Staff (synthetic)' },
};

async function call(method, path, { token, body, headers = {} } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}
async function ok(method, path, opts) {
  const r = await call(method, path, opts);
  if (r.status >= 300) throw new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}

const existing = await call('POST', '/auth/login', { body: { email: ACCOUNTS.owner.email, password: QA_SYNTHETIC_PASSWORD } });
if (existing.status < 300) {
  const token = existing.body.accessToken;
  const warehouses = await ok('GET', '/warehouses', { token });
  console.log(JSON.stringify({ seeded: 'already', company: 'QA Synthetic Co (local)', warehouses: warehouses.map?.((w) => w.name) ?? warehouses, accounts: Object.values(ACCOUNTS).map((a) => a.email) }, null, 1));
  process.exit(0);
}

const reg = await ok('POST', '/auth/register', {
  body: { name: ACCOUNTS.owner.name, email: ACCOUNTS.owner.email, password: QA_SYNTHETIC_PASSWORD, companyName: 'QA Synthetic Co (local)' },
});
const at = reg.accessToken;
const w1 = reg.defaultWarehouse.id;
await ok('PATCH', `/warehouses/${w1}`, { token: at, body: { name: 'W1 QA Cairo (synthetic)' } });
const w2 = (await ok('POST', '/warehouses', { token: at, body: { name: 'W2 QA Giza (synthetic)' } })).id;
const rice = (await ok('POST', '/products', { token: at, body: { name: 'QA Rice 5kg (synthetic)', sku: 'QA-RICE-5KG', costPrice: '25.50' } })).id;
const oil = (await ok('POST', '/products', { token: at, body: { name: 'QA Oil 1L (synthetic)', sku: 'QA-OIL-1L', costPrice: '40.00' } })).id;
for (const [p, w, q] of [[rice, w1, '100'], [oil, w1, '50'], [rice, w2, '40']]) {
  await ok('POST', '/stock/inbound', { token: at, body: { productId: p, warehouseId: w, quantity: q }, headers: { 'Idempotency-Key': randomUUID() } });
}
const invM = await ok('POST', '/team/invitations', { token: at, body: { email: ACCOUNTS.manager.email, role: 'Manager' } });
await ok('POST', '/auth/accept-invitation', { body: { token: invM.token, name: ACCOUNTS.manager.name, password: QA_SYNTHETIC_PASSWORD } });
const invS = await ok('POST', '/team/invitations', { token: at, body: { email: ACCOUNTS.staff.email, role: 'Staff', warehouseIds: [w1] } });
await ok('POST', '/auth/accept-invitation', { body: { token: invS.token, name: ACCOUNTS.staff.name, password: QA_SYNTHETIC_PASSWORD } });

console.log(JSON.stringify({
  seeded: 'now',
  company: 'QA Synthetic Co (local)',
  warehouses: { w1: 'W1 QA Cairo (synthetic): rice 100, oil 50', w2: 'W2 QA Giza (synthetic): rice 40' },
  accounts: { owner: ACCOUNTS.owner.email, manager: ACCOUNTS.manager.email, staff: `${ACCOUNTS.staff.email} (W1 only)` },
  password: 'see QA_SYNTHETIC_PASSWORD in this script (local throwaway database only)',
}, null, 1));
