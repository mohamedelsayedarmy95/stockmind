import { randomUUID } from 'crypto';
import { Warehouse } from '../../src/domain/entities/warehouse.entity';

export function makeWarehouse(overrides: Partial<Warehouse> = {}): Warehouse {
  const w = new Warehouse();
  w.id = randomUUID();
  w.publicId = randomUUID();
  w.companyId = overrides.companyId ?? randomUUID();
  w.name = overrides.name ?? 'Test Warehouse';
  w.address = overrides.address ?? null;
  w.isActive = overrides.isActive ?? true;
  w.deletedAt = null;
  w.deletedBy = null;
  w.createdAt = new Date();
  Object.assign(w, overrides);
  return w;
}
