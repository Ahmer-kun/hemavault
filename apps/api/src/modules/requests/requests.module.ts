import { Module } from '@nestjs/common';
import { AuditModule } from '../../common/audit/audit.module';
import { RbacModule } from '../rbac/rbac.module';
import { RequestService } from './application/request.service';
import { RequestRepository } from './infrastructure/request.repository';
import { RequestsController } from './presentation/requests.controller';

@Module({
  imports: [RbacModule, AuditModule],
  controllers: [RequestsController],
  providers: [RequestService, RequestRepository],
  exports: [RequestService, RequestRepository],
})
export class RequestsModule {}
