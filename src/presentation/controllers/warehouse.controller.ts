import {
  Controller, Get, Post, Patch, Delete, Param, Body, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { WarehouseService } from '../../infrastructure/repositories/warehouse.service';
import { CreateWarehouseDto } from '../../application/dtos/warehouse/create-warehouse.dto';
import { UpdateWarehouseDto } from '../../application/dtos/warehouse/update-warehouse.dto';
import { CurrentUser, JwtPayload } from '../decorators/current-user.decorator';
import { RequirePermissions } from '../decorators/require-permissions.decorator';
import { PermissionsGuard } from '../guards/permissions.guard';
import { WarehouseScoped } from '../guards/warehouse-access.guard';
import { PERMISSIONS } from '../../shared/constants/permissions.constant';

@ApiTags('Warehouses')
@ApiBearerAuth()
@Controller('warehouses')
@UseGuards(PermissionsGuard)
export class WarehouseController {
  constructor(private readonly service: WarehouseService) {}

  @Post()
  @RequirePermissions(PERMISSIONS.CREATE_WAREHOUSE)
  @ApiOperation({ summary: 'Create a new warehouse' })
  @ApiResponse({ status: 201, description: 'Warehouse created' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateWarehouseDto) {
    return this.service.create(user.companyId, dto);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.VIEW_WAREHOUSE)
  @ApiOperation({ summary: 'Get all warehouses for the company' })
  @ApiResponse({ status: 200, description: 'Returns list of warehouses' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  findAll(@CurrentUser() user: JwtPayload) {
    return this.service.findAll(user.companyId, user.sub);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.VIEW_WAREHOUSE)
  @WarehouseScoped('params.id')
  @ApiOperation({ summary: 'Get warehouse by ID' })
  @ApiResponse({ status: 200, description: 'Returns warehouse details' })
  @ApiResponse({ status: 404, description: 'Warehouse not found' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.service.findOne(user.companyId, id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.UPDATE_WAREHOUSE)
  @WarehouseScoped('params.id')
  @ApiOperation({ summary: 'Update warehouse' })
  @ApiResponse({ status: 200, description: 'Warehouse updated' })
  @ApiResponse({ status: 404, description: 'Warehouse not found' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateWarehouseDto,
  ) {
    return this.service.update(user.companyId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.DELETE_WAREHOUSE)
  @WarehouseScoped('params.id')
  @ApiOperation({ summary: 'Delete warehouse' })
  @ApiResponse({ status: 200, description: 'Warehouse deleted' })
  @ApiResponse({ status: 404, description: 'Warehouse not found' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  remove(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.service.remove(user.companyId, id, user.sub);
  }
}