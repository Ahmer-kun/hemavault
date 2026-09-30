import { Module } from '@nestjs/common';
import { AuditModule } from '../../common/audit/audit.module';
import { RbacModule } from '../rbac/rbac.module';
import { DonorService } from './application/donor.service';
import { DonorRepository } from './infrastructure/donor.repository';
import { DonorController } from './presentation/donor.controller';

@Module({
  imports: [RbacModule, AuditModule],
  controllers: [DonorController],
  providers: [DonorService, DonorRepository],
  exports: [DonorService, DonorRepository],
})
export class DonorsModule {}