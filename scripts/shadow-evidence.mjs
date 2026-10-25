#!/usr/bin/env node
/**
 * Series 13 / N-2: controlled capture of capability-shadow evidence from a LOCAL backend, for a repeatable rehearsal.
 *
 *   node scripts/shadow-evidence.mjs open <label> [--base <url>] [--out <dir>]
 *       Closes whatever window is current (saved as "<label>.preceding.json": nothing is discarded unseen), opens a window
 *       named <label>, and records which process and which window that is (<out>/state.json).
 *   node scripts/shadow-evidence.mjs close [--base <url>] [--out <dir>]
 *       Closes the window opened by `open` and saves its final report (<label>.<windowId>.json + .sha256).
 *       Exit 0 only when the verdict is CLEAN; 2 for any other verdict; 3 when the evidence cannot be trusted because the
 *       backend restarted (another instance) or someone else rolled the window in between.
 *   node scripts/shadow-evidence.mjs read [--base <url>]
 *       Prints the current window's identity, counters and verdict.
 *
 * The operator token is read from SHADOW_DIAGNOSTICS_TOKEN and is never printed or written. Only a loopback base URL is
 * accepted (default http://127.0.0.1:3000/api/v1), so the token cannot be sent anywhere else.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const command = args[0];
const base = opt('base', 'http://127.0.0.1:3000/api/v1').replace(/\/+$/, '');
const out = opt('out', join(process.cwd(), 'shadow-evidence'));
const token = process.env.SHADOW_DIAGNOSTICS_TOKEN;

const fail = (code, message) => { console.error(`shadow-evidence: ${message}`); process.exit(code); };

const url = new URL(base);
if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname)) {
  fail(64, `refusing a non-loopback base URL (${url.protocol}//${url.hostname}); the diagnostics exist only on the local machine`);
}
if (!token || token.length < 32) fail(64, 'SHADOW_DIAGNOSTICS_TOKEN (32+ characters) is not set');
if (!['open', 'close', 'read'].includes(command)) fail(64, 'usage: open <label> | close | read  [--base <url>] [--out <dir>]');

async function call(method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'x-shadow-diagnostics-token': token, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 404) fail(65, 'the diagnostics route answered 404 (disabled, wrong token, or not a loopback connection)');
  if (!res.ok) fail(65, `the diagnostics route answered ${res.status}`);
  return res.json();
}

const save = (name, report) => {
  mkdirSync(out, { recursive: true });
  const text = `${JSON.stringify(report, null, 2)}\n`;
  const file = join(out, name);
  writeFileSync(file, text);
  const sha = createHash('sha256').update(text).digest('hex');
  writeFileSync(`${file}.sha256`, `${sha}  ${name}\n`);
  return { file, sha };
};
const summary = (r) => ({
  instance: r.instance.id, window: r.window.id, sequence: r.window.sequence, label: r.window.label,
  counters: r.counters, verdict: r.judgement.verdict, reasons: r.judgement.reasons,
});

if (command === 'read') {
  console.log(JSON.stringify(summary(await call('GET', '/internal/capability-shadow')), null, 2));
} else if (command === 'open') {
  const label = args[1];
  if (!label || !/^[A-Za-z0-9._:-]{1,64}$/.test(label)) fail(64, 'open needs a label of 1..64 letters, digits, ".", "_", ":" or "-"');
  const { closed, opened } = await call('POST', '/internal/capability-shadow/window', { label });
  const preceding = save(`${label}.preceding.json`, closed);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'state.json'), `${JSON.stringify({ label, ...opened, openedAt: new Date().toISOString() }, null, 2)}\n`);
  console.log(JSON.stringify({ opened, preceding: { ...summary(closed), file: preceding.file } }, null, 2));
} else {
  const statePath = join(out, 'state.json');
  if (!existsSync(statePath)) fail(64, `no ${statePath}: run "open <label>" first`);
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  const { closed } = await call('POST', '/internal/capability-shadow/window', { label: `after.${state.label}`.slice(0, 64) });
  const saved = save(`${state.label}.${closed.window.id}.json`, closed);
  const s = summary(closed);
  if (closed.instance.id !== state.instanceId) {
    console.log(JSON.stringify({ trusted: false, problem: 'RESTART_DETECTED', expected: state, got: s, file: saved.file, sha256: saved.sha }, null, 2));
    process.exit(3);
  }
  if (closed.window.id !== state.windowId) {
    console.log(JSON.stringify({ trusted: false, problem: 'WINDOW_ROLLED_ELSEWHERE', expected: state, got: s, file: saved.file, sha256: saved.sha }, null, 2));
    process.exit(3);
  }
  console.log(JSON.stringify({ trusted: true, ...s, file: saved.file, sha256: saved.sha }, null, 2));
  process.exit(s.verdict === 'CLEAN' ? 0 : 2);
}
