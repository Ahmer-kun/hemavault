import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Length } from 'class-validator';

export class RegisterDto {
  @ApiProperty({ example: 'staff@blood-ops.example' })
  @IsEmail({}, { message: 'email must be a valid email address' })
  email!: string;

  @ApiProperty({ minLength: 12, maxLength: 128 })
  @IsString()
  @Length(12, 128, { message: 'password must be between 12 and 128 characters' })
  password!: string;
}

export class VerifyEmailDto {
  @ApiProperty()
  @IsString()
  @Length(1, 256)
  token!: string;
}

export class LoginDto {
  @ApiProperty()
  @IsEmail({}, { message: 'email must be a valid email address' })
  email!: string;

  @ApiProperty()
  @IsString()
  password!: string;
}

export class ForgotPasswordDto {
  @ApiProperty()
  @IsEmail({}, { message: 'email must be a valid email address' })
  email!: string;
}

export class ResetPasswordDto {
  @ApiProperty()
  @IsString()
  @Length(1, 256)
  token!: string;

  @ApiProperty({ minLength: 12, maxLength: 128 })
  @IsString()
  @Length(12, 128, { message: 'password must be between 12 and 128 characters' })
  newPassword!: string;
}