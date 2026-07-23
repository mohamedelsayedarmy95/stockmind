import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  OneToMany,
} from 'typeorm';
import { AuditableEntity } from './auditable.entity';
import { Warehouse } from './warehouse.entity';
import { User } from './user.entity';
import { Product } from './product.entity';
import { Category } from './category.entity';

@Entity('companies')
export class Company extends AuditableEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ length: 255 })
  name!: string;

  @Column({ name: 'tax_id', type: 'varchar', length: 100, nullable: true })
  taxId!: string | null;

  @Column({ length: 10, default: 'USD' })
  currency!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @OneToMany(() => Warehouse, (w) => w.company)
  warehouses!: Warehouse[];

  @OneToMany(() => User, (u) => u.company)
  users!: User[];

  @OneToMany(() => Product, (p) => p.company)
  products!: Product[];

  @OneToMany(() => Category, (c) => c.company)
  categories!: Category[];
}
