/**
 * Series 13 / N-3: the administrative refusals AUTHORITY_BUSY (temporary) and SCOPED_GRANTS_PRESENT (a real conflict) are
 * told apart, read correctly in both languages on every administrative surface, and are never re-sent by the app itself.
 */
import * as fs from 'fs';
import * as path from 'path';
import { ADMIN_ERROR_KEYS, adminFailure, AUTHORITY_BUSY, SCOPED_GRANTS_PRESENT } from './admin-errors';
import { teamErrorKey, TEAM_ERROR_CODES } from './team-actions';
import { accessErrorKey, ACCESS_ERROR_CODES } from './capabilities';

const root = path.join(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const locale = (l: string) => JSON.parse(read(`src/i18n/locales/${l}.json`));
const get = (tree: any, key: string) => key.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), tree);

describe('adminFailure', () => {
  it.each([['team', teamErrorKey], ['access', accessErrorKey]] as const)('%s: 503 AUTHORITY_BUSY is temporary contention: warning, try again later, re-read', (_s, surface) => {
    expect(adminFailure(503, AUTHORITY_BUSY, surface)).toEqual({
      kind: 'busy', messageKey: 'admin.error.authorityBusy', retryLater: true, refresh: true, tone: 'warning',
    });
  });

  it.each([['team', teamErrorKey], ['access', accessErrorKey]] as const)('%s: 409 SCOPED_GRANTS_PRESENT is a real conflict: error, trying again does the same', (_s, surface) => {
    expect(adminFailure(409, SCOPED_GRANTS_PRESENT, surface)).toEqual({
      kind: 'grant-conflict', messageKey: 'admin.error.scopedGrantsPresent', retryLater: false, refresh: true, tone: 'error',
    });
  });

  it('a 503 without the code is the server being unavailable, not contention; no response at all is the network', () => {
    expect(adminFailure(503, undefined, teamErrorKey)).toMatchObject({ kind: 'unavailable', messageKey: 'admin.error.unavailable', tone: 'warning' });
    expect(adminFailure(502, 'SOMETHING', accessErrorKey).kind).toBe('unavailable');
    expect(adminFailure(undefined, undefined, teamErrorKey)).toMatchObject({ kind: 'network', messageKey: 'team.error.network' });
    expect(adminFailure(undefined, undefined, accessErrorKey)).toMatchObject({ kind: 'network', messageKey: 'access.error.network' });
  });

  it('every other refusal keeps the surface\'s own message (no regression of the Series 09/10 copy)', () => {
    expect(adminFailure(409, 'LAST_OWNER', teamErrorKey)).toMatchObject({ kind: 'refused', messageKey: 'team.error.LAST_OWNER', tone: 'error' });
    expect(adminFailure(409, 'ACCESS_VERSION_CONFLICT', accessErrorKey)).toMatchObject({ kind: 'refused', messageKey: 'access.error.conflict' });
    expect(adminFailure(403, undefined, teamErrorKey).messageKey).toBe('team.error.forbidden');
  });

  it('the surface maps alone already translate both codes (callers that only need a message get the right one)', () => {
    for (const fn of [teamErrorKey, accessErrorKey]) {
      expect(fn(503, AUTHORITY_BUSY)).toBe('admin.error.authorityBusy');
      expect(fn(409, SCOPED_GRANTS_PRESENT)).toBe('admin.error.scopedGrantsPresent');
    }
    expect(TEAM_ERROR_CODES).toEqual(expect.arrayContaining([AUTHORITY_BUSY, SCOPED_GRANTS_PRESENT]));
    expect(ACCESS_ERROR_CODES).toEqual(expect.arrayContaining([AUTHORITY_BUSY, SCOPED_GRANTS_PRESENT]));
  });

  it('copy: both languages, distinct, and each says that nothing was changed', () => {
    const en = locale('en'); const ar = locale('ar');
    for (const key of ADMIN_ERROR_KEYS) {
      expect(typeof get(en, key)).toBe('string');
      expect(typeof get(ar, key)).toBe('string');
      expect(get(ar, key)).not.toBe(get(en, key));
      expect(get(en, key)).toMatch(/Nothing was changed/);
      expect(get(ar, key)).toMatch(/محصلش أي تغيير/);
    }
    expect(get(en, 'admin.error.authorityBusy')).not.toBe(get(en, 'admin.error.scopedGrantsPresent'));
    expect(get(en, 'admin.error.authorityBusy')).toMatch(/try again/i);
    expect(get(en, 'admin.error.scopedGrantsPresent')).toMatch(/Warehouse access/);
    expect(get(ar, 'admin.error.scopedGrantsPresent')).toContain(get(ar, 'access.title')); // points to the screen by its real name
  });
});

describe('administrative requests are never re-sent by the app', () => {
  it('the membership and access mutations do not retry, and the warehouse creation does not either', () => {
    const team = read('src/query/useTeam.ts');
    const mutations = [...team.matchAll(/useMutation\(\{([\s\S]*?)mutationFn/g)].map((m) => m[1]);
    expect(mutations).toHaveLength(2);
    for (const opts of mutations) expect(opts).toMatch(/retry:\s*false/);
    expect(read('src/query/useWarehouses.ts')).not.toMatch(/retry:\s*(true|[1-9])/); // react-query's default for mutations: no retry
  });

  it('the HTTP client re-sends only after a token refresh (401), never on a 503 or a 409', () => {
    const client = read('src/api/client.ts');
    const resends = [...client.matchAll(/return api\(original\)/g)];
    expect(resends).toHaveLength(1);
    expect(client).toMatch(/error\.response\?\.status === 401 && original && !original\._retry/);
    expect(client).not.toMatch(/\b(503|409)\b[^\n]*api\(original\)/);
  });

  it('the three administrative screens classify failures through adminFailure and show no success on a refusal', () => {
    for (const rel of ['app/team.tsx', 'app/team-access.tsx', 'app/warehouse/new.tsx']) {
      const src = read(rel);
      expect({ rel, uses: /adminFailure\(httpStatusOf\(err\), errorCodeOf\(err\)/.test(src) }).toEqual({ rel, uses: true });
      // the only place a success is shown is onSuccess
      const onError = src.slice(src.indexOf('onError'), src.indexOf('onError') + 600);
      expect({ rel, successInError: /haptics\.success|kind: 'ok'|router\.back\(\)/.test(onError) }).toEqual({ rel, successInError: false });
    }
  });
});
