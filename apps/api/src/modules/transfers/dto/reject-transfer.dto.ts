import { IsString, MaxLength, MinLength } from 'class-validator';

export class RejectTransferDto {
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  reason!: string;
}
