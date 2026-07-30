import { Controller, Post, Body, Delete, Get, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { FcmService } from '../../infrastructure/firebase/fcm.service';
import { JwtAuthGuard } from '../../presentation/guards/jwt-auth.guard';
import { RolesGuard } from '../../presentation/guards/roles.guard';
import { Roles } from '../../presentation/decorators/roles.decorator';
import { UserRole } from '../../shared/constants/enums';
import { RegisterDeviceDto } from '../../application/dtos/notifications/register-device.dto';
import { TokensRepository } from '../../infrastructure/repositories/tokens.repository';
import { Request } from 'express';
import { CurrentUser, JwtPayload } from '../../presentation/decorators/current-user.decorator';

@ApiTags('Notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly fcmService: FcmService,
    private readonly tokensRepository: TokensRepository,
  ) {}

  @Post('register-device')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.STAFF)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Register FCM device token' })
  @ApiResponse({ status: 201, description: 'Device registered' })
  async registerDevice(
    @CurrentUser() user: JwtPayload,
    @Body() body: { fcmToken: string; deviceType: 'android' | 'ios' },
  ) {
    await this.tokensRepository.saveToken(user.sub, body.fcmToken, body.deviceType);
    return { success: true, message: 'Device registered' };
  }

  @Delete('unregister-device')
  @ApiOperation({ summary: 'Unregister FCM device token' })
  @ApiResponse({ status: 200, description: 'Device unregistered' })
  async unregisterDevice(
    @CurrentUser() user: JwtPayload,
    @Body() body: { fcmToken: string },
  ) {
    await this.tokensRepository.removeToken(body.fcmToken);
    return { success: true, message: 'Device unregistered' };
  }

  @Get('devices')
  @ApiOperation({ summary: 'List user devices' })
  @ApiResponse({ status: 200, description: 'Returns list of devices' })
  async getDevices(@CurrentUser() user: JwtPayload) {
    const tokens = await this.tokensRepository.getUserTokens(user.sub);
    return {
      devices: tokens.map(t => ({
        id: t.id,
        fcmToken: t.fcmToken,
        deviceType: t.deviceType,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
      })),
    };
  }
}