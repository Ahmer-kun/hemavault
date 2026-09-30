import { Module } from '@nestjs/common';
import { AuditModule } from '../../common/audit/audit.module';
import { DonorsModule } from '../donors/donors.module';
import { RbacModule } from '../rbac/rbac.module';
import { CampaignService } from './application/campaign.service';
import { CampaignRepository } from './infrastructure/campaign.repository';
import { CampaignController } from './presentation/campaign.controller';

@Module({
  imports: [RbacModule, AuditModule, DonorsModule],
  controllers: [CampaignController],
  providers: [CampaignService, CampaignRepository],
  exports: [CampaignService, CampaignRepository],
})
export class CampaignsModule {}