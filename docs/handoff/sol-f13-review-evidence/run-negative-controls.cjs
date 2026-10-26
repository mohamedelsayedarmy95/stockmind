// Run from this isolated worktree only, with no tests running concurrently. Restores the exact source bytes in finally.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync, execFileSync } = require('child_process');
const root = path.resolve(__dirname, '../../..');
const branch = execFileSync('git', ['-C', root, 'branch', '--show-current'], { encoding: 'utf8' }).trim();
if (branch !== 'review/sol-f13-balance-authorization') throw new Error('Use the isolated Sol review branch only');
const mobile = path.join(root, 'mobile');
const source = path.join(mobile, 'src/domain/balance-truth.ts');
const original = fs.readFileSync(source);
const text = original.toString('utf8').replace(/\r\n/g, '\n');
const guard = "  if (query.status === 'error' && (query.errorStatus === 403 || query.errorStatus === 404)) {\n    return { state: 'unknown', reason: 'no-access' };\n  }";
const replaceOnce = (from, to) => {
  if (text.split(from).length !== 2) throw new Error('Mutation anchor must occur exactly once');
  return text.replace(from, to);
};
const controls = [
  ['N1-remove-direct-denial', () => replaceOnce(guard, ''), ['balance-truth', 'balance-authorization-flow']],
  ['N2-ignore-403', () => replaceOnce('query.errorStatus === 403 || query.errorStatus === 404', 'query.errorStatus === 404'), ['balance-truth']],
  ['N3-ignore-404', () => replaceOnce('query.errorStatus === 403 || query.errorStatus === 404', 'query.errorStatus === 403'), ['balance-truth']],
  ['N4-ignore-sync-denial', () => replaceOnce("    if (sync.lastError === 'denied') return { state: 'unknown', reason: 'no-access' };", ''), ['balance-truth', 'balance-authorization-flow']],
  ['N5-use-mismatched-response', () => replaceOnce("    if (!d || d.productId !== productId || d.warehouseId !== warehouseId) return { state: 'unknown', reason: 'mismatch' };", "    if (!d) return { state: 'unknown', reason: 'mismatch' };"), ['balance-truth']],
  ['N6-count-pending-receipts', () => replaceOnce('Math.min(0, pendingSigned)', 'pendingSigned'), ['balance-truth']],
];
const digest = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');
const ledger = [`Original source SHA-256: ${digest(original)}`, 'Each mutation starts from the fixed source. Expected: Jest exit 1 with assertion failures, then exact-byte restoration.'];
let detected = 0;
try {
  for (const [name, mutate, suites] of controls) {
    const mutated = mutate();
    fs.writeFileSync(source, mutated);
    const result = spawnSync(process.execPath, [path.join(mobile, 'node_modules/jest/bin/jest.js'),
      ...suites.map((suite) => `src/domain/${suite}.test.ts`), '--runInBand', '--colors=false'],
    { cwd: mobile, encoding: 'utf8', timeout: 120_000, maxBuffer: 4 * 1024 * 1024 });
    const output = (result.stdout ?? '') + (result.stderr ?? '');
    const assertionFailure = output.includes('expect(received)') && /Tests:\s+\d+ failed/.test(output);
    const red = result.status === 1 && assertionFailure;
    ledger.push(`${name}: ${red ? 'DETECTED / RED' : 'NOT VERIFIED'}; exit=${result.status}`,
      ...output.split(/\r?\n/).filter((line) => /^(FAIL |Test Suites:|Tests:|Time:)/.test(line)));
    console.log(ledger.slice(-5).join('\n'));
    if (red) detected++;
    fs.writeFileSync(source, original);
    if (!fs.readFileSync(source).equals(original)) throw new Error('Restoration failed');
  }
} finally {
  fs.writeFileSync(source, original);
  ledger.push(`Restored source SHA-256: ${digest(fs.readFileSync(source))}`, `Detected: ${detected}/${controls.length}`);
  fs.writeFileSync(path.join(__dirname, 'negative-controls.txt'), ledger.join('\n') + '\n');
}
if (detected !== controls.length) process.exitCode = 1;
