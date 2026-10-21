import { SetMetadata } from '@nestjs/common';

export const SKIP_AUDIT_KEY = 'audit:skip';

/**
 * For read-only endpoints that use POST only to carry a request body (lookups): they change nothing, so the audit
 * interceptor must not record them as a CREATE with the response stored as "new values".
 */
export const SkipAudit = () => SetMetadata(SKIP_AUDIT_KEY, true);
