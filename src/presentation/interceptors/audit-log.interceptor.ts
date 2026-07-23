import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap, catchError, throwError } from 'rxjs';
import { AuditLogService } from '../../infrastructure/audit/audit-log.service';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const REDACT_FIELDS = new Set([
  'password',
  'currentPassword',
  'newPassword',
  'passwordHash',
  'refreshToken',
  'refreshTokenHash',
  'accessToken',
  'tempToken',
  'otpCode',
  'secret',
  'secretKey',
  'backupCodes',
]);

function sanitize(obj: unknown): unknown {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sanitize);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (REDACT_FIELDS.has(k)) out[k] = '[REDACTED]';
    else if (v && typeof v === 'object') out[k] = sanitize(v);
    else out[k] = v;
  }
  return out;
}

function actionFromMethod(method: string): string {
  switch (method) {
    case 'POST': return 'CREATE';
    case 'PUT':
    case 'PATCH': return 'UPDATE';
    case 'DELETE': return 'DELETE';
    default: return method;
  }
}

@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditLogInterceptor.name);

  constructor(private readonly audit: AuditLogService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest();
    if (!WRITE_METHODS.has(req.method)) {
      return next.handle();
    }

    const user = req.user as { sub?: string; companyId?: string; iat?: number } | undefined;
    const correlationId = req.headers['x-correlation-id'] ?? (req as { id?: string }).id;
    const routePath = (req.route?.path as string | undefined) ?? req.url;
    const entityType = deriveEntityType(routePath);
    const idFromParams = (req.params?.id as string | undefined) ?? null;
    // A stable per-session id: same JWT (sub + issued-at) ⇒ same session_id.
    const sessionId =
      user?.sub && user?.iat ? `${user.sub}.${user.iat}` : null;

    const baseInput = {
      actorUserId: user?.sub ?? null,
      companyId: user?.companyId ?? null,
      action: actionFromMethod(req.method),
      entityType,
      entityId: idFromParams,
      oldValues: null,
      newValues: sanitize(req.body) as Record<string, unknown> | null,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'] ?? null,
      correlationId: typeof correlationId === 'string' ? correlationId : null,
      sessionId,
      httpMethod: req.method,
      httpPath: routePath,
      statusCode: null as number | null,
    };

    return next.handle().pipe(
      tap((response) => {
        const responseEntityId =
          (response as { id?: string } | undefined)?.id ?? idFromParams;
        void this.audit.write({
          ...baseInput,
          entityId: responseEntityId,
          statusCode: context.switchToHttp().getResponse().statusCode ?? 200,
          newValues: sanitize({ request: baseInput.newValues, response }) as Record<string, unknown>,
        });
      }),
      catchError((err) => {
        void this.audit.write({
          ...baseInput,
          statusCode: (err as { status?: number }).status ?? 500,
          newValues: sanitize({
            request: baseInput.newValues,
            error: (err as Error).message,
          }) as Record<string, unknown>,
        });
        return throwError(() => err);
      }),
    );
  }
}

function deriveEntityType(path: string): string | null {
  // /api/v1/products/:id -> "products"
  const match = path.match(/\/api\/v1\/([^/]+)/);
  return match?.[1] ?? null;
}
