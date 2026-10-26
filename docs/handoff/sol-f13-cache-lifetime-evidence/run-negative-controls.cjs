// Isolated branch only. Stop other tests before running; each mutation restores ALL exact source bytes in finally.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync, execFileSync } = require('child_process');
const root = path.resolve(__dirname, '../../..');
if (execFileSync('git', ['-C', root, 'branch', '--show-current'], { encoding: 'utf8' }).trim() !== 'review/sol-f13-cache-lifetime') {
  throw new Error('Use the isolated cache-lifetime worktree/branch');
}
const files = ['mobile/src/sync/warehouse-sync.ts', 'mobile/src/sync/warehouse-cache.ts',
  'mobile/src/domain/balance-truth.ts', 'mobile/src/data/api/api-repositories.ts', 'mobile/src/query/useStock.ts'];
const original = new Map(files.map((name) => [name, fs.readFileSync(path.join(root, name))]));
const replace = (file, from, to) => {
  const source = original.get(file).toString('utf8').replace(/\r\n/g, '\n');
  if (source.split(from).length !== 2) throw new Error(`Mutation anchor must occur once: ${file}`);
  fs.writeFileSync(path.join(root, file), source.replace(from, to));
};
const sync = files[0]; const cache = files[1]; const truth = files[2]; const repository = files[3]; const query = files[4];
const controls = [
  ['N1-product-denial-not-persisted', () => replace(sync,
    '      persist(warehouseId);\n    }\n    throw err;', '    }\n    throw err;')],
  ['N2-warehouse-denial-not-persisted', () => replace(sync,
    '    persist(warehouseId); // keep the deny even after stock itself has been purged', '')],
  ['N3-hydrate-as-confirmed', () => replace(sync, "sync: cached ? { ...cached.sync, status: 'catching-up' }", 'sync: cached ? { ...cached.sync }')],
  ['N4-network-clears-warehouse-denial', () => replace(sync,
    "const deniedWarehouse = entryOf(warehouseId).deniedWarehouse && (result.error !== null || result.state.revision === null);", 'const deniedWarehouse = false;')],
  ['N5-poll-clears-product-denials', () => replace(sync, '    deniedWarehouse,\n    ...(result.error', '    deniedWarehouse, deniedProducts: [],\n    ...(result.error')],
  ['N6-stale-direct-success-lifts-denial', () => replace(sync,
    "if (!sameSession() || version !== (accessVersions.get(warehouseId) ?? 0)) throw new Error('STALE_BALANCE_RESPONSE');",
    "if (!sameSession()) throw new Error('STALE_BALANCE_RESPONSE');")],
  ['N7-old-poll-overwrites-newer-denial', () => replace(sync,
    'if (version !== (accessVersions.get(warehouseId) ?? 0)) {', 'if (false) {')],
  ['N8-response-ignores-account-session', () => replace(sync,
    'const sameSession = () => gen === generation && scope === currentScopeKey() && server === BASE_URL;', 'const sameSession = () => true;')],
  ['N9-endpoints-share-cache', () => replace(cache,
    '`stockmind-sync-v2|${encodeURIComponent(BASE_URL)}|${scope}`', '`stockmind-sync-v2|${scope}`')],
  ['N10-product-404-revokes-whole-warehouse', () => replace(sync,
    'patch(warehouseId, { deniedProducts: [...new Set([...entry.deniedProducts, productId])] });',
    'patch(warehouseId, { deniedWarehouse: true, deniedProducts: [...new Set([...entry.deniedProducts, productId])] });')],
  ['N11-ui-ignores-product-denial', () => replace(truth,
    "return sync.lastError !== 'denied' && !sync.deniedWarehouse && !sync.deniedProducts?.includes(productId);",
    "return sync.lastError !== 'denied' && !sync.deniedWarehouse;")],
  ['N12-repository-bypasses-durable-wrapper', () => replace(repository,
    '    return fetchWarehouseBalance(productId, warehouseId, async () =>\n      (await api.get<BalanceResponse>(`/stock/balance/${productId}/${warehouseId}`)).data);',
    '    return (await api.get<BalanceResponse>(`/stock/balance/${productId}/${warehouseId}`)).data;')],
  ['N13-availability-exposes-retained-stock', () => replace(query,
    'return { ...query, data: denied ? undefined : query.data };', 'return query;')],
];
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const ledger = ['Expected: each mutation causes actual assertion failures / Jest exit 1, not compile errors or zero-test runs.'];
let detected = 0;
const restore = () => { for (const [file, bytes] of original) fs.writeFileSync(path.join(root, file), bytes); };
try {
  for (const [name, mutate] of controls) {
    restore();
    mutate();
    const suites = name === 'N13-availability-exposes-retained-stock'
      ? ['src/domain/availability-visibility.test.ts'] : ['src/domain/cache-lifetime.test.ts'];
    const args = [path.join(root, 'mobile/node_modules/jest/bin/jest.js'), ...suites, '--runInBand', '--colors=false'];
    const result = spawnSync(process.execPath, args, { cwd: path.join(root, 'mobile'), encoding: 'utf8', timeout: 120_000, maxBuffer: 4 * 1024 * 1024 });
    const output = (result.stdout ?? '') + (result.stderr ?? '');
    const red = result.status === 1 && output.includes('expect(received)') && /Tests:\s+\d+ failed/.test(output);
    if (red) detected++;
    const summary = [`${name}: ${red ? 'DETECTED / RED' : 'NOT VERIFIED'}; exit=${result.status}`,
      ...output.split(/\r?\n/).filter((line) => /^(FAIL |Test Suites:|Tests:)/.test(line))];
    ledger.push(...summary); console.log(summary.join('\n'));
  }
} finally {
  restore();
  for (const [file, bytes] of original) {
    const restored = fs.readFileSync(path.join(root, file));
    ledger.push(`${file}: original=${hash(bytes)} restored=${hash(restored)} equal=${bytes.equals(restored)}`);
  }
  ledger.push(`Detected: ${detected}/${controls.length}`);
  fs.writeFileSync(path.join(__dirname, 'negative-controls.txt'), ledger.join('\n') + '\n');
}
if (detected !== controls.length) process.exitCode = 1;
