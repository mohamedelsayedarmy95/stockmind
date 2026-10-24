import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { CurrentUser, JwtPayload } from '../decorators/current-user.decorator';
import { RequirePermissions } from '../decorators/require-permissions.decorator';
import { PermissionsGuard } from '../guards/permissions.guard';
import { PERMISSIONS } from '../../shared/constants/permissions.constant';
import { HistoryGenerationService } from '../../infrastructure/repositories/history-generation.service';
import { RotateGenerationDto } from '../../application/dtos/stock/rotate-generation.dto';

/**
 * Operator procedures after a database restore. Authenticated company Admin only (MANAGE_RECOVERY); rotating is
 * additionally off unless RECOVERY_OPERATIONS_ENABLED=true. Every rotation is audited twice: the request/response in the
 * audit log and an immutable history_generation_events row with the reason.
 */
@Controller('recovery/history-generation')
@UseGuards(PermissionsGuard)
@RequirePermissions(PERMISSIONS.MANAGE_RECOVERY)
export class RecoveryController {
  constructor(private readonly generations: HistoryGenerationService) {}

  @Get()
  async current(@CurrentUser() user: JwtPayload) {
    return { generation: await this.generations.current(user.companyId), events: await this.generations.events(user.companyId) };
  }

  /** Starts a new history generation: every client of this company rebuilds from the server and re-checks its receipts. */
  @Post('rotate')
  @HttpCode(HttpStatus.OK)
  rotate(@CurrentUser() user: JwtPayload, @Body() dto: RotateGenerationDto) {
    return this.generations.rotate(user.companyId, user.sub, dto.reason);
  }
}
