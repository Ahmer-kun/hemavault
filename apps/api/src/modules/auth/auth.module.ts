import { Module } from '@nestjs/common';
import { AuditModule } from '../../common/audit/audit.module';
import { AuthController } from './presentation/auth.controller';
import { AuthService } from './application/auth.service';
import { SessionService } from './infrastructure/session.service';
import { AuthRepository } from './infrastructure/auth.repository';
import { SessionRepository } from './infrastructure/session.repository';
import { Argon2PasswordHasher } from './domain/password-hasher';
import { EMAIL_PROVIDER } from './infrastructure/email-provider';
import { DevConsoleEmailProvider } from './infrastructure/dev-email-provider';

@Module({
  imports: [AuditModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    SessionService,
    AuthRepository,
    SessionRepository,
    Argon2PasswordHasher,
    { provide: EMAIL_PROVIDER, useClass: DevConsoleEmailProvider },
  ],
  exports: [AuthService, SessionService],
})
export class AuthModule {}