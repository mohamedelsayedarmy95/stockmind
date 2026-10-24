/**
 * Google login links accounts by e-mail, so an ID token is only trusted when its e-mail is verified by the identity
 * provider; otherwise anyone who can mint a token for an unverified address could sign in as the owner of that
 * address. Any verification failure must be a 401, not a 500. Synthetic credentials; verifyIdToken is stubbed.
 */
import { UnauthorizedException } from '@nestjs/common';
import { FirebaseService } from '../../../src/infrastructure/firebase/firebase.service';
import { AuthService } from '../../../src/infrastructure/repositories/auth.service';

describe('Google login trusts only verified e-mail addresses', () => {
  // ADAPTED (setup only): the candidate verifies Google ID tokens with google-auth-library (OAuth2Client.verifyIdToken)
  // instead of the Firebase Admin SDK, so the stub target changes. What each test sends and asserts is unchanged.
  const firebase = new FirebaseService({ get: () => undefined } as never);
  const verifyIdToken = jest.spyOn(
    (firebase as unknown as { googleClient: { verifyIdToken: () => unknown } }).googleClient, 'verifyIdToken');

  const decoded = (email_verified: boolean | undefined) =>
    ({ getPayload: () => ({ sub: 'u1', email: 'victim@example.test', email_verified, name: 'V' }) }) as never;

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
        { assertSeatAvailable: async () => undefined } as never, // ADAPTED (DI only): AuthService gained an EntitlementsService constructor parameter
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
