import { Module } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { AuthController } from './presentation/auth.controller';
import { AuthService } from './application/auth.service';
import { SessionService } from './infrastructure/session.service';
import { AuthRepository } from './infrastructure/auth.repository';
import { SessionRepository } from './infrastructure/session.repository';
import { Argon2PasswordHasher } from './domain/password-hasher';
import { EMAIL_PROVIDER } from './infrastructure/email-provider';
import { DevConsoleEmailProvider } from './infrastructure/dev-email-provider';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    SessionService,
    AuthRepository,
    SessionRepository,
    Argon2PasswordHasher,
    AuditService,
    { provide: EMAIL_PROVIDER, useClass: DevConsoleEmailProvider },
  ],
  exports: [AuthService, SessionService, AuditService],
})
export class AuthModule {}