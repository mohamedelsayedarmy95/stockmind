import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
} from 'typeorm';
import { AuditableEntity } from './auditable.entity';
import { Company } from './company.entity';
import { Warehouse } from './warehouse.entity';
import { MemberStatus, UserRole } from '../../shared/constants/enums';
import { UserFcmToken } from './user-fcm-token.entity';

@Entity('users')
@Index(['companyId'])
export class User extends AuditableEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'company_id' })
  companyId!: string;

  @ManyToOne(() => Company, (c) => c.users, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company!: Company;

  @Column({ name: 'warehouse_id', type: 'uuid', nullable: true })
  warehouseId!: string | null;

  @ManyToOne(() => Warehouse, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'warehouse_id' })
  warehouse!: Warehouse | null;

  @Column({ length: 255 })
  name!: string;

  @Column({ length: 255, unique: true })
  email!: string;

  @Column({ name: 'password_hash', length: 255 })
  passwordHash!: string;

  @Column({ type: 'enum', enum: UserRole, default: UserRole.STAFF })
  role!: UserRole;

  /** Series 09: whether the member may use the company's data. Checked on every request and inside every stock write. */
  @Column({ type: 'text', default: MemberStatus.ACTIVE })
  status!: MemberStatus;

  /** Bumped on suspend/remove/role change/revoke-sessions; an access token carries the version it was issued under. */
  @Column({ name: 'token_version', type: 'int', default: 0 })
  tokenVersion!: number;

  /** Ownership as metadata, separate from the Admin role. Never changed through the API in Series 09. */
  @Column({ name: 'is_owner', type: 'boolean', default: false })
  isOwner!: boolean;

  @Column({ name: 'status_changed_at', type: 'timestamptz', nullable: true })
  statusChangedAt!: Date | null;

  @Column({ name: 'status_changed_by', type: 'uuid', nullable: true })
  statusChangedBy!: string | null;

  @OneToMany(() => UserFcmToken, (token) => token.user)
  fcmTokens: UserFcmToken[];

  @Column({ name: 'refresh_token_hash', type: 'varchar', length: 255, nullable: true })
  refreshTokenHash!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
