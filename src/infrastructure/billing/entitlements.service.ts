import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

/**
 * Plan catalog. These are product PROPOSALS for gating, not prices or final limits; null means unlimited.
 * Identity (who you are), organization role (what you may do in the company), entitlements (what the company has
 * paid or been granted) and payment-provider state are kept apart: a provider adapter (Google Play Billing, Apple
 * StoreKit) verifies a purchase server-side and only then updates the company's plan and status.
 */
export const PLANS = {
  free: { seats: 1, warehouses: 1, teamSharing: false },
  pro: { seats: 3, warehouses: 3, teamSharing: true },
  business: { seats: 15, warehouses: 10, teamSharing: true },
  enterprise: { seats: null, warehouses: null, teamSharing: true },
} as const satisfies Record<string, { seats: number | null; warehouses: number | null; teamSharing: boolean }>;

export type PlanId = keyof typeof PLANS;
export type SubscriptionStatus = 'active' | 'trialing' | 'grace' | 'read_only' | 'canceled';

/** Statuses that may add seats or warehouses. read_only/canceled keep every existing record readable. */
const CAN_GROW: ReadonlySet<SubscriptionStatus> = new Set(['active', 'trialing', 'grace']);

export interface CompanyEntitlements {
  plan: PlanId;
  status: SubscriptionStatus;
  expiresAt: Date | null;
  source: string;
  limits: (typeof PLANS)[PlanId];
  usage: { seats: number; pendingInvitations: number; warehouses: number };
  enforced: boolean;
}

/**
 * 402: the company's plan does not include this (the app shows an upgrade path; nothing is charged here). The
 * global filter returns { statusCode, message }, so the status is the machine-readable signal.
 */
export class EntitlementRequiredException extends HttpException {
  constructor(readonly feature: string, detail: string) {
    super(detail, HttpStatus.PAYMENT_REQUIRED);
  }
}

@Injectable()
export class EntitlementsService {
  private readonly logger = new Logger(EntitlementsService.name);

  constructor(private readonly dataSource: DataSource) {}

  /** Off by default: rollout must not block existing customers before billing exists. */
  get enforced(): boolean {
    return process.env.ENTITLEMENTS_ENFORCED === 'true';
  }

  async get(companyId: string, manager: EntityManager = this.dataSource.manager): Promise<CompanyEntitlements> {
    const [row] = await manager.query(
      `SELECT c.plan, c.subscription_status AS status, c.plan_expires_at AS "expiresAt",
              c.entitlement_source AS source,
              (SELECT count(*)::int FROM users u WHERE u.company_id = c.id AND u.status <> 'removed') AS seats,
              (SELECT count(*)::int FROM team_invitations i WHERE i.company_id = c.id AND i.accepted_at IS NULL
                 AND i.revoked_at IS NULL AND i.expires_at > now()) AS pending,
              (SELECT count(*)::int FROM warehouses w WHERE w.company_id = c.id) AS warehouses
       FROM companies c WHERE c.id = $1`,
      [companyId],
    );
    const expired = row.expiresAt && new Date(row.expiresAt).getTime() <= Date.now();
    // An expired paid or trial plan falls back to the free limits; its data stays untouched.
    const plan: PlanId = expired ? 'free' : row.plan;
    return {
      plan,
      status: row.status,
      expiresAt: row.expiresAt,
      source: row.source,
      limits: PLANS[plan],
      usage: { seats: row.seats, pendingInvitations: row.pending, warehouses: row.warehouses },
      enforced: this.enforced,
    };
  }

  /** Before inviting a member: team sharing in the plan, a growing status and a free seat (pending invitations count). */
  async assertCanInvite(companyId: string): Promise<void> {
    const e = await this.get(companyId);
    if (!e.limits.teamSharing) this.deny(companyId, 'team', `The ${e.plan} plan does not include team members`);
    else if (!CAN_GROW.has(e.status)) this.deny(companyId, 'team', `Subscription is ${e.status}`);
    else if (e.limits.seats !== null && e.usage.seats + e.usage.pendingInvitations >= e.limits.seats) {
      this.deny(companyId, 'seats', `All ${e.limits.seats} seats of the ${e.plan} plan are in use or invited`);
    }
  }

  /** At acceptance or reactivation, inside its transaction (the caller holds the company seat lock): a free seat for this member. */
  async assertSeatAvailable(companyId: string, manager: EntityManager): Promise<void> {
    const e = await this.get(companyId, manager);
    if (!e.limits.teamSharing || !CAN_GROW.has(e.status)) {
      this.deny(companyId, 'team', `The ${e.plan} plan (${e.status}) does not allow new members`);
    } else if (e.limits.seats !== null && e.usage.seats >= e.limits.seats) {
      this.deny(companyId, 'seats', `All ${e.limits.seats} seats of the ${e.plan} plan are in use`);
    }
  }

  async assertCanAddWarehouse(companyId: string): Promise<void> {
    const e = await this.get(companyId);
    if (!CAN_GROW.has(e.status)) this.deny(companyId, 'warehouses', `Subscription is ${e.status}`);
    else if (e.limits.warehouses !== null && e.usage.warehouses >= e.limits.warehouses) {
      this.deny(companyId, 'warehouses', `The ${e.plan} plan includes ${e.limits.warehouses} warehouse(s)`);
    }
  }

  private deny(companyId: string, feature: string, detail: string): void {
    if (this.enforced) throw new EntitlementRequiredException(feature, detail);
    // Not enforced yet: record what would have been refused, so limits can be tuned on real usage first.
    this.logger.warn(`entitlement would deny (not enforced): company=${companyId} feature=${feature}: ${detail}`);
  }
}
