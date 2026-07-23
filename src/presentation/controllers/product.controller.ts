import {
  Controller, Get, Post, Patch, Delete, Param, Body,
  UseInterceptors, UploadedFile, Inject, UseGuards, Req, Header,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import type { Request } from 'express';
import { ProductService } from '../../infrastructure/repositories/product.service';
import { CreateProductDto } from '../../application/dtos/product/create-product.dto';
import { UpdateProductDto } from '../../application/dtos/product/update-product.dto';
import { CreateProductCommand } from '../../application/commands/create-product.command';
import { GetProductListQuery } from '../../application/queries/get-product-list.query';
import { CurrentUser, JwtPayload } from '../decorators/current-user.decorator';
import { RequirePermissions } from '../decorators/require-permissions.decorator';
import { PermissionsGuard } from '../guards/permissions.guard';
import { PERMISSIONS } from '../../shared/constants/permissions.constant';
import { FILE_STORAGE_TOKEN, IFileStorageService } from '../../domain/services/file-storage.interface';

@Controller('products')
@UseGuards(PermissionsGuard)
export class ProductController {
  constructor(
    private readonly service: ProductService,
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
    @Inject(FILE_STORAGE_TOKEN) private readonly storage: IFileStorageService,
  ) {}

  private corr(req: Request): string | undefined {
    const id = req.headers['x-correlation-id'] ?? (req as unknown as { id?: string }).id;
    return typeof id === 'string' ? id : undefined;
  }

  @Post()
  @RequirePermissions(PERMISSIONS.CREATE_PRODUCT)
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateProductDto, @Req() req: Request) {
    return this.commandBus.execute(
      new CreateProductCommand(user.sub, user.companyId, dto, this.corr(req)),
    );
  }

  @Get()
  @RequirePermissions(PERMISSIONS.VIEW_PRODUCT)
  @Header('Cache-Control', 'private, max-age=60')
  findAll(@CurrentUser() user: JwtPayload) {
    return this.queryBus.execute(new GetProductListQuery(user.companyId));
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.VIEW_PRODUCT)
  findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.service.findOne(user.companyId, id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.UPDATE_PRODUCT)
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.service.update(user.companyId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.DELETE_PRODUCT)
  remove(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.service.remove(user.companyId, id, user.sub);
  }

  @Post(':id/image')
  @RequirePermissions(PERMISSIONS.UPDATE_PRODUCT)
  @UseInterceptors(
    FileInterceptor('image', {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  async uploadImage(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const uploaded = await this.storage.upload(
      {
        buffer: file.buffer,
        originalname: file.originalname,
        mimetype: file.mimetype,
        size: file.size,
      },
      `products/${user.companyId}`,
    );
    return this.service.uploadImage(user.companyId, id, uploaded.url);
  }

  @Post('categories')
  @RequirePermissions(PERMISSIONS.CREATE_PRODUCT)
  createCategory(
    @CurrentUser() user: JwtPayload,
    @Body() body: { name: string; parentId?: string },
  ) {
    return this.service.createCategory(user.companyId, body.name, body.parentId);
  }

  @Get('categories/all')
  @RequirePermissions(PERMISSIONS.VIEW_PRODUCT)
  findAllCategories(@CurrentUser() user: JwtPayload) {
    return this.service.findAllCategories(user.companyId);
  }
}
