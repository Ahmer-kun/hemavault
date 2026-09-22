import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { SessionService } from '../infrastructure/session.service';
import { authenticationRequiredError } from '../domain/auth.errors';
import { CSRF_HEADER_NAME, SESSION_COOKIE_NAME } from '../domain/auth.constants';
import type { AuthenticatedRequest, AuthenticatedSession } from './authenticated-request';

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly sessionService: SessionService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const sessionToken = (request.cookies as Record<string, string> | undefined)?.[
      SESSION_COOKIE_NAME
    ];
    if (!sessionToken) {
      throw authenticationRequiredError();
    }
    const csrfToken =
      (request.headers[CSRF_HEADER_NAME] as string | undefined) ?? null;
    const authenticated = await this.sessionService.validate(sessionToken, csrfToken);
    if (!authenticated) {
      throw authenticationRequiredError();
    }
    (request as AuthenticatedRequest).authSession = authenticated;
    return true;
  }
}

export const CurrentSession = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedSession => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const session = request.authSession;
    if (!session) {
      throw authenticationRequiredError();
    }
    return session;
  },
);