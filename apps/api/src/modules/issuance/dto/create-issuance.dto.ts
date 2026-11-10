import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class IssuanceItemDto {
  /** An active reservation item claims exactly one concrete inventory unit. */
  @IsUUID()
  reservationItemId!: string;
}

export class CreateIssuanceDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => IssuanceItemDto)
  items!: IssuanceItemDto[];

  @IsOptional()
  @IsString()
  @MaxLength(200)
  idempotencyKey?: string;
}
