import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  VersionColumn,
  ManyToOne,
  JoinColumn,
  OneToMany,
  Unique,
} from 'typeorm';
import { AuditableEntity } from './auditable.entity';
import { Company } from './company.entity';
import { Category } from './category.entity';
import { UnitOfMeasure } from './unit-of-measure.entity';
import { ProductWarehouse } from './product-warehouse.entity';
import { encryptedColumn } from '../../shared/crypto/encrypted-column.transformer';

@Entity('products')
@Unique(['companyId', 'sku'])
export class Product extends AuditableEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'company_id' })
  companyId!: string;

  @ManyToOne(() => Company, (c) => c.products, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company!: Company;

  @Column({ name: 'category_id', nullable: true })
  categoryId!: string | null;

  @ManyToOne(() => Category, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'category_id' })
  category!: Category | null;

  @Column({ length: 255 })
  name!: string;

  @Column({ length: 100 })
  sku!: string;

  @Column({ length: 100, nullable: true })
  barcode!: string | null;

  @Column({ name: 'image_url', type: 'text', nullable: true })
  imageUrl!: string | null;

  // Phase 4: commercially sensitive cost price, encrypted at rest (AES-256-GCM).
  // Stored as text (the decimal serialized) so the ciphertext envelope fits.
  // Never used in WHERE/ORDER, so encryption does not affect any query.
  @Column({ name: 'cost_price', type: 'text', nullable: true, transformer: encryptedColumn() })
  costPrice!: string | null;

  @Column({ type: 'decimal', precision: 18, scale: 6, nullable: true })
  weight!: string | null;

  @Column({ type: 'decimal', precision: 18, scale: 6, nullable: true })
  volume!: string | null;

  @Column({ name: 'expiry_date', type: 'date', nullable: true })
  expiryDate!: Date | null;

  @VersionColumn()
  version!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @OneToMany(() => UnitOfMeasure, (u) => u.product, { cascade: true })
  unitsOfMeasure!: UnitOfMeasure[];

  @OneToMany(() => ProductWarehouse, (pw) => pw.product)
  productWarehouses!: ProductWarehouse[];
}
