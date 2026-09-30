import { FacilityStatus, FacilityType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const FACILITY_CODE_PATTERN = /^[A-Z0-9_-]{2,40}$/i;

export class CreateFacilityDto {
  @IsUUID()
  organizationId!: string;

  @IsString()
  @Matches(FACILITY_CODE_PATTERN, {
    message: 'code must match /^[A-Z0-9_-]{2,40}$/i',
  })
  code!: string;

  @IsString()
  @Length(1, 200)
  name!: string;

  @IsEnum(FacilityType)
  type!: FacilityType;

  @IsOptional()
  @IsEmail()
  contactEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  contactPhone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  addressLine1?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  addressLine2?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  region?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  postalCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  country?: string;
}

export class UpdateFacilityDto {
  @IsOptional()
  @IsString()
  @Length(1, 200)
  name?: string;

  @IsOptional()
  @IsEnum(FacilityType)
  type?: FacilityType;

  @IsOptional()
  @IsEnum(FacilityStatus)
  status?: FacilityStatus;

  @IsOptional()
  @IsEmail()
  contactEmail?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  contactPhone?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  addressLine1?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  addressLine2?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  region?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  postalCode?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  country?: string | null;
}

export class PageQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 25;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset = 0;
}

export class AddMemberDto {
  @IsUUID()
  userId!: string;

  @IsString()
  @Length(1, 60)
  role!: string;
}