import { Module } from '@nestjs/common';
import { AuditModule } from '../../common/audit/audit.module';
import { OrganizationController } from './presentation/organization.controller';
import { OrganizationService } from './application/organization.service';
import { OrganizationRepository } from './infrastructure/organization.repository';
import { RbacModule } from '../rbac/rbac.module';

@Module({
  imports: [RbacModule, AuditModule],
  controllers: [OrganizationController],
  providers: [OrganizationService, OrganizationRepository],
  exports: [OrganizationService, OrganizationRepository],
})
export class OrganizationsModule {}