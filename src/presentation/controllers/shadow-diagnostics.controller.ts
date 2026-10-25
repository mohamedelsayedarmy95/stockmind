import { Body, Controller, Get, Header, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { Public } from '../decorators/public.decorator';
import { SkipAudit } from '../decorators/skip-audit.decorator';
import { ShadowDiagnosticsGuard } from '../guards/shadow-diagnostics.guard';
import { CapabilityShadowService } from '../../infrastructure/security/capability-shadow.service';

export class OpenShadowWindowDto {
  /** A short name for the rehearsal step this window covers (letters, digits, `.`, `_`, `:`, `-`). */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Matches(/^[A-Za-z0-9._:-]+$/)
  label?: string;
}

/**
 * Series 13 / N-2: the shadow evidence of THIS process, for an operator running a local rehearsal (no tenant role, no JWT).
 * Off unless SHADOW_DIAGNOSTICS_TOKEN is set; only from the loopback interface; the token in `X-Shadow-Diagnostics-Token`.
 * Any refusal is the router's 404. Never in the API documentation, never in the tenant audit log, never cached.
 *
 *   GET  /internal/capability-shadow          the current window's report (shadow-window.ts judges it)
 *   POST /internal/capability-shadow/window   closes the current window (its final report is returned and logged), opens the next
 */
@ApiExcludeController()
@Public()
@UseGuards(ShadowDiagnosticsGuard)
@Controller('internal/capability-shadow')
export class ShadowDiagnosticsController {
  constructor(private readonly shadow: CapabilityShadowService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  report() {
    return this.shadow.report();
  }

  @Post('window')
  @SkipAudit() // an operator action on process memory, not a change to any company's data (the audit interceptor reads it per handler)
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  openWindow(@Body() dto: OpenShadowWindowDto) {
    return this.shadow.openWindow(dto?.label);
  }
}
