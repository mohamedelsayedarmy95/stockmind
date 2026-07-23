import { TenantContextService } from './tenant-context.service';

let instance: TenantContextService | null = null;

export function setTenantContextInstance(svc: TenantContextService): void {
  instance = svc;
}

export function getTenantContext() {
  return instance?.get();
}
