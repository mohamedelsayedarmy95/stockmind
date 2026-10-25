import type { IncomingMessage, ServerResponse } from 'http';
import type { Options } from 'pino-http';
import { generateUuidV7 } from '../utils/uuid-v7';

// pino-http options for LoggerModule (AppModule). Every completed request is logged with its headers, so headers
// that carry credentials are redacted: without this, every authenticated request wrote its Bearer token to the logs.
export const REDACTED_LOG_PATHS = [
  'req.headers.authorization',
  'req.headers["proxy-authorization"]',
  'req.headers.cookie',
  // Series 13: the operator token of the local shadow diagnostics (presentation/guards/shadow-diagnostics.guard.ts).
  'req.headers["x-shadow-diagnostics-token"]',
  'res.headers["set-cookie"]',
];

export function httpLoggerOptions(): Options {
  return {
    redact: { paths: REDACTED_LOG_PATHS, censor: '[Redacted]' },
    genReqId: (req: IncomingMessage, res: ServerResponse) => {
      const existing = req.headers['x-correlation-id'];
      const id = typeof existing === 'string' ? existing : generateUuidV7();
      res.setHeader('X-Correlation-ID', id);
      res.setHeader('X-Request-ID', id);
      return id;
    },
    transport:
      process.env.NODE_ENV === 'development'
        ? { target: 'pino-pretty', options: { colorize: true, singleLine: true } }
        : undefined,
    customProps: () => ({ service: 'stockmind' }),
  };
}
