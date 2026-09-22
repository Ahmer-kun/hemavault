import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { csrfViolationError } from '../domain/auth.errors';
import type { AuthenticatedRequest } from './authenticated-request';

@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.authSession || !request.authSession.csrfValid) {
      throw csrfViolationError();
    }
    return true;
  }
}