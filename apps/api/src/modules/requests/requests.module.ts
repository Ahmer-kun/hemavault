import { Module } from '@nestjs/common';
import { AuditModule } from '../../common/audit/audit.module';
import { RbacModule } from '../rbac/rbac.module';
import { InventoryModule } from '../inventory/inventory.module';
import { RequestService } from './application/request.service';
import { RequestRepository } from './infrastructure/request.repository';
import { RequestsController } from './presentation/requests.controller';
import { MatchingService } from '../matching/application/matching.service';
import { CompatibilityRuleSetRepository } from '../matching/infrastructure/compatibility-rule-set.repository';

@Module({
  imports: [RbacModule, AuditModule, InventoryModule],
  controllers: [RequestsController],
  providers: [RequestService, RequestRepository, MatchingService, CompatibilityRuleSetRepository],
  exports: [RequestService, RequestRepository],
})
export class RequestsModule {}
