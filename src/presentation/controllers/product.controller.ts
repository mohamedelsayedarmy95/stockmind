import {
  Controller, Get, Post, Patch, Delete, Param, Body,
  UseInterceptors, UploadedFile, Inject, UseGuards, Req, Header,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse, ApiConsumes, ApiBody } from '@nestjs/swagger';
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

@ApiTags('Product')
@ApiBearerAuth()
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
  @ApiOperation({ summary: 'Create a new product' })
  @ApiResponse({ status: 201, description: 'Product created successfully' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateProductDto, @Req() req: Request) {
    return this.commandBus.execute(
      new CreateProductCommand(user.sub, user.companyId, dto, this.corr(req)),
    );
  }

  @Get()
  @RequirePermissions(PERMISSIONS.VIEW_PRODUCT)
  @Header('Cache-Control', 'private, max-age=60')
  @ApiOperation({ summary: 'Get list of products for the company' })
  @ApiResponse({ status: 200, description: 'Returns paginated product list' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  findAll(@CurrentUser() user: JwtPayload) {
    return this.queryBus.execute(new GetProductListQuery(user.companyId));
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.VIEW_PRODUCT)
  @ApiOperation({ summary: 'Get product by ID' })
  @ApiResponse({ status: 200, description: 'Returns the product' })
  @ApiResponse({ status: 404, description: 'Product not found' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.service.findOne(user.companyId, id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.UPDATE_PRODUCT)
  @ApiOperation({ summary: 'Update product by ID' })
  @ApiResponse({ status: 200, description: 'Product updated successfully' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 404, description: 'Product not found' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.service.update(user.companyId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.DELETE_PRODUCT)
  @ApiOperation({ summary: 'Delete product by ID' })
  @ApiResponse({ status: 200, description: 'Product deleted successfully' })
  @ApiResponse({ status: 404, description: 'Product not found' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
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
  @ApiOperation({ summary: 'Upload image for product' })
  @ApiResponse({ status: 200, description: 'Image uploaded successfully' })
  @ApiResponse({ status: 413, description: 'File too large' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'Image file',
    schema: {
      type: 'object',
      properties: {
        image: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
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
  @ApiOperation({ summary: 'Create a product category' })
  @ApiResponse({ status: 201, description: 'Category created' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  createCategory(
    @CurrentUser() user: JwtPayload,
    @Body() body: { name: string; parentId?: string },
  ) {
    return this.service.createCategory(user.companyId, body.name, body.parentId);
  }

  @Get('categories/all')
  @RequirePermissions(PERMISSIONS.VIEW_PRODUCT)
  @ApiOperation({ summary: 'Get all product categories' })
  @ApiResponse({ status: 200, description: 'Returns list of categories' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  findAllCategories(@CurrentUser() user: JwtPayload) {
    return this.service.findAllCategories(user.companyId);
  }
}