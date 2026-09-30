export interface ActorContext {
  userId: string;
  sessionId: string;
  globalPermissions: ReadonlySet<string>;
  facilityPermissions: ReadonlyMap<string, ReadonlySet<string>>;
}

export function emptyActor(): ActorContext {
  return {
    userId: '',
    sessionId: '',
    globalPermissions: new Set(),
    facilityPermissions: new Map(),
  };
}

export function canGlobally(actor: ActorContext, permission: string): boolean {
  return actor.globalPermissions.has(permission);
}

export function canAnywhere(actor: ActorContext, permission: string): boolean {
  if (actor.globalPermissions.has(permission)) {
    return true;
  }
  for (const permissions of actor.facilityPermissions.values()) {
    if (permissions.has(permission)) {
      return true;
    }
  }
  return false;
}

export function canAtFacility(
  actor: ActorContext,
  facilityId: string,
  permission: string,
): boolean {
  if (actor.globalPermissions.has(permission)) {
    return true;
  }
  return actor.facilityPermissions.get(facilityId)?.has(permission) ?? false;
}

export function isMemberOfFacility(actor: ActorContext, facilityId: string): boolean {
  return actor.facilityPermissions.has(facilityId);
}

export function anyFacilityIds(actor: ActorContext): ReadonlySet<string> {
  return new Set(actor.facilityPermissions.keys());
}

export function evaluatePermissions(
  permissions: readonly string[],
  test: (permission: string) => boolean,
  anyOf: boolean,
): boolean {
  if (permissions.length === 0) {
    return true;
  }
  return anyOf
    ? permissions.some((permission) => test(permission))
    : permissions.every((permission) => test(permission));
}

export function mergePermissions(parts: readonly (readonly string[])[]): ReadonlySet<string> {
  return new Set(parts.flat());
}