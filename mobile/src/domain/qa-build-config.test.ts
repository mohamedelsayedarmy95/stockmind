/**
 * Series 12: the build-time half of the StockMind QA boundary (app.config.js + plugins/with-stockmind-qa.js), checked in
 * plain Node. The run-time half is build-variant.test.ts.
 */
import * as fs from 'fs';
import * as path from 'path';
import { isPrivateNetworkHost, isProductionHost, hostOf, QA_APPLICATION_ID } from './build-variant';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const appConfig = require('../../app.config.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const plugin = require('../../plugins/with-stockmind-qa.js');
const appJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../../app.json'), 'utf8')).expo;

function withEnv<T>(env: Record<string, string | undefined>, fn: () => T): T {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(env)) {
    saved[k] = process.env[k];
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
  try {
    return fn();
  } finally {
    for (const k of Object.keys(saved)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

const resolve = (env: Record<string, string | undefined>) =>
  withEnv(env, () => appConfig({ config: JSON.parse(JSON.stringify(appJson)) }));

describe('app.config.js', () => {
  it('without a variant the configuration is exactly app.json (the installed app identity is unchanged)', () => {
    const c = resolve({ STOCKMIND_VARIANT: undefined });
    expect(c).toEqual(appJson);
    expect(c.android.package).toBe('io.stockmind.app');
  });

  it('QA: own application id, label, scheme; no production URL; variant marker; QA plugin', () => {
    const c = resolve({ STOCKMIND_VARIANT: 'qa', STOCKMIND_QA_BUILD_ID: 'abc1234', STOCKMIND_QA_VERSION_CODE: '4242', EXPO_PUBLIC_API_BASE_URL: undefined });
    expect(c.android.package).toBe(QA_APPLICATION_ID);
    expect(c.ios.bundleIdentifier).toBe(QA_APPLICATION_ID);
    expect(c.name).toBe('StockMind QA');
    expect(c.scheme).toBe('stockmind-qa');
    expect(c.scheme).not.toBe(appJson.scheme);
    expect(c.version).toBe(`${appJson.version}-qa.abc1234`);
    expect(c.android.versionCode).toBe(4242);
    expect(c.extra.apiBaseUrl).toBeUndefined();
    expect(JSON.stringify(c)).not.toContain('onrender.com');
    expect(c.extra.stockmindVariant).toBe('qa');
    expect(c.plugins).toContainEqual(['./plugins/with-stockmind-qa', { apiBaseUrl: null }]);
  });

  it('QA keeps the rest of app.json (permissions, plugins, icons)', () => {
    const c = resolve({ STOCKMIND_VARIANT: 'qa' });
    expect(c.android.permissions).toEqual(appJson.android.permissions);
    expect(c.plugins.slice(0, appJson.plugins.length)).toEqual(appJson.plugins);
    expect(c.icon).toBe(appJson.icon);
  });

  it('an unknown variant is refused', () => {
    expect(() => resolve({ STOCKMIND_VARIANT: 'prod' })).toThrow(/Unknown STOCKMIND_VARIANT/);
    expect(() => resolve({ STOCKMIND_VARIANT: 'QA' })).toThrow(/Unknown STOCKMIND_VARIANT/);
  });
});

describe('plugins/with-stockmind-qa.js', () => {
  it.each([
    'http://127.0.0.1:3000/api/v1', 'http://10.0.2.2:3000/api/v1', 'http://192.168.1.20:3000/api/v1', 'http://localhost:3000/x',
    'https://stockmind-api-vmht.onrender.com/api/v1', 'https://api.stockmind.io/x', 'https://example.com/x', 'http://8.8.8.8/x',
    'http://172.32.0.1/x', 'http://my-pc.local:3000/x', 'not a url',
  ])('cleartext hosts follow exactly the run-time rules of build-variant.ts: %s', (url) => {
    const host = hostOf(url);
    const allowed = host !== null && !isProductionHost(host) && isPrivateNetworkHost(host);
    expect(plugin.cleartextHostsFor(url)).toEqual(allowed ? [host] : []);
  });

  it('no backend configured = no cleartext host at all', () => {
    expect(plugin.cleartextHostsFor(null)).toEqual([]);
    expect(plugin.networkSecurityXml([])).not.toContain('domain-config');
    expect(plugin.networkSecurityXml([])).toContain('<base-config cleartextTrafficPermitted="false" />');
  });

  it('a configured local backend is the only cleartext domain', () => {
    const xml = plugin.networkSecurityXml(['127.0.0.1']);
    expect(xml).toContain('<base-config cleartextTrafficPermitted="false" />');
    expect(xml.match(/<domain /g)).toHaveLength(1);
    expect(xml).toContain('<domain includeSubdomains="false">127.0.0.1</domain>');
  });

  const template = `android {
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            // Caution! In production, you need to generate your own keystore file.
            signingConfig signingConfigs.debug
            minifyEnabled enableProguardInReleaseBuilds
        }
    }
}`;

  it('release is signed with the QA key, never the debug key; a missing key fails the build', () => {
    const out: string = plugin.applyQaSigning(template);
    const release = out.slice(out.indexOf('release {'));
    expect(release).toMatch(/signingConfig signingConfigs\.stockmindQa/);
    expect(release.slice(0, release.indexOf('}'))).not.toMatch(/signingConfigs\.debug/);
    expect(out).toContain("System.getenv('STOCKMIND_QA_STORE_FILE')");
    expect(out).toContain('throw new GradleException');
    // the debug build type is untouched
    expect(out).toMatch(/debug \{\s+signingConfig signingConfigs\.debug/);
    // no key material in the generated file
    expect(out).not.toMatch(/storePassword '(?!android')/);
  });

  it('is idempotent and refuses an unexpected template instead of guessing', () => {
    const once: string = plugin.applyQaSigning(template);
    expect(plugin.applyQaSigning(once)).toBe(once);
    expect(() => plugin.applyQaSigning('android { buildTypes { release { } } }')).toThrow(/signingConfigs/);
  });
});
