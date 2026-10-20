import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Warehouse } from '../../domain/entities/warehouse.entity';
import { CreateWarehouseDto } from '../../application/dtos/warehouse/create-warehouse.dto';
import { UpdateWarehouseDto } from '../../application/dtos/warehouse/update-warehouse.dto';
import { WarehouseAccessService } from '../security/warehouse-access.service';
import { EntitlementsService } from '../billing/entitlements.service';

@Injectable()
export class WarehouseService {
  constructor(
    @InjectRepository(Warehouse)
    private readonly repo: Repository<Warehouse>,
    private readonly access: WarehouseAccessService,
    private readonly entitlements: EntitlementsService,
  ) {}

  async create(companyId: string, dto: CreateWarehouseDto): Promise<Warehouse> {
    await this.entitlements.assertCanAddWarehouse(companyId);
    const warehouse = this.repo.create({
      companyId,
      name: dto.name,
      address: dto.address ?? null,
    });
    return this.repo.save(warehouse);
  }

  /** With a viewer, only the warehouses that member may use (a Staff member: their grants). */
  async findAll(companyId: string, viewerId?: string): Promise<Warehouse[]> {
    const allowed = viewerId ? await this.access.scope(viewerId, companyId) : null;
    if (allowed && !allowed.length) return [];
    return this.repo.find({
      where: allowed ? { companyId, id: In(allowed) } : { companyId },
      order: { createdAt: 'DESC' },
    });
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
