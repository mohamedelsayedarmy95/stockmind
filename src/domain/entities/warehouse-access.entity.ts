import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Which warehouses a team member may use. Admin and Manager see every warehouse of their company and need no rows;
 * Staff see only the warehouses listed here (enforced by WarehouseAccessService, never by the app).
 */
@Entity('warehouse_access')
@Index(['userId', 'warehouseId'], { unique: true })
export class WarehouseAccess {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'company_id', type: 'uuid' })
  companyId!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'warehouse_id', type: 'uuid' })
  warehouseId!: string;

  @Column({ name: 'granted_by', type: 'uuid', nullable: true })
  grantedBy!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
