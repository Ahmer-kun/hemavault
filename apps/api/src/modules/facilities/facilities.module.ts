import { Module } from '@nestjs/common';
import { AuditModule } from '../../common/audit/audit.module';
import { RbacModule } from '../rbac/rbac.module';
import { FacilityController } from './presentation/facility.controller';
import { FacilityService } from './application/facility.service';
import { FacilityRepository } from './infrastructure/facility.repository';

@Module({
  imports: [RbacModule, AuditModule],
  controllers: [FacilityController],
  providers: [FacilityService, FacilityRepository],
  exports: [FacilityService, FacilityRepository],
})
export class FacilitiesModule {}