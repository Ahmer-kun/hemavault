import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;
}

export class ListUsersQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

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

export class AssignRoleDto {
  @IsString()
  @Length(1, 60)
  role!: string;
}

export class RoleParamDto {
  @IsString()
  @Length(1, 60)
  roleCode!: string;
}