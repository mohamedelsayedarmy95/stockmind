/**
 * Series 11 / F11-02: CAPABILITY_MODE is validated. A typo must never silently select legacy authorization (or any other mode).
 */
import { readFileSync } from 'fs';
import * as path from 'path';
import { PermissionsGuard } from '../../src/presentation/guards/permissions.guard';
import {
  CapabilityModeError, capabilityMode, parseCapabilityMode, validateCapabilityConfig,
} from '../../src/shared/constants/capabilities.constant';
import { PERMISSIONS } from '../../src/shared/constants/permissions.constant';

const env = (v?: string) => (v === undefined ? {} : { CAPABILITY_MODE: v }) as NodeJS.ProcessEnv;

describe('CAPABILITY_MODE parsing', () => {
  it('a missing or blank variable is the documented default, shadow', () => {
    expect(parseCapabilityMode(undefined)).toBe('shadow');
    expect(parseCapabilityMode('')).toBe('shadow');
    expect(parseCapabilityMode('   ')).toBe('shadow');
    expect(capabilityMode(env())).toBe('shadow');
  });

  it('the three modes are recognised, ignoring case and surrounding whitespace', () => {
    for (const [raw, mode] of [['off', 'off'], ['shadow', 'shadow'], ['enforce', 'enforce'], [' ENFORCE ', 'enforce'], ['Off', 'off'], ['\tShadow\n', 'shadow']]) {
      expect(parseCapabilityMode(raw)).toBe(mode);
      expect(capabilityMode(env(raw))).toBe(mode);
    }
  });

  it.each(['enforse', 'enforced', 'on', 'yes', 'true', '1', '0', 'disabled', 'off ;', 'shadow,enforce', 'null', 'undefined', 'ｅｎｆｏｒｃｅ'])(
    'an invalid value (%j) throws: it is never turned into off, shadow or enforce',
    (raw) => {
      expect(() => parseCapabilityMode(raw)).toThrow(CapabilityModeError);
      expect(() => capabilityMode(env(raw))).toThrow(CapabilityModeError);
    },
  );

  it('the error is bounded and printable: a long or control-character value cannot flood or inject into the log', () => {
    let err: CapabilityModeError | undefined;
    try { parseCapabilityMode(`enforce\u0000\u001b[31m${'x'.repeat(500)}`); } catch (e) { err = e as CapabilityModeError; }
    expect(err).toBeInstanceOf(CapabilityModeError);
    expect(err?.code).toBe('CAPABILITY_MODE_INVALID');
    expect((err?.message ?? '').length).toBeLessThan(140);
    expect(err?.message).not.toMatch(/[\u0000-\u001f]/);
    expect(err?.message).toContain('off, shadow, enforce');
  });

  it('the boot-time validator accepts a good configuration untouched and refuses a bad one', () => {
    const good = { CAPABILITY_MODE: 'enforce', OTHER: 'x' };
    expect(validateCapabilityConfig(good)).toBe(good);
    expect(validateCapabilityConfig({ OTHER: 'x' })).toEqual({ OTHER: 'x' });
    expect(() => validateCapabilityConfig({ CAPABILITY_MODE: 'enfroce' })).toThrow(CapabilityModeError);
  });
});

describe('startup: an invalid CAPABILITY_MODE stops the application before anything is wired', () => {
  const saved = process.env.CAPABILITY_MODE;
  afterEach(() => { if (saved === undefined) delete process.env.CAPABILITY_MODE; else process.env.CAPABILITY_MODE = saved; });

  it('importing the application module with a bad value in the environment throws at once', () => {
    process.env.CAPABILITY_MODE = 'enfroce';
    jest.isolateModules(() => {
      // (class identity differs inside the isolated registry, so the message is what is checked)
      expect(() => require('../../src/app.module')).toThrow(/CAPABILITY_MODE must be one of off, shadow, enforce/);
    });
  });

  it('with a valid value the module imports', () => {
    process.env.CAPABILITY_MODE = 'shadow';
    jest.isolateModules(() => {
      expect(() => require('../../src/app.module')).not.toThrow();
    });
  });

  it('a value that comes from a .env file is refused by the ConfigModule validation (before TypeORM connects)', async () => {
    const { ConfigModule } = await import('@nestjs/config');
    process.env.CAPABILITY_MODE = 'enfroce';
    await expect(ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, validate: validateCapabilityConfig })).rejects.toBeInstanceOf(CapabilityModeError);
    process.env.CAPABILITY_MODE = 'enforce';
    await expect(ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, validate: validateCapabilityConfig })).resolves.toBeDefined();
  });

  it('the application module wires that validation and the import-time check', () => {
    const source = readFileSync(path.join(__dirname, '../../src/app.module.ts'), 'utf8');
    expect(source).toContain('validate: validateCapabilityConfig');
    expect(source).toContain('parseCapabilityMode(process.env.CAPABILITY_MODE)');
  });
});

describe('runtime: a decision made with an invalid mode fails closed', () => {
  const saved = process.env.CAPABILITY_MODE;
  afterEach(() => { if (saved === undefined) delete process.env.CAPABILITY_MODE; else process.env.CAPABILITY_MODE = saved; });

  const ctx = (user: object) => ({ switchToHttp: () => ({ getRequest: () => ({ user }) }), getHandler: () => ({}), getClass: () => ({}) } as never);

  it('the permission guard refuses to decide (no allow, no silent legacy fallback) while the mode is invalid', async () => {
    const permissions = { hasAll: jest.fn(async () => true) }; // legacy WOULD allow
    const reflector = { getAllAndOverride: jest.fn(() => [PERMISSIONS.VIEW_PRODUCT]) };
    const guard = new PermissionsGuard(reflector as never, permissions as never, {} as never, {} as never);
    process.env.CAPABILITY_MODE = 'enfroce';
    await expect(guard.canActivate(ctx({ sub: 'u', role: 'Admin', companyId: 'c' }))).rejects.toBeInstanceOf(CapabilityModeError);
    expect(permissions.hasAll).not.toHaveBeenCalled(); // the legacy path was never consulted
  });

  it('explicit off still means legacy authorization, by choice', async () => {
    const permissions = { hasAll: jest.fn(async () => false) };
    const reflector = { getAllAndOverride: jest.fn(() => [PERMISSIONS.MANAGE_ROLES]) };
    const guard = new PermissionsGuard(reflector as never, permissions as never, {} as never, {} as never);
    process.env.CAPABILITY_MODE = 'off';
    await expect(guard.canActivate(ctx({ sub: 'u', role: 'Admin', companyId: 'c' }))).resolves.toBe(true);
    await expect(guard.canActivate(ctx({ sub: 'u', role: 'Staff', companyId: 'c' }))).rejects.toThrow(/Missing required permission/);
  });
});
