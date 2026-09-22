import { Injectable } from '@nestjs/common';
import { User, UserStatus } from '@prisma/client';
import { PrismaService } from '../../../common/database/prisma.service';

export interface NewUserInput {
  email: string;
  passwordHash: string;
}

export interface NewEmailVerificationInput {
  tokenHash: string;
  expiresAt: Date;
}

export interface NewPasswordResetInput {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
}

export interface UserWithVerification {
  user: User;
}

@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createUserWithVerification(
    user: NewUserInput,
    verification: NewEmailVerificationInput,
  ): Promise<{ user: User }> {
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: user.email,
          passwordHash: user.passwordHash,
          status: UserStatus.PENDING_VERIFICATION,
        },
      });
      await tx.emailVerificationToken.create({
        data: {
          userId: created.id,
          tokenHash: verification.tokenHash,
          expiresAt: verification.expiresAt,
        },
      });
      return { user: created };
    });
  }

  async findUserByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async findUserById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async applyLoginFailure(
    userId: string,
    lockedUntilAt: Date | null,
    attempts: number,
  ): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { failedLoginCount: attempts, lockedUntilAt },
    });
  }

  async resetLoginFailure(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { failedLoginCount: 0, lockedUntilAt: null },
    });
  }

  async completeEmailVerification(userId: string): Promise<User> {
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id: userId },
        data: {
          emailVerifiedAt: new Date(),
          status: UserStatus.ACTIVE,
        },
      });
      await tx.emailVerificationToken.updateMany({
        where: { userId },
        data: { usedAt: new Date() },
      });
      return user;
    });
  }

  async findEmailVerificationByTokenHash(tokenHash: string): Promise<{
    id: string;
    userId: string;
    expiresAt: Date;
    usedAt: Date | null;
  } | null> {
    return this.prisma.emailVerificationToken.findUnique({
      where: { tokenHash },
      select: { id: true, userId: true, expiresAt: true, usedAt: true },
    });
  }

  async markEmailVerificationUsed(id: string): Promise<void> {
    await this.prisma.emailVerificationToken.update({
      where: { id },
      data: { usedAt: new Date() },
    });
  }

  async createPasswordResetToken(input: NewPasswordResetInput): Promise<void> {
    await this.prisma.passwordResetToken.create({
      data: {
        userId: input.userId,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
      },
    });
  }

  async findPasswordResetByTokenHash(tokenHash: string): Promise<{
    id: string;
    userId: string;
    expiresAt: Date;
    usedAt: Date | null;
  } | null> {
    return this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      select: { id: true, userId: true, expiresAt: true, usedAt: true },
    });
  }

  async markPasswordResetUsed(id: string): Promise<void> {
    await this.prisma.passwordResetToken.update({
      where: { id },
      data: { usedAt: new Date() },
    });
  }

  async resetPasswordAndRevokeSessions(
    userId: string,
    passwordHash: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          passwordHash,
          failedLoginCount: 0,
          lockedUntilAt: null,
        },
      });
      await tx.session.updateMany({
        where: { userId },
        data: { revokedAt: new Date() },
      });
    });
  }
}