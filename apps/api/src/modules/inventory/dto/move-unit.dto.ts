import { IsEnum, IsOptional, IsString } from 'class-validator';
import { InventoryMovementType, UnitState } from '@prisma/client';

export class MoveUnitDto {
  @IsEnum(UnitState)
  toState!: UnitState;

  @IsOptional()
  @IsEnum(InventoryMovementType)
  movementType?: InventoryMovementType;

  @IsOptional()
  @IsString()
  reason?: string;
}
