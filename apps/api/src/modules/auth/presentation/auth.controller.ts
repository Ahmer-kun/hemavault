import { Body, Controller, Delete, Get, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags, ApiResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { AppConfigService } from '../../../common/config/app-config.service';
import { AuthService, RequestContext, SafeUser } from '../application/auth.service';
import { SESSION_COOKIE_NAME } from '../domain/auth.constants';
import { CurrentSession, Public } from './auth.guard';
import { CsrfGuard } from './csrf.guard';
import {
  ForgotPasswordDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
  VerifyEmailDto,
} from './auth.dto';
import type { AuthenticatedRequest, AuthenticatedSession } from './authenticated-request';

interface Envelope<T> {
  data: T;
  meta: { requestId: string };
}

interface LoginData {
  user: SafeUser;
  csrfToken: string;
  expiresAt: Date;
  rotated: boolean;
}

@ApiTags('auth')
@Controller('api/v1/auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: AppConfigService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('register')
  @ApiOperation({ summary: 'Register a new user (email verification required).' })
  @ApiResponse({ status: 201 })
  async register(
    @Body() body: RegisterDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<Envelope<{ message: string }>> {
    const result = await this.authService.register(body.email, body.password);
    return { data: result, meta: { requestId: req.requestId } };
  }

  @Public()
  @Post('verify-email')
  @HttpCode(200)
  @ApiOperation({ summary: 'Verify an email address with the emailed token.' })
  async verifyEmail(
    @Body() body: VerifyEmailDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<Envelope<{ message: string }>> {
    const result = await this.authService.verifyEmail(body.token);
    return { data: result, meta: { requestId: req.requestId } };
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Sign in and receive a session cookie and CSRF token.' })
  async login(
    @Body() body: LoginDto,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Envelope<LoginData>> {
    const currentSessionToken =
      (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE_NAME] ?? null;
    const result = await this.authService.login(body.email, body.password, this.context(req), currentSessionToken);
    if (result.rotated) {
      this.clearSessionCookie(res);
    }
    this.setSessionCookie(res, result.sessionToken, result.expiresAt);
    return {
      data: {
        user: result.user,
        csrfToken: result.csrfToken,
        expiresAt: result.expiresAt,
        rotated: result.rotated,
      },
      meta: { requestId: req.requestId },
    };
  }

  @UseGuards(CsrfGuard)
  @Post('logout')
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Sign out the current session.' })
  async logout(
    @Req() req: AuthenticatedRequest,
    @CurrentSession() session: AuthenticatedSession,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Envelope<{ message: string }>> {
    const result = await this.authService.logout(session.user.id, session.sessionId, this.context(req));
    this.clearSessionCookie(res);
    return { data: result, meta: { requestId: req.requestId } };
  }

  @UseGuards(CsrfGuard)
  @Delete('logout-all')
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke all sessions for the current user.' })
  async logoutAll(
    @Req() req: AuthenticatedRequest,
    @CurrentSession() session: AuthenticatedSession,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Envelope<{ message: string }>> {
    const result = await this.authService.logoutAll(session.user.id, this.context(req));
    this.clearSessionCookie(res);
    return { data: result, meta: { requestId: req.requestId } };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('forgot-password')
  @HttpCode(200)
  @ApiOperation({ summary: 'Request a password reset email (anti-enumeration response).' })
  async forgotPassword(
    @Body() body: ForgotPasswordDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<Envelope<{ message: string }>> {
    const result = await this.authService.forgotPassword(body.email, this.context(req));
    return { data: result, meta: { requestId: req.requestId } };
  }

  @Public()
  @Post('reset-password')
  @HttpCode(200)
  @ApiOperation({ summary: 'Set a new password using a reset token.' })
  async resetPassword(
    @Body() body: ResetPasswordDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<Envelope<{ message: string }>> {
    const result = await this.authService.resetPassword(body.token, body.newPassword);
    return { data: result, meta: { requestId: req.requestId } };
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Return the authenticated user.' })
  async me(
    @Req() req: AuthenticatedRequest,
    @CurrentSession() session: AuthenticatedSession,
  ): Promise<Envelope<{ user: SafeUser }>> {
    const result = await this.authService.me(session.user.id);
    return { data: result, meta: { requestId: req.requestId } };
  }

  private context(req: AuthenticatedRequest): RequestContext {
    return {
      requestId: req.requestId,
      ipAddress: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    };
  }

  private setSessionCookie(res: Response, token: string, expiresAt: Date): void {
    res.cookie(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      secure: this.config.cookieSecure,
      sameSite: 'lax',
      path: '/',
      expires: expiresAt,
      priority: 'high',
    });
  }

  private clearSessionCookie(res: Response): void {
    res.clearCookie(SESSION_COOKIE_NAME, {
      httpOnly: true,
      secure: this.config.cookieSecure,
      sameSite: 'lax',
      path: '/',
    });
  }
}