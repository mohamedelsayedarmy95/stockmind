/**
 * A2: the public register endpoint must never return internal error text (driver messages, constraint names).
 * A unique-violation race on the e-mail is the same 409 the pre-check returns; anything else is a generic 500.
 */
import { ConflictException, HttpException, InternalServerErrorException } from '@nestjs/common';
import { AuthService } from '../../src/infrastructure/repositories/auth.service';

const INTERNAL = 'duplicate key value violates unique constraint "uq_users_email" SENTINEL_INTERNAL_DETAIL';

function make(failure: Error) {
  const qr = {
    connect: jest.fn(), startTransaction: jest.fn(), release: jest.fn(),
    rollbackTransaction: jest.fn().mockResolvedValue(undefined),
    manager: { create: jest.fn((_e: unknown, v: unknown) => v), save: jest.fn().mockRejectedValue(failure) },
  };
  return new AuthService(
    { findOne: jest.fn().mockResolvedValue(null) } as never, {} as never, {} as never, {} as never,
    { get: () => undefined } as never, { createQueryRunner: () => qr } as never,
    {} as never, {} as never, { write: jest.fn() } as never, {} as never, { assertSeatAvailable: async () => undefined } as never
  );
}

const dto = { companyName: 'Co', name: 'N', email: 'n@example.test', password: 'Aa1!aaaaaaaaaaaa' } as never;
const responseText = (e: unknown) => JSON.stringify((e as HttpException).getResponse());

describe('A2: register never leaks internal errors', () => {
  it('a unique-violation race on the e-mail is a 409 like the pre-check', async () => {
    const err = Object.assign(new Error(INTERNAL), { code: '23505' });
    const result = await make(err).register(dto).catch((e) => e);
    expect(result).toBeInstanceOf(ConflictException);
    expect(responseText(result)).not.toContain('SENTINEL_INTERNAL_DETAIL');
    expect(responseText(result)).not.toContain('uq_users_email');
  });

  it('any other failure is a generic 500 without the internal message', async () => {
    const result = await make(new TypeError(INTERNAL)).register(dto).catch((e) => e);
    expect(result).toBeInstanceOf(InternalServerErrorException);
    expect(responseText(result)).not.toContain('SENTINEL_INTERNAL_DETAIL');
    expect(responseText(result)).not.toContain('DEBUG');
    expect(responseText(result)).not.toContain('TypeError');
  });
});
