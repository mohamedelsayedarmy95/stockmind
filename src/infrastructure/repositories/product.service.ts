import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from '../../domain/entities/product.entity';
import { UnitOfMeasure } from '../../domain/entities/unit-of-measure.entity';
import { Category } from '../../domain/entities/category.entity';
import { CreateProductDto } from '../../application/dtos/product/create-product.dto';
import { UpdateProductDto } from '../../application/dtos/product/update-product.dto';

@Injectable()
export class ProductService {
  constructor(
    @InjectRepository(Product) private readonly productRepo: Repository<Product>,
    @InjectRepository(UnitOfMeasure) private readonly uomRepo: Repository<UnitOfMeasure>,
    @InjectRepository(Category) private readonly categoryRepo: Repository<Category>,
  ) {}

  async create(companyId: string, dto: CreateProductDto): Promise<Product> {
    const existing = await this.productRepo.findOne({
      where: { companyId, sku: dto.sku },
    });
    if (existing) {
      throw new ConflictException(`SKU "${dto.sku}" already exists`);
    }

    const product = this.productRepo.create({
      companyId,
      name: dto.name,
      sku: dto.sku,
      categoryId: dto.categoryId ?? null,
      barcode: dto.barcode ?? null,
      costPrice: dto.costPrice ?? null,
      weight: dto.weight ?? null,
      volume: dto.volume ?? null,
      expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : null,
    });
    const saved = await this.productRepo.save(product);

    if (dto.unitsOfMeasure?.length) {
      const uoms = dto.unitsOfMeasure.map((u) =>
        this.uomRepo.create({
          productId: saved.id,
          uomType: u.uomType,
          code: u.code,
          conversionFactorToBase: u.conversionFactorToBase ?? '1',
        }),
      );
      await this.uomRepo.save(uoms);
    }

    return this.findOne(companyId, saved.id);
  }

  async findAll(companyId: string): Promise<Product[]> {
    return this.productRepo.find({
      where: { companyId },
      relations: ['unitsOfMeasure', 'category'],
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(companyId: string, id: string): Promise<Product> {
    const product = await this.productRepo.findOne({
      where: { id, companyId },
      relations: ['unitsOfMeasure', 'category'],
    });
    if (!product) throw new NotFoundException('Product not found');
    return product;
  }

  async update(companyId: string, id: string, dto: UpdateProductDto): Promise<Product> {
    const product = await this.findOne(companyId, id);

    if (dto.sku && dto.sku !== product.sku) {
      const dup = await this.productRepo.findOne({
        where: { companyId, sku: dto.sku },
      });
      if (dup) throw new ConflictException(`SKU "${dto.sku}" already exists`);
    }

    Object.assign(product, {
      ...dto,
      expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : product.expiryDate,
    });
    await this.productRepo.save(product);
    return this.findOne(companyId, id);
  }

  async remove(companyId: string, id: string, deletedBy: string): Promise<void> {
    const product = await this.findOne(companyId, id);
    product.deletedBy = deletedBy;
    await this.productRepo.softRemove(product);
  }

  async uploadImage(companyId: string, id: string, filePath: string): Promise<Product> {
    const product = await this.findOne(companyId, id);
    product.imageUrl = filePath;
    return this.productRepo.save(product);
  }

  async createCategory(companyId: string, name: string, parentId?: string): Promise<Category> {
    const category = this.categoryRepo.create({
      companyId,
      name,
      parentId: parentId ?? null,
    });
    return this.categoryRepo.save(category);
  }

  async findAllCategories(companyId: string): Promise<Category[]> {
    return this.categoryRepo.find({
      where: { companyId },
      relations: ['children'],
    });
  }
}
