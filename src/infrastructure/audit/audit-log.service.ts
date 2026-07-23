import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog } from '../../domain/entities/audit-log.entity';

export interface AuditWriteInput {
  actorUserId?: string | null;
  companyId?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  oldValues?: Record<string, unknown> | null;
  newValues?: Record<string, unknown> | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  correlationId?: string | null;
  sessionId?: string | null;
  httpMethod?: string | null;
  httpPath?: string | null;
  statusCode?: number | null;
}

// Field names whose values must never reach the audit store in the clear.
const AUDIT_REDACT_FIELDS = new Set([
  'password',
  'currentPassword',
  'newPassword',
  'passwordHash',
  'refreshToken',
  'refreshTokenHash',
  'accessToken',
  'tempToken',
  'secret',
  'secretKey',
  'otpCode',
  'backupCodes',
  'token',
]);

/** Recursively replaces sensitive field values with [REDACTED] before persistence. */
export function maskSensitive(obj: unknown): unknown {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(maskSensitive);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (AUDIT_REDACT_FIELDS.has(k)) out[k] = '[REDACTED]';
    else if (v && typeof v === 'object') out[k] = maskSensitive(v);
    else out[k] = v;
  }
  return out;
}

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(
    @InjectRepository(AuditLog) private readonly repo: Repository<AuditLog>,
  ) {}

  async write(input: AuditWriteInput): Promise<void> {
    try {
      await this.repo.insert({
        actorUserId: input.actorUserId ?? null,
        companyId: input.companyId ?? null,
        action: input.action,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        // Belt-and-braces: mask again at the sink so no caller can leak secrets.
        oldValues: (maskSensitive(input.oldValues ?? null)) as never,
        newValues: (maskSensitive(input.newValues ?? null)) as never,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
        correlationId: input.correlationId ?? null,
        sessionId: input.sessionId ?? null,
        httpMethod: input.httpMethod ?? null,
        httpPath: input.httpPath ?? null,
        statusCode: input.statusCode ?? null,
      });
    } catch (err) {
      // audit must never break the request flow
      this.logger.error(`Failed to write audit log: ${(err as Error).message}`);
    }
  }
}
