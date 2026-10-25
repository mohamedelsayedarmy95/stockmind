import { DEFAULT_ROLE_PERMISSIONS, PERMISSIONS, Permission, ALL_PERMISSIONS } from './permissions.constant';

/**
 * Series 10 / S2: the capability catalog and the system permission profiles.
 *
 * A capability IS a permission name (one namespace: the guards, the roles tables and the grants all speak it). What is new
 * is that a capability can be held for ONE warehouse (through a scoped grant) instead of for the whole company.
 *
 * Capabilities that act on a warehouse are "warehouse-scoped": they are evaluated against the warehouse the request names.
 * Everything else (catalog, team, recovery, financial visibility) is organization-level and never comes from a warehouse grant.
 */
export const CAPABILITY_ENGINE_VERSION = 1;

export const WAREHOUSE_SCOPED_CAPABILITIES: ReadonlySet<string> = new Set<Permission>([
  PERMISSIONS.VIEW_WAREHOUSE,
  PERMISSIONS.UPDATE_WAREHOUSE,
  PERMISSIONS.DELETE_WAREHOUSE,
  PERMISSIONS.STOCK_INBOUND,
  PERMISSIONS.STOCK_OUTBOUND,
  PERMISSIONS.STOCK_ADJUSTMENT,
  PERMISSIONS.STOCK_TRANSFER,
  PERMISSIONS.VIEW_BALANCE,
  PERMISSIONS.VIEW_MOVEMENTS,
]);

/** Everything the server knows. A capability in a stored profile that is not in here grants nothing (default deny). */
export const KNOWN_CAPABILITIES: ReadonlySet<string> = new Set<string>(ALL_PERMISSIONS);

/** Capabilities that no warehouse grant can carry, whatever a stored profile says (they are organization-level or financial). */
export const NEVER_FROM_A_GRANT: ReadonlySet<string> = new Set<string>(
  ALL_PERMISSIONS.filter((c) => !WAREHOUSE_SCOPED_CAPABILITIES.has(c)),
);

const staffWarehouseCaps = DEFAULT_ROLE_PERMISSIONS.Staff.filter((c) => WAREHOUSE_SCOPED_CAPABILITIES.has(c));

export interface SystemProfile {
  key: string;
  version: number;
  /** Message keys the clients translate; the server never sends prose. */
  labelKey: string;
  capabilities: readonly Permission[];
  /** The profile only has an effect when the capability engine enforces (it is not part of the legacy model). */
  requiresEnforcement: boolean;
}

/**
 * `operator` is EXACTLY what a Staff member could already do on a granted warehouse (legacy parity, tested): every
 * warehouse_access row is an implicit `operator` grant.
 * `warehouse_manager` adds, on the warehouses it is granted for: adjustments, transfers (both ends must be granted), and
 * warehouse editing. It carries NO financial visibility, no team management, no catalog writes, no recovery, no deletion.
 */
export const SYSTEM_PROFILES: readonly SystemProfile[] = [
  {
    key: 'operator',
    version: 1,
    labelKey: 'access.profile.operator',
    capabilities: staffWarehouseCaps,
    requiresEnforcement: false,
  },
  {
    key: 'warehouse_manager',
    version: 1,
    labelKey: 'access.profile.warehouse_manager',
    capabilities: [
      ...staffWarehouseCaps,
      PERMISSIONS.STOCK_ADJUSTMENT,
      PERMISSIONS.STOCK_TRANSFER,
      PERMISSIONS.UPDATE_WAREHOUSE,
    ],
    requiresEnforcement: true,
  },
];

export const OPERATOR_PROFILE_KEY = 'operator';
export const WAREHOUSE_MANAGER_PROFILE_KEY = 'warehouse_manager';

/** Which capability a stock movement type needs (used by the in-transaction re-check). */
export const MOVEMENT_CAPABILITY: Readonly<Record<string, Permission>> = {
  INBOUND: PERMISSIONS.STOCK_INBOUND,
  OUTBOUND: PERMISSIONS.STOCK_OUTBOUND,
  ADJUSTMENT: PERMISSIONS.STOCK_ADJUSTMENT,
  TRANSFER_OUT: PERMISSIONS.STOCK_TRANSFER,
  TRANSFER_IN: PERMISSIONS.STOCK_TRANSFER,
};

export type CapabilityMode = 'off' | 'shadow' | 'enforce';

/** An unrecognised CAPABILITY_MODE. Never answered by choosing a mode: the application refuses to start (or to decide). */
export class CapabilityModeError extends Error {
  readonly code = 'CAPABILITY_MODE_INVALID';
  constructor(raw: string) {
    // Shown at startup / in logs: bounded and printable, so a pasted secret or control characters cannot leak or inject.
    const shown = raw.slice(0, 24).replace(/[^ -~]/g, '?');
    super(`CAPABILITY_MODE must be one of off, shadow, enforce (got "${shown}${raw.length > 24 ? '...' : ''}")`);
    this.name = 'CapabilityModeError';
  }
}

/**
 * CAPABILITY_MODE (Series 11 / F11-02): off (legacy only, an intentional operator choice), shadow (legacy decides, the new
 * model is computed and compared; the DEFAULT when the variable is missing or blank), enforce (the new model decides).
 * Case and surrounding whitespace are ignored. ANY other value throws: a typo must never silently select legacy
 * authorization (or any other mode). The application validates it at startup, before it accepts a request; a decision made
 * with an invalid value (only possible if the environment is changed under a running process) fails closed as well.
 */
export function parseCapabilityMode(raw: string | undefined): CapabilityMode {
  if (raw === undefined || raw.trim() === '') return 'shadow';
  const v = raw.trim().toLowerCase();
  if (v === 'off' || v === 'shadow' || v === 'enforce') return v;
  throw new CapabilityModeError(raw);
}

/** Read on every call so a deployment can change mode with an environment change and a restart, nothing else. */
export function capabilityMode(env: NodeJS.ProcessEnv = process.env): CapabilityMode {
  return parseCapabilityMode(env.CAPABILITY_MODE);
}

/** For ConfigModule's `validate`: refuses to boot on an invalid CAPABILITY_MODE, changing nothing else. */
export function validateCapabilityConfig<T extends Record<string, unknown>>(config: T): T {
  parseCapabilityMode(config.CAPABILITY_MODE as string | undefined);
  return config;
}
