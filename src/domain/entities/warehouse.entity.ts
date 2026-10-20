import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { AuditableEntity } from './auditable.entity';
import { Company } from './company.entity';
import { ProductWarehouse } from './product-warehouse.entity';

@Entity('warehouses')
@Index(['companyId', 'isActive'])
export class Warehouse extends AuditableEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'company_id' })
  companyId!: string;

  @ManyToOne(() => Company, (c) => c.warehouses, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company!: Company;

  @Column({ length: 255 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  address!: string | null;

  @Column({ name: 'is_active', default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  // Sync cursor: bumped by every stock write in this warehouse (bigint, read as a string).
  @Column({ name: 'stock_revision', type: 'bigint', default: 0 })
  stockRevision!: string;

  @OneToMany(() => ProductWarehouse, (pw) => pw.warehouse)
  productWarehouses!: ProductWarehouse[];
}
