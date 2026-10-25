/**
 * Series 11 / F11-04: a shadow difference is EXPECTED only when an explicit, active grant explains exactly that capability on
 * exactly that warehouse. Everything else is UNEXPECTED. The evaluator cannot produce most unexpected widenings from honest data,
 * so several tests build principals the loader would never produce (a legacy-sourced grant carrying extra capabilities, an
 * expired grant that slipped through) to prove the classifier does not take "has some grant" as an explanation.
 */
import { classifyPermission, classifyScope, grantIsActive } from '@/domain/authorization/shadow-classifier';
import { GrantView, Principal } from '@/domain/authorization/capability-evaluator';
import { PERMISSIONS } from '@/shared/constants/permissions.constant';
import { SYSTEM_PROFILES } from '@/shared/constants/capabilities.constant';

const COMPANY = 'c-1';
const W1 = 'w-1'; const W2 = 'w-2'; const W3 = 'w-3';
const OPERATOR = SYSTEM_PROFILES.find((p) => p.key === 'operator')!;
const WM = SYSTEM_PROFILES.find((p) => p.key === 'warehouse_manager')!;
const NOW = new Date('2026-10-25T12:00:00Z');

const op = (warehouseId: string): GrantView => ({
  warehouseId, profileKey: 'operator', profileVersion: 1, capabilities: OPERATOR.capabilities, source: 'legacy_warehouse_access',
});
const wm = (warehouseId: string, extra: Partial<GrantView> = {}): GrantView => ({
  warehouseId, profileKey: 'warehouse_manager', profileVersion: 1, capabilities: WM.capabilities, source: 'access_grant', ...extra,
});
const staff = (grants: GrantView[], over: Partial<Principal> = {}): Principal => ({
  userId: 'u-1', companyId: COMPANY, role: 'Staff', status: 'active', isOwner: false, customCapabilities: [], grants, ...over,
});

const perm = (p: Principal, capabilities: string[], warehouseIds: string[], legacyAllowed: boolean, requestCompanyId = COMPANY) =>
  classifyPermission({ principal: p, requestCompanyId, capabilities, warehouseIds, legacyAllowed, now: NOW });

describe('shadow classification (F11-04)', () => {
  describe('permission differences', () => {
    it('equal decisions are equal', () => {
      expect(perm(staff([op(W1)]), [PERMISSIONS.STOCK_INBOUND], [W1], true).verdict).toBe('equal');
      expect(perm(staff([op(W1)]), [PERMISSIONS.STOCK_ADJUSTMENT], [W1], false).verdict).toBe('equal');
    });

    it("8. a correct warehouse_manager grant's new capability on ITS warehouse is recognised, naming the grant that explains it", () => {
      const r = perm(staff([op(W2), wm(W1)]), [PERMISSIONS.STOCK_ADJUSTMENT], [W1], false);
      expect(r).toMatchObject({ verdict: 'expected', reason: 'justified-by-grant' });
      expect(r.justifiedBy).toEqual([{ warehouseId: W1, profileKey: 'warehouse_manager', profileVersion: 1, capability: PERMISSIONS.STOCK_ADJUSTMENT }]);
      expect(r.unexplained).toEqual([]);
    });

    it("a transfer between two granted warehouses is explained by BOTH grants, one per end", () => {
      const r = perm(staff([wm(W1), wm(W2)]), [PERMISSIONS.STOCK_TRANSFER], [W1, W2], false);
      expect(r.verdict).toBe('expected');
      expect(r.justifiedBy.map((j) => j.warehouseId).sort()).toEqual([W1, W2]);
    });

    it("1. a grant on W1 does not explain a widening on W2 (the other end of a transfer, here backed by a tampered legacy-sourced grant)", () => {
      // W2 carries a legacy-sourced grant with an extra capability the real loader would never produce.
      const tampered: GrantView = { ...op(W2), capabilities: [...OPERATOR.capabilities, PERMISSIONS.STOCK_TRANSFER] };
      const r = perm(staff([wm(W1), tampered]), [PERMISSIONS.STOCK_TRANSFER], [W1, W2], false);
      expect(r.verdict).toBe('unexpected');
      expect(r.reason).toBe('unjustified-expansion');
      expect(r.unexplained).toEqual([{ capability: PERMISSIONS.STOCK_TRANSFER, warehouseId: W2 }]);
    });

    it("2. a grant carrying capability X does not explain capability Y on the same warehouse", () => {
      const transferOnly: GrantView = { warehouseId: W1, profileKey: 'custom', profileVersion: 1, capabilities: [PERMISSIONS.STOCK_TRANSFER, PERMISSIONS.VIEW_WAREHOUSE], source: 'access_grant' };
      const tampered: GrantView = { ...op(W1), capabilities: [...OPERATOR.capabilities, PERMISSIONS.STOCK_ADJUSTMENT] };
      const r = perm(staff([transferOnly, tampered]), [PERMISSIONS.STOCK_ADJUSTMENT], [W1], false);
      expect(r.verdict).toBe('unexpected');
      expect(r.unexplained).toEqual([{ capability: PERMISSIONS.STOCK_ADJUSTMENT, warehouseId: W1 }]);
    });

    it("3. a permission the legacy model allowed and the new one denies is UNEXPECTED, whatever grants exist", () => {
      expect(perm(staff([wm(W1)]), [PERMISSIONS.STOCK_OUTBOUND], [W2], true)).toMatchObject({ verdict: 'unexpected', reason: 'legacy-allowed-scoped-denied' });
      expect(perm(staff([]), [PERMISSIONS.STOCK_INBOUND], [W1], true)).toMatchObject({ verdict: 'unexpected', reason: 'legacy-allowed-scoped-denied' });
    });

    it("4. an unrecognised capability is never expected, allowed or denied", () => {
      expect(perm(staff([wm(W1)]), ['SOMETHING_NEW'], [W1], false)).toMatchObject({ verdict: 'unexpected', reason: 'unknown-capability' });
      expect(perm(staff([wm(W1)]), ['SOMETHING_NEW'], [W1], true)).toMatchObject({ verdict: 'unexpected', reason: 'unknown-capability' });
      expect(perm(staff([wm(W1)]), [PERMISSIONS.STOCK_ADJUSTMENT, 'SOMETHING_NEW'], [W1], false).verdict).toBe('unexpected');
    });

    it("5. a decision made for a member of another company is never expected, not even when the two models agree", () => {
      const foreign = staff([wm(W1)], { companyId: 'c-other' });
      expect(perm(foreign, [PERMISSIONS.STOCK_ADJUSTMENT], [W1], false)).toMatchObject({ verdict: 'unexpected', reason: 'cross-tenant' });
      expect(perm(foreign, [PERMISSIONS.STOCK_INBOUND], [W1], true)).toMatchObject({ verdict: 'unexpected', reason: 'cross-tenant' });
    });

    it("6. an expired, not-yet-valid or revoked grant explains nothing", () => {
      const cases: Array<Partial<GrantView>> = [
        { validUntil: '2026-10-25T11:59:59Z' },
        { validFrom: '2026-10-25T12:00:01Z' },
        { revokedAt: '2026-10-25T10:00:00Z' },
      ];
      for (const window of cases) {
        const r = perm(staff([wm(W1, window)]), [PERMISSIONS.STOCK_ADJUSTMENT], [W1], false);
        expect(r).toMatchObject({ verdict: 'unexpected', reason: 'unjustified-expansion' });
        expect(r.justifiedBy).toEqual([]);
      }
      expect(grantIsActive(wm(W1, { validUntil: '2026-10-25T12:00:01Z' }), NOW)).toBe(true);
      expect(grantIsActive(wm(W1, { validUntil: '2026-10-25T12:00:00Z' }), NOW)).toBe(false); // the end instant itself is already expired
    });

    it("an organization-level or financial capability is never explained by a grant", () => {
      // A (tampered) grant tries to carry the financial capability: the evaluator ignores it, so nothing becomes allowed.
      const sneaky = wm(W1, { capabilities: [...WM.capabilities, PERMISSIONS.VIEW_COST] });
      const r = perm(staff([sneaky]), [PERMISSIONS.VIEW_COST], [], false);
      expect(r.verdict).toBe('equal'); // denied by both models: the smuggled capability changed nothing
    });

    it("a difference the classifier cannot attribute to any widening is UNEXPECTED, not ignored", () => {
      // legacy said no although the legacy view would say yes: the two reference models disagree for a reason nobody can see
      expect(perm(staff([op(W1)]), [PERMISSIONS.STOCK_OUTBOUND], [W1], false)).toMatchObject({ verdict: 'unexpected', reason: 'unexplained' });
    });
  });

  describe('scope differences', () => {
    it('the same scope is equal; "all" against "all" is equal', () => {
      expect(classifyScope({ principal: staff([op(W1)]), requestCompanyId: COMPANY, legacy: [W1], scoped: [W1], now: NOW }).verdict).toBe('equal');
      expect(classifyScope({ principal: staff([], { role: 'Manager' }), requestCompanyId: COMPANY, legacy: null, scoped: null, now: NOW }).verdict).toBe('equal');
    });

    it("an extra warehouse is expected only when an active grant on THAT warehouse gives it", () => {
      const p = staff([op(W2), wm(W1)]);
      const ok = classifyScope({ principal: p, requestCompanyId: COMPANY, legacy: [W2], scoped: [W1, W2], now: NOW });
      expect(ok).toMatchObject({ verdict: 'expected', reason: 'justified-by-grant' });
      expect(ok.justifiedBy[0]).toMatchObject({ warehouseId: W1, profileKey: 'warehouse_manager' });
    });

    it("1. holding a grant on W1 does not explain W3 appearing in the scope", () => {
      const r = classifyScope({ principal: staff([op(W2), wm(W1)]), requestCompanyId: COMPANY, legacy: [W2], scoped: [W1, W2, W3], now: NOW });
      expect(r).toMatchObject({ verdict: 'unexpected', reason: 'unjustified-expansion' });
      expect(r.unexplained).toEqual([{ capability: null, warehouseId: W3 }]);
    });

    it("3. a warehouse the legacy scope had and the new scope lost is UNEXPECTED", () => {
      const r = classifyScope({ principal: staff([op(W2)]), requestCompanyId: COMPANY, legacy: [W1, W2], scoped: [W2], now: NOW });
      expect(r).toMatchObject({ verdict: 'unexpected', reason: 'legacy-allowed-scoped-denied' });
      expect(r.unexplained).toEqual([{ capability: null, warehouseId: W1 }]);
      expect(classifyScope({ principal: staff([]), requestCompanyId: COMPANY, legacy: null, scoped: [W1], now: NOW }).verdict).toBe('unexpected');
    });

    it("a widening to every warehouse is a role widening, never a grant", () => {
      expect(classifyScope({ principal: staff([wm(W1)]), requestCompanyId: COMPANY, legacy: [W1], scoped: null, now: NOW })).toMatchObject({ verdict: 'unexpected', reason: 'unjustified-expansion' });
    });

    it("5. cross-tenant and 6. expired grants never justify a scope difference", () => {
      expect(classifyScope({ principal: staff([wm(W1)], { companyId: 'c-other' }), requestCompanyId: COMPANY, legacy: [], scoped: [W1], now: NOW }).reason).toBe('cross-tenant');
      const expired = staff([wm(W1, { validUntil: '2026-10-25T00:00:00Z' })]);
      expect(classifyScope({ principal: expired, requestCompanyId: COMPANY, legacy: [], scoped: [W1], now: NOW })).toMatchObject({ verdict: 'unexpected', reason: 'unjustified-expansion' });
    });
  });
});
