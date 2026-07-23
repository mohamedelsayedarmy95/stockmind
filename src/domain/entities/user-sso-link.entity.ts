import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from './user.entity';

/**
 * Links a local StockMind user to an external IdP identity (SAML / OIDC).
 * One user may have multiple links (multiple IdPs), but each provider+nameId
 * pair is unique.
 */
@Entity('user_sso_links')
@Index(['provider', 'providerUserId'], { unique: true })
@Index(['userId'])
export class UserSsoLink {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  /** 'saml' — extensible for OIDC later. */
  @Column({ length: 50 })
  provider: string;

  /** nameID from the SAML assertion (or 'sub' from OIDC). */
  @Column({ name: 'provider_user_id', length: 500 })
  providerUserId: string;

  @Column({ name: 'provider_email', type: 'varchar', length: 255, nullable: true })
  providerEmail: string | null;

  @Column({ name: 'display_name', type: 'varchar', length: 255, nullable: true })
  displayName: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
