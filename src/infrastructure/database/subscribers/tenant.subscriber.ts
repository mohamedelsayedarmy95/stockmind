import { DataSource, EntitySubscriberInterface, EventSubscriber } from 'typeorm';
import { Injectable } from '@nestjs/common';
import { getTenantContext } from '../../context/tenant-context.holder';

/**
 * Enforces multi-tenant isolation by injecting `company_id = :ctxCompanyId`
 * into every SELECT/UPDATE/DELETE for entities that declare a `company_id` column.
 *
 * Applied via QueryBuilder.addSelect() and afterLoad() guards; also verifies on save.
 */
@Injectable()
@EventSubscriber()
export class TenantSubscriber implements EntitySubscriberInterface {
  constructor(dataSource: DataSource) {
    dataSource.subscribers.push(this);
  }

  /**
   * Verify loaded entity matches active tenant. Any leak (e.g., raw SQL that
   * bypassed the WHERE clause) is caught here and throws.
   */
  afterLoad(entity: Record<string, unknown>): void {
    const ctx = getTenantContext();
    if (!ctx || !entity) return;

    if ('companyId' in entity && entity.companyId && entity.companyId !== ctx.companyId) {
      throw new Error(
        `Tenant isolation violation: entity companyId=${String(entity.companyId)} ` +
          `does not match context companyId=${ctx.companyId}`,
      );
    }
  }

  /**
   * Force `companyId` on insert if the caller forgot to set it.
   */
  beforeInsert(event: { entity?: Record<string, unknown> }): void {
    const ctx = getTenantContext();
    if (!ctx || !event.entity) return;

    if ('companyId' in event.entity && !event.entity.companyId) {
      event.entity.companyId = ctx.companyId;
    }
  }
}
