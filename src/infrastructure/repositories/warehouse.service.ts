import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { Warehouse } from '../../domain/entities/warehouse.entity';
import { CreateWarehouseDto } from '../../application/dtos/warehouse/create-warehouse.dto';
import { UpdateWarehouseDto } from '../../application/dtos/warehouse/update-warehouse.dto';
import { WarehouseAccessService } from '../security/warehouse-access.service';
import { EntitlementsService } from '../billing/entitlements.service';
import { AccessGrantService } from './access-grant.service';

@Injectable()
export class WarehouseService {
  constructor(
    @InjectRepository(Warehouse)
    private readonly repo: Repository<Warehouse>,
    private readonly access: WarehouseAccessService,
    private readonly entitlements: EntitlementsService,
    private readonly dataSource: DataSource,
    private readonly grants: AccessGrantService,
  ) {}

  /**
   * A new warehouse is visible to nobody but Admin and Manager (company-wide by design): no Staff grant is ever created
   * automatically (CP-4). `initialAccess` lets an actor who is allowed to manage team access decide, in the SAME transaction,
   * who gets the new warehouse and with which profile; an actor who may not is refused (nothing is created), never ignored.
   */
  async create(companyId: string, dto: CreateWarehouseDto, actorId?: string): Promise<Warehouse> {
    await this.entitlements.assertCanAddWarehouse(companyId);
    if (!dto.initialAccess?.length) {
      const warehouse = this.repo.create({ companyId, name: dto.name, address: dto.address ?? null });
      return this.repo.save(warehouse);
    }
    return this.dataSource.transaction(async (m) => {
      const saved = await m.getRepository(Warehouse).save(
        m.getRepository(Warehouse).create({ companyId, name: dto.name, address: dto.address ?? null }),
      );
      await this.grants.assignOnCreate(m, companyId, actorId as string, saved.id, dto.initialAccess ?? []);
      return saved;
    });
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
