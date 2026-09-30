import { SetMetadata, createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { ActorContext } from '../domain/policy';
import type { AuthenticatedRequest } from '../../auth/presentation/authenticated-request';
import { authenticationRequiredError } from '../../auth/domain/auth.errors';

export const PERMISSIONS_KEY = 'rbac:permissions';

export type PermissionScope = 'global' | 'anywhere' | 'facility';

export interface PermissionRequirement {
  permissions: readonly string[];
  anyOf?: boolean;
  scope: PermissionScope;
  param?: string;
}

function normalize(permissions: string | readonly string[]): readonly string[] {
  return typeof permissions === 'string' ? [permissions] : permissions;
}

export function RequirePermission(
  permissions: string | readonly string[],
  options: { scope?: PermissionScope; anyOf?: boolean; param?: string } = {},
): MethodDecorator & ClassDecorator {
  const scope = options.scope ?? 'global';
  const requirement: PermissionRequirement = {
    permissions: normalize(permissions),
    anyOf: options.anyOf ?? false,
    scope,
    param: options.param ?? 'facilityId',
  };
  return SetMetadata(PERMISSIONS_KEY, requirement);
}

export const RequireGlobal = (
  permissions: string | readonly string[],
  anyOf = false,
): MethodDecorator & ClassDecorator =>
  RequirePermission(permissions, { scope: 'global', anyOf });

export const RequireAnywhere = (
  permissions: string | readonly string[],
  anyOf = false,
): MethodDecorator & ClassDecorator =>
  RequirePermission(permissions, { scope: 'anywhere', anyOf });

export const RequireFacilityScope = (
  permissions: string | readonly string[],
  param: string,
  anyOf = false,
): MethodDecorator & ClassDecorator =>
  RequirePermission(permissions, { scope: 'facility', anyOf, param });

export const CurrentActor = createParamDecorator(
  (_data: unknown, context: ExecutionContext): ActorContext => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.actor) {
      throw authenticationRequiredError();
    }
    return request.actor;
  },
);