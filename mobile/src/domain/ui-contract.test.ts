/**
 * Series 10 / A9 (no phantom UI): the screens that gate or explain access may only mention capabilities the app knows, and every
 * static message key they use exists in BOTH languages. Jest has no component tests here, so this reads the screens' source:
 * crude, but it fails the build the moment a control references something that does not exist.
 */
import * as fs from 'fs';
import * as path from 'path';
import { CAP } from './capabilities';

const root = path.join(__dirname, '..', '..');
const SCREENS = [
  'app/team.tsx', 'app/team-access.tsx', 'app/warehouse/new.tsx', 'app/(tabs)/warehouses.tsx', 'app/(tabs)/_layout.tsx',
  'app/(tabs)/settings.tsx', 'app/products.tsx', 'app/product/[productId].tsx',
  // Series 13: the stock-entry surfaces whose balance line is no longer a bare number
  'app/movement/[productId].tsx', 'src/components/OnlineWarehouseStock.tsx',
];
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const en = JSON.parse(read('src/i18n/locales/en.json'));
const ar = JSON.parse(read('src/i18n/locales/ar.json'));
const has = (tree: any, key: string) => key.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), tree) !== undefined;

describe('screens reference only real capabilities and real copy', () => {
  it.each(SCREENS)('%s: every CAP.* it gates on is defined', (rel) => {
    const used = [...read(rel).matchAll(/\bCAP\.([A-Z_]+)\b/g)].map((m) => m[1]);
    for (const name of used) expect(Object.keys(CAP)).toContain(name);
  });

  it.each(SCREENS)('%s: every static message key exists in English and Arabic', (rel) => {
    const keys = [...read(rel).matchAll(/\btr\('([A-Za-z0-9_.]+)'/g)].map((m) => m[1]);
    for (const key of new Set(keys)) {
      expect({ key, en: has(en, key) }).toEqual({ key, en: true });
      expect({ key, ar: has(ar, key) }).toEqual({ key, ar: true });
    }
  });

  it('every dynamic access/team key family is complete in both languages (actions, profiles, effects, errors)', () => {
    for (const lang of [en, ar]) {
      for (const k of ['suspend', 'reactivate', 'remove', 'revoke_sessions', 'change_role', 'manage_access']) expect(has(lang, `team.action.${k}`)).toBe(true);
      for (const k of ['operator', 'warehouse_manager']) expect(has(lang, `access.profile.${k}`)).toBe(true);
      for (const k of ['view', 'receive', 'issue', 'adjust', 'transfer', 'editWarehouse']) expect(has(lang, `access.effect.${k}`)).toBe(true);
      for (const k of ['network', 'conflict', 'notEnforced', 'exceeds', 'notApplicable', 'notPermitted', 'inactive', 'self', 'forbidden', 'notFound', 'generic']) {
        expect(has(lang, `access.error.${k}`)).toBe(true);
      }
      expect(has(lang, 'access.choice.none')).toBe(true);
    }
  });
});
