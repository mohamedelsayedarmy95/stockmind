import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';

export interface TenantContext {
  userId: string;
  companyId: string;
  role: string;
  correlationId?: string;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class TenantContextService {
  private readonly storage = new AsyncLocalStorage<TenantContext>();

  run<T>(context: TenantContext, callback: () => T): T {
    return this.storage.run(context, callback);
  }

  get(): TenantContext | undefined {
    return this.storage.getStore();
  }

  getRequired(): TenantContext {
    const ctx = this.storage.getStore();
    if (!ctx) throw new Error('Tenant context not initialized');
    return ctx;
  }

  getCompanyId(): string | undefined {
    return this.storage.getStore()?.companyId;
  }
}
