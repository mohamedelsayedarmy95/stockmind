import {
  decideBuild, hostOf, isPrivateNetworkHost, isProductionHost, resolveApiBaseUrl, usesPinnedTransport,
  BuildInputs, QA_APPLICATION_ID, QA_UNREACHABLE_BASE_URL,
} from './build-variant';

const PROD_URL = 'https://stockmind-api-vmht.onrender.com/api/v1';

const qa = (over: Partial<BuildInputs> = {}): BuildInputs => ({
  isDev: false,
  bundleVariant: 'qa',
  nativeVariant: 'qa',
  nativeApplicationId: QA_APPLICATION_ID,
  onlineFlag: '1',
  apiBaseUrl: 'http://127.0.0.1:3000/api/v1',
  ...over,
});

describe('build variant: release builds stay offline (unchanged since before Series 12)', () => {
  it('a release build without the QA bundle marker is "release" with online off, even with every online variable set', () => {
    const d = decideBuild({ ...qa(), bundleVariant: undefined });
    expect(d).toEqual({ variant: 'release', onlineEnabled: false, refusal: 'release-build', apiHost: null });
  });

  it('a leaked QA bundle marker without the native QA identity fails closed (release, offline)', () => {
    expect(decideBuild(qa({ nativeVariant: undefined }))).toMatchObject({ variant: 'release', onlineEnabled: false, refusal: 'qa-identity-mismatch' });
    expect(decideBuild(qa({ nativeApplicationId: 'io.stockmind.app' }))).toMatchObject({ variant: 'release', onlineEnabled: false, refusal: 'qa-identity-mismatch' });
    expect(decideBuild(qa({ nativeVariant: 'QA' }))).toMatchObject({ variant: 'release', onlineEnabled: false });
  });

  it('a native QA identity without the bundle marker is not QA either', () => {
    expect(decideBuild(qa({ bundleVariant: 'QA' }))).toMatchObject({ variant: 'release', onlineEnabled: false });
  });
});

describe('build variant: StockMind QA', () => {
  it('both markers + flag + loopback backend = QA online to that host', () => {
    expect(decideBuild(qa())).toEqual({ variant: 'qa', onlineEnabled: true, refusal: null, apiHost: '127.0.0.1' });
  });

  it.each([
    ['http://10.0.2.2:3000/api/v1', '10.0.2.2'],
    ['http://192.168.1.20:3000/api/v1', '192.168.1.20'],
    ['http://172.16.0.5:3000/api/v1', '172.16.0.5'],
    ['http://172.31.255.1/api/v1', '172.31.255.1'],
    ['http://localhost:3000/api/v1', 'localhost'],
    ['HTTP://LOCALHOST:3000/api/v1', 'localhost'],
  ])('a private-network backend is allowed: %s', (url, host) => {
    expect(decideBuild(qa({ apiBaseUrl: url }))).toMatchObject({ variant: 'qa', onlineEnabled: true, apiHost: host });
  });

  it.each([
    [PROD_URL, 'production-host'],
    ['https://api.stockmind.io/api/v1', 'production-host'],
    ['https://eu.api.stockmind.io/api/v1', 'production-host'],
    ['https://example.com/api/v1', 'not-private-network'],
    ['http://8.8.8.8:3000/api/v1', 'not-private-network'],
    ['http://172.32.0.1:3000/api/v1', 'not-private-network'],
    ['http://192.169.0.1:3000/api/v1', 'not-private-network'],
    ['http://10.0.0.256:3000/api/v1', 'not-private-network'],
    ['http://my-pc.local:3000/api/v1', 'not-private-network'],
    ['http://127.0.0.1.nip.io:3000/api/v1', 'not-private-network'],
    ['ftp://127.0.0.1/api', 'bad-url'],
    ['127.0.0.1:3000', 'bad-url'],
  ])('QA refuses %s (%s) and stays offline-only', (url, refusal) => {
    expect(decideBuild(qa({ apiBaseUrl: url }))).toEqual({ variant: 'qa', onlineEnabled: false, refusal, apiHost: null });
  });

  it('QA without the online flag or URL is an offline-only QA build', () => {
    expect(decideBuild(qa({ onlineFlag: undefined }))).toMatchObject({ variant: 'qa', onlineEnabled: false, refusal: 'flag-off' });
    expect(decideBuild(qa({ onlineFlag: 'true' }))).toMatchObject({ variant: 'qa', onlineEnabled: false, refusal: 'flag-off' });
    expect(decideBuild(qa({ apiBaseUrl: undefined }))).toMatchObject({ variant: 'qa', onlineEnabled: false, refusal: 'no-url' });
    expect(decideBuild(qa({ apiBaseUrl: '' }))).toMatchObject({ variant: 'qa', onlineEnabled: false, refusal: 'no-url' });
  });
});

describe('build variant: development builds', () => {
  const dev = (over: Partial<BuildInputs> = {}): BuildInputs => ({ ...qa(), isDev: true, bundleVariant: undefined, nativeVariant: undefined, nativeApplicationId: 'io.stockmind.app', ...over });

  it('keep the pre-Series-12 rule: flag + explicit URL', () => {
    expect(decideBuild(dev())).toMatchObject({ variant: 'dev', onlineEnabled: true, apiHost: '127.0.0.1' });
    expect(decideBuild(dev({ onlineFlag: undefined }))).toMatchObject({ variant: 'dev', onlineEnabled: false, refusal: 'flag-off' });
    expect(decideBuild(dev({ apiBaseUrl: undefined }))).toMatchObject({ variant: 'dev', onlineEnabled: false, refusal: 'no-url' });
  });

  it('never the production host, even in a development build', () => {
    expect(decideBuild(dev({ apiBaseUrl: PROD_URL }))).toMatchObject({ variant: 'dev', onlineEnabled: false, refusal: 'production-host' });
  });
});

describe('API base URL and transport', () => {
  it('QA never falls back to the app config (production) URL', () => {
    const offline = decideBuild(qa({ onlineFlag: undefined }));
    expect(resolveApiBaseUrl(offline, { explicit: undefined, appConfig: PROD_URL })).toBe(QA_UNREACHABLE_BASE_URL);
    const refused = decideBuild(qa({ apiBaseUrl: PROD_URL }));
    expect(resolveApiBaseUrl(refused, { explicit: PROD_URL, appConfig: PROD_URL })).toBe(QA_UNREACHABLE_BASE_URL);
  });

  it('QA online uses exactly the configured local backend', () => {
    const d = decideBuild(qa());
    expect(resolveApiBaseUrl(d, { explicit: 'http://127.0.0.1:3000/api/v1', appConfig: PROD_URL })).toBe('http://127.0.0.1:3000/api/v1');
  });

  it('the unreachable QA address is loopback (it can never reach a real service)', () => {
    expect(isPrivateNetworkHost(hostOf(QA_UNREACHABLE_BASE_URL) as string)).toBe(true);
  });

  it('other builds keep the pre-Series-12 order', () => {
    const rel = decideBuild({ ...qa(), bundleVariant: undefined });
    expect(resolveApiBaseUrl(rel, { explicit: undefined, appConfig: PROD_URL })).toBe(PROD_URL);
    expect(resolveApiBaseUrl(rel, { explicit: 'http://x/api', appConfig: PROD_URL })).toBe('http://x/api');
    expect(resolveApiBaseUrl(rel, { explicit: undefined, appConfig: undefined })).toBe('http://10.0.2.2:3000/api/v1');
  });

  it('QA never uses the pinned transport; other builds follow the pinning configuration', () => {
    expect(usesPinnedTransport(decideBuild(qa()), true)).toBe(false);
    const rel = decideBuild({ ...qa(), bundleVariant: undefined });
    expect(usesPinnedTransport(rel, true)).toBe(true);
    expect(usesPinnedTransport(rel, false)).toBe(false);
  });
});

describe('host helpers', () => {
  it('hostOf', () => {
    expect(hostOf('http://127.0.0.1:3000/api/v1')).toBe('127.0.0.1');
    expect(hostOf('https://Example.COM')).toBe('example.com');
    expect(hostOf('http://[::1]:3000/x')).toBe('[::1]');
    expect(hostOf('not a url')).toBeNull();
    expect(hostOf(undefined)).toBeNull();
  });

  it('isProductionHost matches the host and its subdomains only', () => {
    expect(isProductionHost('stockmind-api-vmht.onrender.com')).toBe(true);
    expect(isProductionHost('x.stockmind-api-vmht.onrender.com')).toBe(true);
    expect(isProductionHost('evilstockmind-api-vmht.onrender.com')).toBe(false);
    expect(isProductionHost('onrender.com')).toBe(false);
  });
});
