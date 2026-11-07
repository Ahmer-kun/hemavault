import { Module } from '@nestjs/common';
import { AuditModule } from '../../common/audit/audit.module';
import { CampaignsModule } from '../campaigns/campaigns.module';
import { DonorsModule } from '../donors/donors.module';
import { InventoryModule } from '../inventory/inventory.module';
import { RbacModule } from '../rbac/rbac.module';
import { DonationService } from './application/donation.service';
import { DonationRepository } from './infrastructure/donation.repository';
import { CampaignCheckInController } from './presentation/campaign-check-in.controller';
import { DonationController } from './presentation/donation.controller';

@Module({
  imports: [RbacModule, AuditModule, DonorsModule, CampaignsModule, InventoryModule],
  controllers: [DonationController, CampaignCheckInController],
  providers: [DonationService, DonationRepository],
  exports: [DonationService, DonationRepository],
})
export class DonationsModule {}