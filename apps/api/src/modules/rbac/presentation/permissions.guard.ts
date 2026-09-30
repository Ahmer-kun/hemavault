import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { authenticationRequiredError } from '../../auth/domain/auth.errors';
import type { AuthenticatedRequest } from '../../auth/presentation/authenticated-request';
import { ActorContext, canAnywhere, canAtFacility, canGlobally, evaluatePermissions } from '../domain/policy';
import { permissionContextMissingError } from '../domain/rbac.errors';
import { RbacService } from '../application/rbac.service';
import { PERMISSIONS_KEY, PermissionRequirement } from './permissions.decorators';
import { IS_PUBLIC_KEY } from '../../auth/presentation/auth.guard';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly rbacService: RbacService,
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

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const session = request.authSession;
    if (!session) {
      throw authenticationRequiredError();
    }

    const actor = await this.rbacService.buildActorContext(session.user.id, session.sessionId);
    (request as AuthenticatedRequest).actor = actor;

    const requirement = this.reflector.getAllAndOverride<PermissionRequirement | undefined>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requirement) {
      return true;
    }

    const allowed = this.evaluate(actor, context.switchToHttp().getRequest<Request>(), requirement);
    return allowed;
  }

  private evaluate(
    actor: ActorContext,
    request: Request,
    requirement: PermissionRequirement,
  ): boolean {
    const anyOf = requirement.anyOf ?? false;
    switch (requirement.scope) {
      case 'global':
        return evaluatePermissions(requirement.permissions, (p) => canGlobally(actor, p), anyOf);
      case 'anywhere':
        return evaluatePermissions(requirement.permissions, (p) => canAnywhere(actor, p), anyOf);
      case 'facility': {
        const facilityId = this.resolveFacilityId(request, requirement.param);
        if (!facilityId) {
          throw permissionContextMissingError();
        }
        return evaluatePermissions(
          requirement.permissions,
          (p) => canAtFacility(actor, facilityId, p),
          anyOf,
        );
      }
    }
  }

  private resolveFacilityId(request: Request, param: string | undefined): string | null {
    const fromParams = (request.params as Record<string, string> | undefined)?.[param ?? 'facilityId'];
    if (fromParams) {
      return fromParams;
    }
    const fromBody = (request.body as Record<string, unknown> | undefined)?.[param ?? 'facilityId'];
    return typeof fromBody === 'string' && fromBody.length > 0 ? fromBody : null;
  }
}