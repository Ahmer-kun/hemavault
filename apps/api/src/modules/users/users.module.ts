import { Module } from '@nestjs/common';
import { AuditModule } from '../../common/audit/audit.module';
import { RbacModule } from '../rbac/rbac.module';
import { UserAdminController } from './presentation/user-admin.controller';
import { UserAdminService } from './application/user-admin.service';
import { UserAdminRepository } from './infrastructure/user-admin.repository';

@Module({
  imports: [RbacModule, AuditModule],
  controllers: [UserAdminController],
  providers: [UserAdminService, UserAdminRepository],
  exports: [UserAdminService, UserAdminRepository],
})
export class UsersModule {}