import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { BloodGroup, RequestUrgency } from '@prisma/client';

export class CreateRequestLineDto {
  @IsUUID()
  componentTypeId!: string;

  @IsOptional()
  @IsEnum(BloodGroup)
  bloodGroupRequired?: BloodGroup;

  @IsInt()
  @Min(1)
  @Type(() => Number)
  quantityRequested!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class CreateRequestDto {
  @IsUUID()
  facilityId!: string;

  @IsOptional()
  @IsEnum(RequestUrgency)
  urgency?: RequestUrgency;

  @IsOptional()
  @IsDateString()
  requiredByAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  patientReferenceCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  operationalNotes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CreateRequestLineDto)
  lines!: CreateRequestLineDto[];
}
