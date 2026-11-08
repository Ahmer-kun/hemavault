import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { BloodRequestStatus, RequestUrgency } from '@prisma/client';

export class ListRequestsQueryDto {
  @IsOptional()
  @IsEnum(BloodRequestStatus)
  status?: BloodRequestStatus;

  @IsOptional()
  @IsEnum(RequestUrgency)
  urgency?: RequestUrgency;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
