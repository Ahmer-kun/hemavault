import { BloodGroup, DonationState } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const DONATION_REJECT_REASON_PATTERN = /^[A-Z0-9_-]{2,40}$/i;

export class CreateDonationDto {
  @IsString()
  @IsNotEmpty({ message: 'facilityId is required' })
  @MaxLength(64)
  facilityId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  donorProfileId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  donorReference?: string;

  @IsOptional()
  @IsISO8601()
  scheduledFor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(100)
  @Max(1000)
  volumeMl?: number;

  @IsOptional()
  @IsEnum(BloodGroup)
  bloodGroup?: BloodGroup;
}

export class ListDonationsQueryDto {
  @IsOptional()
  @IsEnum(DonationState)
  state?: DonationState;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset = 0;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 25;
}

export class CollectDonationDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(100)
  @Max(1000)
  volumeMl?: number;

  @IsOptional()
  @IsEnum(BloodGroup)
  bloodGroup?: BloodGroup;
}

export class ScreenDonationDto {
  @IsOptional()
  @IsEnum(BloodGroup)
  bloodGroup?: BloodGroup;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @IsOptional()
  @IsIn(['PASS'])
  decision?: 'PASS';
}

export class RejectDonationDto {
  @IsOptional()
  @IsString()
  @Matches(DONATION_REJECT_REASON_PATTERN, {
    message: 'reasonCode must match /^[A-Z0-9_-]{2,40}$/i',
  })
  reasonCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reasonNote?: string;
}

export class CampaignCheckInBodyDto {
  @IsString()
  @IsNotEmpty({ message: 'donorReference is required' })
  @MaxLength(40)
  donorReference!: string;
}