import type { INestApplication } from '@nestjs/common';

/**
 * Number of reverse proxies in front of the app whose X-Forwarded-For entries Express may trust (TRUST_PROXY_HOPS).
 * Unset: no proxy is trusted and req.ip is the TCP peer, so every client behind the proxy shares one rate-limit key.
 * Only a positive integer is accepted, never `true`: trusting every hop lets a client pick its own IP via a forged
 * X-Forwarded-For. A hop count is only safe if every request reaches the app through exactly that many proxies.
 */
export function trustProxyHops(raw: string | undefined = process.env.TRUST_PROXY_HOPS): number | null {
  if (raw === undefined || raw.trim() === '') return null;
  if (!/^[1-9]$/.test(raw.trim())) {
    throw new Error(`TRUST_PROXY_HOPS must be an integer from 1 to 9, got "${raw}"`);
  }
  return Number(raw.trim());
}

/** Applies TRUST_PROXY_HOPS to the Express instance; a no-op when it is unset. */
export function applyTrustProxy(app: INestApplication, raw?: string): number | null {
  const hops = trustProxyHops(raw);
  if (hops !== null) {
    app.getHttpAdapter().getInstance().set('trust proxy', hops);
  }
  return hops;
}
