import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Product } from './product.entity';

@Entity('units_of_measure')
export class UnitOfMeasure {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'product_id' })
  productId!: string;

  @ManyToOne(() => Product, (p) => p.unitsOfMeasure, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'product_id' })
  product!: Product;

  @Column({ name: 'uom_type', length: 50 })
  uomType!: string;

  @Column({ length: 20 })
  code!: string;

  @Column({
    name: 'conversion_factor_to_base',
    type: 'decimal',
    precision: 18,
    scale: 6,
    default: 1,
  })
  conversionFactorToBase!: string;
}
