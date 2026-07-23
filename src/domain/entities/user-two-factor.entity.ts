import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { encryptedColumn } from '../../shared/crypto/encrypted-column.transformer';

/**
 * TOTP two-factor secret store, one row per user.
 *
 * The `secret_key` and `backup_codes` are the crown jewels here: anyone holding
 * the secret can mint valid OTPs forever. They are therefore encrypted at rest
 * with AES-256-GCM via the column transformer, so a database dump alone does
 * not compromise the second factor.
 */
@Entity('user_two_factor')
@Index(['userId'], { unique: true })
export class UserTwoFactor {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  // Base32 TOTP secret — encrypted at rest.
  @Column({ name: 'secret_key', type: 'text', transformer: encryptedColumn() })
  secretKey!: string;

  @Column({ name: 'is_enabled', type: 'boolean', default: false })
  isEnabled!: boolean;

  // JSON array of single-use recovery codes (hashed at the app layer), encrypted at rest.
  @Column({ name: 'backup_codes', type: 'text', nullable: true, transformer: encryptedColumn() })
  backupCodes!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
