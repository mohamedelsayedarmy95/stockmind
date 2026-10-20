import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { TeamService } from '../../infrastructure/repositories/team.service';
import { CreateInvitationDto, SetWarehouseAccessDto } from '../../application/dtos/team/team.dto';
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
  constructor(private readonly team: TeamService) {}

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

  @Put('members/:id/warehouses')
  setWarehouses(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetWarehouseAccessDto,
  ) {
    return this.team.setWarehouseAccess(user.companyId, user.sub, id, dto.warehouseIds);
  }
}
