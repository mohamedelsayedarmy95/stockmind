import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('audit_logs')
@Index(['companyId', 'createdAt'])
@Index(['entityType', 'entityId'])
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'actor_user_id', type: 'uuid', nullable: true })
  actorUserId!: string | null;

  @Column({ name: 'company_id', type: 'uuid', nullable: true })
  companyId!: string | null;

  @Column({ length: 50 })
  action!: string;

  @Column({ name: 'entity_type', type: 'varchar', length: 100, nullable: true })
  entityType!: string | null;

  @Column({ name: 'entity_id', type: 'uuid', nullable: true })
  entityId!: string | null;

  @Column({ name: 'old_values', type: 'jsonb', nullable: true })
  oldValues!: Record<string, unknown> | null;

  @Column({ name: 'new_values', type: 'jsonb', nullable: true })
  newValues!: Record<string, unknown> | null;

  @Column({ name: 'ip_address', type: 'varchar', length: 45, nullable: true })
  ipAddress!: string | null;

  @Column({ name: 'user_agent', type: 'text', nullable: true })
  userAgent!: string | null;

  @Column({ name: 'correlation_id', type: 'varchar', length: 100, nullable: true })
  correlationId!: string | null;

  // Phase 4: ties an audit row to the authenticated session (JWT `sub`+issued-at
  // derived id), so a full user session can be reconstructed for forensics.
  @Column({ name: 'session_id', type: 'varchar', length: 100, nullable: true })
  sessionId!: string | null;

  @Column({ name: 'http_method', type: 'varchar', length: 10, nullable: true })
  httpMethod!: string | null;

  @Column({ name: 'http_path', type: 'text', nullable: true })
  httpPath!: string | null;

  @Column({ name: 'status_code', type: 'integer', nullable: true })
  statusCode!: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
