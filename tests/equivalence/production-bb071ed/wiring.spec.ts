/**
 * Composition points that production's hotfixes changed outside the units the other specs exercise. These are STATIC
 * source checks (the behaviour behind them is covered by the other specs in this directory): they fail if someone
 * removes the wiring that makes the redaction and 2FA protections reachable. Written for the candidate in Series 06.
 *
 *  - 64f73b9: src/app.module.ts builds the request logger from httpLoggerOptions() (the redacting options) and the
 *    audit interceptor is registered globally.
 *  - bb071ed: the 2FA login route hands the request context to the service, which is what records the attempt and
 *    applies the lockout per client.
 */
import * as fs from 'fs';
import * as path from 'path';

const src = (rel: string) => fs.readFileSync(path.join(__dirname, '../../../src', rel), 'utf8');

describe('production hotfix wiring is present in the candidate', () => {
  it('64f73b9: the request logger is built from httpLoggerOptions()', () => {
    expect(src('app.module.ts')).toContain('LoggerModule.forRoot({ pinoHttp: httpLoggerOptions() })');
  });

  it('64f73b9: the audit interceptor is registered globally', () => {
    expect(src('app.module.ts')).toMatch(/provide:\s*APP_INTERCEPTOR,\s*useClass:\s*AuditLogInterceptor/);
  });

  it('bb071ed: POST /auth/2fa/login passes the request context to the service', () => {
    expect(src('presentation/controllers/auth.controller.ts')).toContain(
      'this.authService.twoFactorLogin(dto.tempToken, dto.otpCode, this.ctx(req))',
    );
  });
});
