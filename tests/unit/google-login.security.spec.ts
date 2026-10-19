/**
 * Google login links accounts by e-mail, so an ID token is only trusted when its e-mail is verified by the identity
 * provider; otherwise anyone who can mint a token for an unverified address could sign in as the owner of that
 * address. Any verification failure must be a 401, not a 500. Synthetic credentials; verifyIdToken is stubbed.
 */
import { generateKeyPairSync } from 'crypto';
import { UnauthorizedException } from '@nestjs/common';
import * as admin from 'firebase-admin';
import { FirebaseService } from '../../src/infrastructure/firebase/firebase.service';
import { AuthService } from '../../src/infrastructure/repositories/auth.service';

const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const env: Record<string, string> = {
  FIREBASE_PROJECT_ID: 'synthetic-local-project',
  FIREBASE_CLIENT_EMAIL: 'svc@synthetic-local-project.iam.gserviceaccount.com',
  FIREBASE_PRIVATE_KEY: privateKey.replace(/\n/g, '\\n'),
};

describe('Google login trusts only verified e-mail addresses', () => {
  let firebase: FirebaseService;
  let verifyIdToken: jest.SpyInstance;

  beforeAll(() => {
    firebase = new FirebaseService({ get: (k: string) => env[k] } as never);
    firebase.onModuleInit();
    verifyIdToken = jest.spyOn(admin.auth(admin.app()), 'verifyIdToken');
  });

  afterAll(async () => {
    verifyIdToken.mockRestore();
    await Promise.all(admin.apps.map((a) => a?.delete()));
  });

  const decoded = (email_verified: boolean | undefined) =>
    ({ uid: 'u1', email: 'victim@example.test', email_verified, name: 'V' }) as never;

  it.each([[false], [undefined]])('rejects a token whose e-mail is not verified (email_verified=%p)', async (flag) => {
    verifyIdToken.mockResolvedValueOnce(decoded(flag));
    await expect(firebase.verifyGoogleIdToken('t')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('accepts a token whose e-mail is verified', async () => {
    verifyIdToken.mockResolvedValueOnce(decoded(true));
    await expect(firebase.verifyGoogleIdToken('t')).resolves.toMatchObject({ email: 'victim@example.test' });
  });

  describe('AuthService.googleLogin', () => {
    const userRepo = { findOne: jest.fn() };
    const make = (verify: () => Promise<unknown>) =>
      new AuthService(
        userRepo as never, {} as never, {} as never, {} as never, {} as never, {} as never,
        {} as never, {} as never, { write: jest.fn() } as never, { verifyGoogleIdToken: verify } as never,
      );

    beforeEach(() => jest.clearAllMocks());

    it('maps an invalid token to 401 (was 500)', async () => {
      const auth = make(async () => { throw new Error('Decoding Firebase ID token failed'); });
      await expect(auth.googleLogin('garbage')).rejects.toBeInstanceOf(UnauthorizedException);
      expect(userRepo.findOne).not.toHaveBeenCalled();
    });

    it('never looks up an account for an unverified e-mail', async () => {
      const auth = make(async () => { throw new UnauthorizedException('Google account e-mail is not verified'); });
      await expect(auth.googleLogin('t')).rejects.toBeInstanceOf(UnauthorizedException);
      expect(userRepo.findOne).not.toHaveBeenCalled();
    });
  });
});
