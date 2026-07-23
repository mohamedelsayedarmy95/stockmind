import { Module, Global, OnModuleInit } from '@nestjs/common';
import { TenantContextService } from '../infrastructure/context/tenant-context.service';
import { setTenantContextInstance } from '../infrastructure/context/tenant-context.holder';

@Global()
@Module({
  providers: [TenantContextService],
  exports: [TenantContextService],
})
export class ContextModule implements OnModuleInit {
  constructor(private readonly svc: TenantContextService) {}

  onModuleInit() {
    setTenantContextInstance(this.svc);
  }
}
