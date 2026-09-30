import { Injectable } from '@nestjs/common';
import {
  ActorContext,
  canAnywhere,
  canAtFacility,
  canGlobally,
  evaluatePermissions,
} from '../domain/policy';
import { forbiddenError } from '../domain/rbac.errors';
import { RbacRepository, FacilityScopeLoad } from '../infrastructure/rbac.repository';

export interface PermissionGate {
  permissions: readonly string[];
  anyOf?: boolean;
}

@Injectable()
export class RbacService {
  constructor(private readonly repository: RbacRepository) {}

  async buildActorContext(userId: string, sessionId: string): Promise<ActorContext> {
    const [globalPermissions, facilityScopes] = await Promise.all([
      this.repository.loadGlobalPermissions(userId),
      this.repository.loadFacilityScopes(userId),
    ]);
    return this.toActorContext(userId, sessionId, globalPermissions, facilityScopes);
  }

  toActorContext(
    userId: string,
    sessionId: string,
    globalPermissions: string[],
    facilityScopes: FacilityScopeLoad[],
  ): ActorContext {
    const byFacility = new Map<string, Set<string>>();
    for (const scope of facilityScopes) {
      const current = byFacility.get(scope.facilityId) ?? new Set<string>();
      for (const permission of scope.permissions) {
        current.add(permission);
      }
      byFacility.set(scope.facilityId, current);
    }
    return {
      userId,
      sessionId,
      globalPermissions: new Set(globalPermissions),
      facilityPermissions: byFacility,
    };
  }

  authorizeGlobal(actor: ActorContext, gate: PermissionGate): boolean {
    return evaluatePermissions(gate.permissions, (p) => canGlobally(actor, p), gate.anyOf ?? false);
  }

  authorizeAnywhere(actor: ActorContext, gate: PermissionGate): boolean {
    return evaluatePermissions(gate.permissions, (p) => canAnywhere(actor, p), gate.anyOf ?? false);
  }

  authorizeAtFacility(actor: ActorContext, facilityId: string, gate: PermissionGate): boolean {
    return evaluatePermissions(
      gate.permissions,
      (p) => canAtFacility(actor, facilityId, p),
      gate.anyOf ?? false,
    );
  }

  assertGlobally(actor: ActorContext, gate: PermissionGate): void {
    if (!this.authorizeGlobal(actor, gate)) {
      throw forbiddenError();
    }
  }

  assertAnywhere(actor: ActorContext, gate: PermissionGate): void {
    if (!this.authorizeAnywhere(actor, gate)) {
      throw forbiddenError();
    }
  }

  assertAtFacility(actor: ActorContext, facilityId: string, gate: PermissionGate): void {
    if (!this.authorizeAtFacility(actor, facilityId, gate)) {
      throw forbiddenError();
    }
  }
}