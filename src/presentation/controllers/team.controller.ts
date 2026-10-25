import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { TeamService } from '../../infrastructure/repositories/team.service';
import { MembershipService } from '../../infrastructure/repositories/membership.service';
import {
  ChangeRoleDto, CreateInvitationDto, MembershipActionDto, RemoveMemberDto, SetWarehouseAccessDto,
} from '../../application/dtos/team/team.dto';
import { UserRole } from '../../shared/constants/enums';
import { CurrentUser, JwtPayload } from '../decorators/current-user.decorator';
import { RequirePermissions } from '../decorators/require-permissions.decorator';
import { PermissionsGuard } from '../guards/permissions.guard';
import { PERMISSIONS } from '../../shared/constants/permissions.constant';

/** Team management for the caller's company. MANAGE_USERS (Admin by default) on every route. */
@ApiTags('Team')
@ApiBearerAuth()
@Controller('team')
@UseGuards(PermissionsGuard)
@RequirePermissions(PERMISSIONS.MANAGE_USERS)
export class TeamController {
  constructor(
    private readonly team: TeamService,
    private readonly membership: MembershipService,
  ) {}

  @Post('invitations')
  invite(@CurrentUser() user: JwtPayload, @Body() dto: CreateInvitationDto) {
    return this.team.createInvitation(user.companyId, user.sub, dto);
  }

  @Get('invitations')
  invitations(@CurrentUser() user: JwtPayload) {
    return this.team.listInvitations(user.companyId);
  }

  @Delete('invitations/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  revoke(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.team.revokeInvitation(user.companyId, user.sub, id);
  }

  /** Plan, status, limits and current usage (seats, invitations, warehouses). */
  @Get('entitlements')
  entitlements(@CurrentUser() user: JwtPayload) {
    return this.team.getEntitlements(user.companyId);
  }

  @Get('members')
  members(@CurrentUser() user: JwtPayload) {
    return this.team.listMembers(user.companyId);
  }

  // ── Member lifecycle (Series 09 / S1) ───────────────────────────────────────────────────────────────────────────
  // Each action is one transaction; suspend, remove, role change and revoke-sessions take effect on the member's very
  // next request. The policy (who may act on whom) lives in domain/membership/membership-policy.ts.

  @Post('members/:id/suspend')
  @HttpCode(HttpStatus.OK)
  suspend(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MembershipActionDto) {
    return this.membership.apply(user.companyId, user.sub, id, 'suspend', { reason: dto.reason });
  }

  @Post('members/:id/reactivate')
  @HttpCode(HttpStatus.OK)
  reactivate(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MembershipActionDto) {
    return this.membership.apply(user.companyId, user.sub, id, 'reactivate', { reason: dto.reason });
  }

  @Post('members/:id/remove')
  @HttpCode(HttpStatus.OK)
  remove(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RemoveMemberDto) {
    return this.membership.apply(user.companyId, user.sub, id, 'remove', { reason: dto.reason });
  }

  @Post('members/:id/revoke-sessions')
  @HttpCode(HttpStatus.OK)
  revokeSessions(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MembershipActionDto) {
    return this.membership.apply(user.companyId, user.sub, id, 'revoke_sessions', { reason: dto.reason });
  }

  @Patch('members/:id/role')
  changeRole(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ChangeRoleDto) {
    return this.membership.apply(user.companyId, user.sub, id, 'change_role', {
      newRole: dto.role as UserRole,
      acknowledgeCompanyWideAccess: dto.acknowledgeCompanyWideAccess,
      reason: dto.reason,
    });
  }

  @Get('members/:id/events')
  events(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.membership.events(user.companyId, id);
  }

  @Put('members/:id/warehouses')
  setWarehouses(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetWarehouseAccessDto,
  ) {
    return this.team.setWarehouseAccess(user.companyId, user.sub, id, dto.warehouseIds);
  }
}
