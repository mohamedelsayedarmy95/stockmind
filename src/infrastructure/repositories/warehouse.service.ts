import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Warehouse } from '../../domain/entities/warehouse.entity';
import { CreateWarehouseDto } from '../../application/dtos/warehouse/create-warehouse.dto';
import { UpdateWarehouseDto } from '../../application/dtos/warehouse/update-warehouse.dto';

@Injectable()
export class WarehouseService {
  constructor(
    @InjectRepository(Warehouse)
    private readonly repo: Repository<Warehouse>,
  ) {}

  async create(companyId: string, dto: CreateWarehouseDto): Promise<Warehouse> {
    const warehouse = this.repo.create({
      companyId,
      name: dto.name,
      address: dto.address ?? null,
    });
    return this.repo.save(warehouse);
  }

  async findAll(companyId: string): Promise<Warehouse[]> {
    return this.repo.find({ where: { companyId }, order: { createdAt: 'DESC' } });
  }

  async findOne(companyId: string, id: string): Promise<Warehouse> {
    const wh = await this.repo.findOne({ where: { id, companyId } });
    if (!wh) throw new NotFoundException('Warehouse not found');
    return wh;
  }

  async update(companyId: string, id: string, dto: UpdateWarehouseDto): Promise<Warehouse> {
    const wh = await this.findOne(companyId, id);
    Object.assign(wh, dto);
    return this.repo.save(wh);
  }

  async remove(companyId: string, id: string, deletedBy: string): Promise<void> {
    const wh = await this.findOne(companyId, id);
    wh.deletedBy = deletedBy;
    await this.repo.softRemove(wh);
  }
}
