import { BloodGroup } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsDate,
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const DEFERRAL_REASON_CODE_PATTERN = /^[A-Z0-9_-]{2,40}$/i;

export class UpdateOwnProfileDto {
  @IsOptional()
  @IsString()
  @Length(1, 200)
  name?: string;

  @IsOptional()
  @IsISO8601()
  dateOfBirth?: string | null;

  @IsOptional()
  @IsEnum(BloodGroup)
  bloodGroup?: BloodGroup | null;
}

export class UpdateDonorDto {
  @IsOptional()
  @IsString()
  @Length(1, 200)
  name?: string;

  @IsOptional()
  @IsISO8601()
  dateOfBirth?: string | null;

  @IsOptional()
  @IsEnum(BloodGroup)
  bloodGroup?: BloodGroup | null;
}

export class CreateDeferralDto {
  @IsString()
  @Matches(DEFERRAL_REASON_CODE_PATTERN, {
    message: 'reasonCode must match /^[A-Z0-9_-]{2,40}$/i',
  })
  reasonCode!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reasonNote?: string;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  expiresAt?: Date;
}

export class ResolveDeferralDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  resolutionNote?: string;
}

export class ListDonorsQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

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

export class ListDonorDonationsQueryDto {
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