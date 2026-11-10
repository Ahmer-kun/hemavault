import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CancelIssuanceDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
