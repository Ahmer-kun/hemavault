import { Module } from '@nestjs/common';
import { RbacRepository } from './infrastructure/rbac.repository';
import { RbacService } from './application/rbac.service';
import { PermissionsGuard } from './presentation/permissions.guard';

@Module({
  providers: [RbacRepository, RbacService, PermissionsGuard],
  exports: [RbacService, PermissionsGuard, RbacRepository],
})
export class RbacModule {}