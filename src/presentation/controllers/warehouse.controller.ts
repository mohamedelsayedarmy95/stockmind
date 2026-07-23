import {
  Controller, Get, Post, Patch, Delete, Param, Body, UseGuards,
} from '@nestjs/common';
import { WarehouseService } from '../../infrastructure/repositories/warehouse.service';
import { CreateWarehouseDto } from '../../application/dtos/warehouse/create-warehouse.dto';
import { UpdateWarehouseDto } from '../../application/dtos/warehouse/update-warehouse.dto';
import { CurrentUser, JwtPayload } from '../decorators/current-user.decorator';
import { RequirePermissions } from '../decorators/require-permissions.decorator';
import { PermissionsGuard } from '../guards/permissions.guard';
import { PERMISSIONS } from '../../shared/constants/permissions.constant';

@Controller('warehouses')
@UseGuards(PermissionsGuard)
export class WarehouseController {
  constructor(private readonly service: WarehouseService) {}

  @Post()
  @RequirePermissions(PERMISSIONS.CREATE_WAREHOUSE)
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateWarehouseDto) {
    return this.service.create(user.companyId, dto);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.VIEW_WAREHOUSE)
  findAll(@CurrentUser() user: JwtPayload) {
    return this.service.findAll(user.companyId);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.VIEW_WAREHOUSE)
  findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.service.findOne(user.companyId, id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.UPDATE_WAREHOUSE)
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateWarehouseDto,
  ) {
    return this.service.update(user.companyId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.DELETE_WAREHOUSE)
  remove(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.service.remove(user.companyId, id, user.sub);
  }
}
