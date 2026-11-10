import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsOptional, IsString, IsUUID, MaxLength, ValidateNested } from 'class-validator';

export class RequestReservationItemDto {
  @IsUUID()
  unitId!: string;

  @IsUUID()
  requestLineId!: string;
}

export class CreateRequestReservationDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => RequestReservationItemDto)
  items!: RequestReservationItemDto[];

  @IsOptional()
  @IsString()
  @MaxLength(200)
  idempotencyKey?: string;
}
