import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { createHmac, randomBytes, randomUUID } from 'crypto';
import { canAll, Principal } from '../../domain/authorization/capability-evaluator';
import {
  classifyPermission, classifyScope, Justification, ShadowClassification, ShadowReason, ShadowVerdict, Unexplained,
} from '../../domain/authorization/shadow-classifier';
import { emptyCounters, judgeWindow, WindowCounters, WindowJudgement } from '../../domain/authorization/shadow-window';
import { capabilityMode } from '../../shared/constants/capabilities.constant';

/**
 * One diverging decision between the legacy model and the new one. Identifiers of the question only: no request data, no
 * tokens, no values (the guard never passes a body, header or query value in). In-process only: the exported report
 * (`report()`) carries a per-process pseudonym instead of the member id.
 */
export interface ShadowDifference {
  at: string;
  kind: 'permission' | 'scope';
  route: string;
  userId: string;
  /** The capabilities the guard required (permission differences). */
  capabilities: string[];
  warehouseIds: string[];
  /** What each model decided (permission differences); for scope differences, whether the scope was "all" or a list. */
  legacy: boolean | 'all' | 'list';
  scoped: boolean | 'all' | 'list';
  /** The verdict of the classifier (shadow-classifier.ts) and its reason. */
  verdict: Exclude<ShadowVerdict, 'equal'>;
  reason: ShadowReason;
  /** Which grants explain an expected difference, and which (capability, warehouse) pairs nothing explains. */
  justifiedBy: Justification[];
  unexplained: Unexplained[];
}

/** A difference as it leaves the process: the member is a pseudonym that cannot be linked across processes. */
export type ShadowSample = Omit<ShadowDifference, 'userId'> & { subject: string };

/** Why a comparison could not be made. Each is missing evidence, never parity. */
export type IncompleteReason = 'no-principal' | 'principal-not-active' | 'no-company' | 'model-not-wired';
export type ShadowErrorSource = 'permission' | 'scope';

export const SHADOW_REPORT_SCHEMA = 'stockmind.capability-shadow-window/v1';
const RECENT = 50; // the mixed ring of the current window, for in-process callers (Series 11 shape)
const UNEXPECTED_SAMPLES = 100; // per window: the FIRST unexpected differences (the earliest evidence is never pushed out)
const EXPECTED_SAMPLES = 50; // per window: the LAST expected differences
const LOG_BUDGET = 100; // structured lines per window and event type; beyond it lines are counted, never silently lost
const CLOSED_KEPT = 5;
const DEFAULT_REPORT_INTERVAL_MS = 15 * 60_000;

type OpenedBy = 'process-start' | 'operator' | 'reset';
type CloseReason = 'rolled' | 'reset' | 'shutdown';

interface Window {
  id: string;
  sequence: number;
  label: string | null;
  openedAt: Date;
  openedBy: OpenedBy;
  modeAtOpen: string;
  counters: WindowCounters;
  guardedByMode: Record<string, number>;
  incompleteByReason: Record<string, number>;
  errorsBySource: Record<string, number>;
  unexpectedByReason: Record<string, number>;
  unexpectedByRoute: Record<string, number>;
  expectedByRoute: Record<string, number>;
  unexpected: ShadowSample[];
  unexpectedDropped: number;
  expected: ShadowSample[];
  expectedDropped: number;
  ring: ShadowDifference[];
  logLines: Record<string, number>;
  logSuppressed: Record<string, number>;
}

export interface ShadowWindowSummary {
  id: string; sequence: number; label: string | null; openedAt: string; closedAt: string; closeReason: CloseReason;
  counters: WindowCounters; verdict: WindowJudgement['verdict'];
}

const safeMode = (): string => { try { return capabilityMode(); } catch { return 'invalid'; } };
const bump = (m: Record<string, number>, k: string) => { m[k] = (m[k] ?? 0) + 1; };

/** A label an operator gives a window: short, and nothing that could carry data. */
export function sanitizeWindowLabel(label: unknown): string | null {
  if (typeof label !== 'string') return null;
  const s = label.trim();
  return s.length <= 64 && /^[A-Za-z0-9._:-]+$/.test(s) ? s : null;
}

/** CAPABILITY_SHADOW_REPORT_INTERVAL_MS: 0 disables the periodic progress line; otherwise 10 s .. 24 h (default 15 min). */
export function shadowReportIntervalMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.CAPABILITY_SHADOW_REPORT_INTERVAL_MS;
  if (raw === undefined || raw === '') return DEFAULT_REPORT_INTERVAL_MS;
  const n = Number(raw);
  if (n === 0) return 0;
  if (!Number.isFinite(n) || n < 10_000 || n > 86_400_000) return DEFAULT_REPORT_INTERVAL_MS;
  return Math.floor(n);
}

/**
 * Collects the comparison between the legacy decision and the new capability model while the engine runs in shadow mode.
 * Every difference is classified by `shadow-classifier.ts`: EXPECTED only when an explicit active grant explains exactly that
 * capability on exactly that warehouse.
 *
 * Series 13 / N-2: the evidence is organized in WINDOWS so a rehearsal can prove what it observed:
 *  - every window has an id, a sequence number and an opening reason, inside a process identified by a random instance id;
 *    a restart is a new instance id (and window 1 "process-start"), so evidence lost to a restart is detectable;
 *  - an operator closes the current window and opens the next (a "reset" is the same and is recorded as one); the closed
 *    window's final report is logged and its summary kept;
 *  - counters are exact; incomplete comparisons and errors are counted by reason, and unexpected differences by reason and
 *    route; samples are bounded (the first unexpected, the last expected) and what did not fit is COUNTED as dropped;
 *  - structured log lines carry the instance and window ids; beyond a per-window budget they are counted as suppressed;
 *  - the judgement (shadow-window.ts) never calls a window CLEAN when evidence is missing, the engine left shadow, or
 *    nothing was compared.
 * Limits, stated in every report: memory only and per process (lost on restart; the window-closed and shutdown log lines are
 * the durable record), not aggregated across instances, not an audit trail, not a monitoring system.
 */
@Injectable()
export class CapabilityShadowService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger('CapabilityShadow');
  readonly instanceId = randomUUID();
  private readonly startedAt = new Date();
  private readonly pseudonymKey = randomBytes(32);
  private sequence = 0;
  private resets = 0;
  private window: Window;
  private readonly closed: ShadowWindowSummary[] = [];
  private timer?: NodeJS.Timeout;

  constructor() {
    this.window = this.newWindow(null, 'process-start');
  }

  onModuleInit(): void {
    const every = shadowReportIntervalMs();
    if (every > 0) {
      this.timer = setInterval(() => this.logReport('capability-shadow-window-progress', this.report()), every);
      this.timer.unref();
    }
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.closeCurrent('shutdown');
  }

  /** Every guarded decision, in every mode: a window is only conclusive if the engine stayed in shadow for all of it. */
  noteGuardedRequest(mode: string): void {
    bump(this.window.guardedByMode, mode);
  }

  observePermission(input: {
    route: string; userId: string; requestCompanyId: string; principal: Principal | null | undefined;
    capabilities: string[]; warehouseIds: string[]; legacyAllowed: boolean;
  }): void {
    if (!input.principal) return this.incomplete('no-principal', input.route);
    // A member who is no longer active (a concurrent suspension) cannot be compared: the request was authenticated before.
    if (input.principal.status !== 'active') return this.incomplete('principal-not-active', input.route);
    const principal = input.principal;
    const c = classifyPermission({
      principal, requestCompanyId: input.requestCompanyId, capabilities: input.capabilities,
      warehouseIds: input.warehouseIds, legacyAllowed: input.legacyAllowed,
    });
    const scopedAllowed = input.capabilities.every((cap) => canAll(principal, cap, input.warehouseIds, 'scoped').allowed);
    this.tally(c, {
      kind: 'permission', route: input.route, userId: input.userId, capabilities: input.capabilities, warehouseIds: input.warehouseIds,
      legacy: input.legacyAllowed, scoped: scopedAllowed,
    });
  }

  observeScope(input: {
    route: string; userId: string; requestCompanyId: string; principal: Principal | null | undefined;
    legacy: string[] | null; scoped: string[] | null;
  }): void {
    if (!input.principal) return this.incomplete('no-principal', input.route);
    // (an inactive member's "scope" would read as "every warehouse" and be misjudged as a widening)
    if (input.principal.status !== 'active') return this.incomplete('principal-not-active', input.route);
    const c = classifyScope({
      principal: input.principal, requestCompanyId: input.requestCompanyId, legacy: input.legacy, scoped: input.scoped,
    });
    this.tally(c, {
      kind: 'scope', route: input.route, userId: input.userId, capabilities: [], warehouseIds: [],
      legacy: input.legacy === null ? 'all' : 'list', scoped: input.scoped === null ? 'all' : 'list',
    });
  }

  private tally(c: ShadowClassification, d: Omit<ShadowDifference, 'at' | 'verdict' | 'reason' | 'justifiedBy' | 'unexplained'>): void {
    const w = this.window;
    w.counters.compared += 1;
    if (c.verdict === 'equal') {
      w.counters.equal += 1;
      return;
    }
    const diff: ShadowDifference = { ...d, verdict: c.verdict, reason: c.reason, justifiedBy: c.justifiedBy, unexplained: c.unexplained, at: new Date().toISOString() };
    const sample = this.toSample(diff);
    if (c.verdict === 'expected') {
      w.counters.expectedDifferences += 1;
      bump(w.expectedByRoute, d.route);
      w.expected.push(sample);
      if (w.expected.length > EXPECTED_SAMPLES) { w.expected.shift(); w.expectedDropped += 1; }
    } else {
      w.counters.unexpectedDifferences += 1;
      bump(w.unexpectedByReason, c.reason);
      bump(w.unexpectedByRoute, d.route);
      if (w.unexpected.length < UNEXPECTED_SAMPLES) w.unexpected.push(sample);
      else w.unexpectedDropped += 1;
      // One structured line, identifiers only.
      this.line('warn', 'capability-shadow-unexpected', {
        kind: d.kind, route: d.route, capabilities: d.capabilities, reason: c.reason, unexplained: c.unexplained,
      });
    }
    w.ring.push(diff);
    if (w.ring.length > RECENT) w.ring.shift();
  }

  /** A comparison that could not be made (no principal, model not wired): evidence is missing, which is NOT parity. */
  incomplete(reason: IncompleteReason = 'no-principal', route?: string): void {
    this.window.counters.incomplete += 1;
    bump(this.window.incompleteByReason, reason);
    this.line('warn', 'capability-shadow-incomplete', { reason, route: route ?? null });
  }

  /** An evaluation that failed. Only the error's class and code are recorded: its message can echo request input. */
  error(source: ShadowErrorSource = 'permission', err?: unknown, route?: string): void {
    this.window.counters.errors += 1;
    bump(this.window.errorsBySource, source);
    const e = err as { name?: string; code?: string; driverError?: { code?: string } } | undefined;
    this.line('warn', 'capability-shadow-error', {
      source, route: route ?? null, error: e?.name ?? null, code: e?.driverError?.code ?? e?.code ?? null,
    });
  }

  /** In-process view of the CURRENT window (Series 11 shape: counters and the recent differences, member ids included). */
  snapshot() {
    return { ...this.window.counters, recent: [...this.window.ring] };
  }

  /** Series 11 name for "start counting again": closes the window (recorded, logged) and opens the next one. */
  reset(): void {
    this.resets += 1;
    this.closeCurrent('reset');
    this.window = this.newWindow(null, 'reset');
  }

  /** Operator action: closes the current window and opens a new one. Returns the closed window's final report. */
  openWindow(label?: unknown) {
    const closed = this.closeCurrent('rolled');
    this.window = this.newWindow(sanitizeWindowLabel(label), 'operator');
    return { closed, opened: { instanceId: this.instanceId, windowId: this.window.id, sequence: this.window.sequence, label: this.window.label } };
  }

  /** The evidence document of the current window. Identifiers only; the member is a per-process pseudonym. */
  report(close?: { at: Date; reason: CloseReason }) {
    const w = this.window;
    const now = close?.at ?? new Date();
    const modes = {
      atOpen: w.modeAtOpen, now: safeMode(),
      guardedOutsideShadow: Object.entries(w.guardedByMode).filter(([m]) => m !== 'shadow').reduce((n, [, v]) => n + v, 0),
    };
    return {
      schema: SHADOW_REPORT_SCHEMA,
      generatedAt: now.toISOString(),
      instance: { id: this.instanceId, pid: process.pid, startedAt: this.startedAt.toISOString(), uptimeMs: now.getTime() - this.startedAt.getTime(), resets: this.resets },
      window: {
        id: w.id, sequence: w.sequence, label: w.label, openedAt: w.openedAt.toISOString(), openedBy: w.openedBy,
        closedAt: close ? close.at.toISOString() : null, closeReason: close?.reason ?? null, durationMs: now.getTime() - w.openedAt.getTime(),
      },
      modes: { ...modes, guardedByMode: { ...w.guardedByMode } },
      counters: { ...w.counters },
      judgement: judgeWindow(w.counters, modes),
      incompleteByReason: { ...w.incompleteByReason },
      errorsBySource: { ...w.errorsBySource },
      unexpectedByReason: { ...w.unexpectedByReason },
      unexpectedByRoute: { ...w.unexpectedByRoute },
      expectedByRoute: { ...w.expectedByRoute },
      samples: {
        unexpected: [...w.unexpected], unexpectedDropped: w.unexpectedDropped, unexpectedKept: 'first',
        expected: [...w.expected], expectedDropped: w.expectedDropped, expectedKept: 'last',
      },
      logging: { written: { ...w.logLines }, suppressed: { ...w.logSuppressed }, budgetPerWindowAndEvent: LOG_BUDGET },
      previousWindows: [...this.closed],
      limits: {
        scope: 'this process only; other instances keep their own windows and are not aggregated',
        persistence: 'memory only; a restart starts a new instance and loses the open window (the window-closed and shutdown log lines are the durable record)',
        meaning: 'CLEAN means no unexplained difference and no missing evidence in this window of this process; it is not an audit trail and not proof for other instances or windows',
      },
    };
  }

  private newWindow(label: string | null, openedBy: OpenedBy): Window {
    return {
      id: randomUUID(), sequence: ++this.sequence, label, openedAt: new Date(), openedBy, modeAtOpen: safeMode(),
      counters: emptyCounters(), guardedByMode: {}, incompleteByReason: {}, errorsBySource: {},
      unexpectedByReason: {}, unexpectedByRoute: {}, expectedByRoute: {},
      unexpected: [], unexpectedDropped: 0, expected: [], expectedDropped: 0, ring: [], logLines: {}, logSuppressed: {},
    };
  }

  private closeCurrent(reason: CloseReason) {
    const final = this.report({ at: new Date(), reason });
    this.closed.push({
      id: final.window.id, sequence: final.window.sequence, label: final.window.label, openedAt: final.window.openedAt,
      closedAt: final.window.closedAt as string, closeReason: reason, counters: final.counters, verdict: final.judgement.verdict,
    });
    if (this.closed.length > CLOSED_KEPT) this.closed.shift();
    this.logReport('capability-shadow-window-closed', final);
    return final;
  }

  /** A window report as ONE log line, without the samples (they stay available through report()). */
  private logReport(event: string, r: ReturnType<CapabilityShadowService['report']>): void {
    const { samples, previousWindows, ...rest } = r;
    this.logger.log(JSON.stringify({
      event, ...rest,
      samples: { unexpected: samples.unexpected.length, unexpectedDropped: samples.unexpectedDropped, expected: samples.expected.length, expectedDropped: samples.expectedDropped },
      previousWindows: previousWindows.length,
    }));
  }

  private line(level: 'warn', event: string, data: Record<string, unknown>): void {
    const w = this.window;
    if ((w.logLines[event] ?? 0) >= LOG_BUDGET) { bump(w.logSuppressed, event); return; }
    bump(w.logLines, event);
    this.logger[level](JSON.stringify({ event, instance: this.instanceId, window: w.id, ...data }));
  }

  private toSample(d: ShadowDifference): ShadowSample {
    const { userId, ...rest } = d;
    return { ...rest, subject: createHmac('sha256', this.pseudonymKey).update(userId).digest('hex').slice(0, 16) };
  }
}
