import { Column, DeleteDateColumn, BeforeInsert } from 'typeorm';
import { generateUuidV7 } from '../../shared/utils/uuid-v7';

export abstract class AuditableEntity {
  @Column({ name: 'public_id', type: 'uuid', unique: true, default: () => 'gen_random_uuid()' })
  publicId!: string;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;

  @Column({ name: 'deleted_by', type: 'uuid', nullable: true })
  deletedBy!: string | null;

  @BeforeInsert()
  assignPublicId() {
    if (!this.publicId) {
      this.publicId = generateUuidV7();
    }
  }
}
