import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  VersionColumn,
  ManyToOne,
  JoinColumn,
  Unique,
} from 'typeorm';
import { Product } from './product.entity';
import { Warehouse } from './warehouse.entity';

@Entity('product_warehouse')
@Unique(['productId', 'warehouseId'])
export class ProductWarehouse {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'product_id' })
  productId!: string;

  @ManyToOne(() => Product, (p) => p.productWarehouses, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'product_id' })
  product!: Product;

  @Column({ name: 'warehouse_id' })
  warehouseId!: string;

  @ManyToOne(() => Warehouse, (w) => w.productWarehouses, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'warehouse_id' })
  warehouse!: Warehouse;

  @Column({
    name: 'base_quantity',
    type: 'decimal',
    precision: 18,
    scale: 6,
    default: 0,
  })
  baseQuantity!: string;

  @Column({
    name: 'reserved_quantity',
    type: 'decimal',
    precision: 18,
    scale: 6,
    default: 0,
  })
  reservedQuantity!: string;

  @Column({
    name: 'reorder_point',
    type: 'decimal',
    precision: 18,
    scale: 6,
    nullable: true,
  })
  reorderPoint!: string | null;

  @Column({
    name: 'max_stock',
    type: 'decimal',
    precision: 18,
    scale: 6,
    nullable: true,
  })
  maxStock!: string | null;

  @VersionColumn()
  version!: number;
}
