import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ReleaseReservationDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
