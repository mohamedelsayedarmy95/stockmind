/**
 * WP-A regression: FirebaseService is the only owner of the Firebase Admin app. FcmService (and the auth/storage
 * helpers) must use that app instead of initialising a second default app. Synthetic credentials only; the FCM
 * send is intercepted on the app's Messaging instance, so nothing leaves this machine.
 */
import { generateKeyPairSync } from 'crypto';

const KEYS = ['FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY'] as const;
const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const FULL: Record<string, string> = {
  FIREBASE_PROJECT_ID: 'synthetic-local-project',
  FIREBASE_CLIENT_EMAIL: 'fcm-test@synthetic-local-project.iam.gserviceaccount.com',
  // Stored the way env files and Render hold it: literal "\n" sequences.
  FIREBASE_PRIVATE_KEY: privateKey.replace(/\n/g, '\\n'),
};
const DEVICE_TOKEN = 'synthetic-device-token-1';

/* eslint-disable @typescript-eslint/no-var-requires, @typescript-eslint/no-explicit-any */
function boot(env: Record<string, string>) {
  for (const key of KEYS) delete process.env[key];
  Object.assign(process.env, env);
  let mods: any;
  // Fresh module registry per test: firebase-admin keeps a global app list and the helper caches its app.
  jest.isolateModules(() => {
    mods = {
      admin: require('firebase-admin'),
      helper: require('../../src/infrastructure/firebase/firebase-admin'),
      FirebaseService: require('../../src/infrastructure/firebase/firebase.service').FirebaseService,
      FcmService: require('../../src/infrastructure/firebase/fcm.service').FcmService,
    };
  });
  const firebase = new mods.FirebaseService({ get: (key: string) => env[key] });
  firebase.onModuleInit();
  const tokens = {
    getUserTokens: jest.fn().mockResolvedValue([{ fcmToken: DEVICE_TOKEN }]),
    removeToken: jest.fn().mockResolvedValue(undefined),
  };
  const fcm = new mods.FcmService(tokens);
  // Spy on the app's own (cached) Messaging instance: under isolateModules, the namespaced app.messaging() is built
  // from a different module copy than 'firebase-admin/messaging', so a prototype spy would not intercept the send.
  const send: jest.SpyInstance | jest.Mock = firebase.isEnabled()
    ? jest.spyOn(mods.admin.app().messaging(), 'sendEachForMulticast')
    : jest.fn();
  return { ...mods, firebase, tokens, fcm, send };
}

describe('WP-A: Firebase Admin app lifecycle and FCM', () => {
  let ctx: ReturnType<typeof boot> | undefined;
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(async () => {
    consoleError.mockRestore();
    if (ctx) {
      (ctx.send as jest.SpyInstance).mockRestore?.();
      await Promise.all(ctx.admin.apps.map((app: any) => app?.delete()));
    }
    ctx = undefined;
    for (const key of KEYS) delete process.env[key];
  });

  const initFailures = () => consoleError.mock.calls.filter((args) => String(args[0]).includes('Initialization failed'));

  it('configured: exactly one Firebase app, and FCM sends through it', async () => {
    ctx = boot(FULL);
    ctx.send.mockResolvedValue({ successCount: 1, failureCount: 0, responses: [{ success: true }] });

    await ctx.fcm.sendStockNotification('user-1', 'STOCK_RECEIVED', 'product-1', 3);

    expect(ctx.firebase.isEnabled()).toBe(true);
    expect(ctx.send).toHaveBeenCalledTimes(1);
    expect(ctx.send.mock.calls[0][0]).toMatchObject({
      tokens: [DEVICE_TOKEN],
      notification: { title: 'Stock STOCK_RECEIVED' },
      data: { action: 'STOCK_RECEIVED', productId: 'product-1', quantity: '3' },
    });
    expect((ctx.send.mock.contexts[0] as any).app === ctx.admin.app()).toBe(true);
    expect(ctx.admin.apps).toHaveLength(1);
    expect(initFailures()).toHaveLength(0);
  });

  it('the auth/storage helper returns the same app instead of initialising another', () => {
    ctx = boot(FULL);
    expect(ctx.helper.getFirebaseAdmin() === ctx.admin.app()).toBe(true);
    expect(ctx.helper.isFirebaseConfigured()).toBe(true);
    expect(ctx.admin.apps).toHaveLength(1);
    expect(initFailures()).toHaveLength(0);
  });

  it('deliberately disabled: no app, no token lookup, no send, no error', async () => {
    ctx = boot({});
    await ctx.fcm.sendStockNotification('user-1', 'STOCK_RECEIVED', 'product-1', 3);
    expect(ctx.firebase.isEnabled()).toBe(false);
    expect(ctx.tokens.getUserTokens).not.toHaveBeenCalled();
    expect(ctx.send).not.toHaveBeenCalled();
    expect(ctx.admin.apps).toHaveLength(0);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('incomplete credentials count as disabled: no second initialisation attempt, no send', async () => {
    ctx = boot({ FIREBASE_PROJECT_ID: FULL.FIREBASE_PROJECT_ID });
    await ctx.fcm.sendStockNotification('user-1', 'STOCK_RECEIVED', 'product-1', 3);
    expect(ctx.firebase.isEnabled()).toBe(false);
    expect(ctx.helper.isFirebaseConfigured()).toBe(false);
    expect(ctx.tokens.getUserTokens).not.toHaveBeenCalled();
    expect(ctx.send).not.toHaveBeenCalled();
    expect(ctx.admin.apps).toHaveLength(0);
    expect(initFailures()).toHaveLength(0);
  });

  it('provider failure: never throws to the caller and stops after 3 attempts', async () => {
    ctx = boot(FULL);
    ctx.send.mockRejectedValue(new Error('synthetic provider outage'));
    await expect(ctx.fcm.sendStockNotification('user-1', 'STOCK_RECEIVED', 'product-1', 3)).resolves.toBeUndefined();
    expect(ctx.send).toHaveBeenCalledTimes(3);
  });

  it('a token the provider reports as unregistered is removed', async () => {
    ctx = boot(FULL);
    ctx.send.mockResolvedValue({
      successCount: 0,
      failureCount: 1,
      responses: [{ success: false, error: { code: 'messaging/registration-token-not-registered' } }],
    });
    await ctx.fcm.sendStockNotification('user-1', 'STOCK_RECEIVED', 'product-1', 3);
    expect(ctx.tokens.removeToken).toHaveBeenCalledWith(DEVICE_TOKEN);
  });
});
