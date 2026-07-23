/**
 * SSL-pinned HTTP adapter for production builds.
 *
 * In development (__DEV__ = true), requests go through the standard `fetch`
 * implementation (no pinning). In production (__DEV__ = false), requests are
 * routed through `react-native-ssl-pinning` which enforces the certificate
 * pin at the native TLS layer (OkHttp on Android, NSURLSession on iOS).
 *
 * This file is imported by api/client.ts which swaps the axios adapter to
 * `pinnedAxiosAdapter` when PINNING.enforce is true.
 *
 * ─── Setup (run after `expo prebuild`) ──────────────────────────────────────
 *  Android: Copy your cert as  android/app/src/main/assets/stockmind-prod.cer
 *  iOS:     Add stockmind-prod.cer to the Xcode project (Copy Bundle Resources)
 *  Both:    Reference it by the filename stem ('stockmind-prod') in CERT_NAME.
 *
 *  The cert file must be DER-encoded (.cer or .der):
 *    openssl s_client -connect api.stockmind.io:443 -servername api.stockmind.io \
 *      </dev/null | openssl x509 -outform DER -out stockmind-prod.cer
 * ────────────────────────────────────────────────────────────────────────────
 */

import type { AxiosAdapter, AxiosResponse } from 'axios';
import { PINNING } from '../../certificates/pinning';

/**
 * Stem of the bundled DER certificate file (without extension).
 * Must match the filename placed in android/app/src/main/assets/ and the iOS
 * bundle (Copy Bundle Resources).
 */
const CERT_NAME = 'stockmind-prod';

/** Minimal shape of the react-native-ssl-pinning fetch response. */
interface PinnedResponse {
  status: number;
  headers: Record<string, string>;
  bodyString: string;
}

interface PinnedFetchModule {
  fetch(
    url: string,
    opts: {
      method: string;
      headers: Record<string, string>;
      body?: string;
      sslPinning: { certs: string[] };
      timeoutInterval?: number;
    },
  ): Promise<PinnedResponse>;
}

function loadPinnedFetch(): PinnedFetchModule {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('react-native-ssl-pinning') as PinnedFetchModule;
}

/**
 * Axios adapter that routes requests through `react-native-ssl-pinning`.
 * Swap in production via `api.defaults.adapter = pinnedAxiosAdapter`.
 */
export const pinnedAxiosAdapter: AxiosAdapter = async (config) => {
  const { fetch: pinnedFetch } = loadPinnedFetch();

  const url = config.url ?? '';
  const method = (config.method ?? 'GET').toUpperCase();

  // Flatten AxiosRequestHeaders into a plain Record<string, string>.
  const rawHeaders = (config.headers ?? {}) as Record<string, unknown>;
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawHeaders)) {
    if (typeof v === 'string') headers[k] = v;
  }

  let body: string | undefined;
  if (config.data !== undefined && config.data !== null) {
    body =
      typeof config.data === 'string' ? config.data : JSON.stringify(config.data);
  }

  const res = await pinnedFetch(url, {
    method,
    headers,
    body,
    sslPinning: { certs: [CERT_NAME] },
    timeoutInterval: typeof config.timeout === 'number' ? config.timeout / 1000 : 15,
  });

  // Parse JSON body if the response content-type indicates it.
  let data: unknown = res.bodyString;
  const ct = res.headers['content-type'] ?? res.headers['Content-Type'] ?? '';
  if (ct.includes('application/json')) {
    try {
      data = JSON.parse(res.bodyString);
    } catch {
      /* leave as string */
    }
  }

  const axiosResponse: AxiosResponse = {
    data,
    status: res.status,
    statusText: String(res.status),
    headers: res.headers,
    config,
    request: null as unknown,
  };

  // Axios throws for non-2xx when validateStatus is the default.
  const validateStatus = config.validateStatus ?? ((s: number) => s >= 200 && s < 300);
  if (!validateStatus(res.status)) {
    const err = Object.assign(new Error(`Request failed with status code ${res.status}`), {
      isAxiosError: true,
      config,
      response: axiosResponse,
    });
    throw err;
  }

  return axiosResponse;
};

/**
 * Returns true only when SSL pinning should be enforced (production + pinning
 * config says to enforce). Safe to call at module init time.
 */
export const shouldPin = (): boolean => PINNING.enforce && !__DEV__;
