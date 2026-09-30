import { describe, expect, it } from 'vitest';
import {
  ActorContext,
  canAnywhere,
  canAtFacility,
  canGlobally,
  emptyActor,
  evaluatePermissions,
  mergePermissions,
} from './policy';

function actor(global: string[], facility: Record<string, string[]>): ActorContext {
  const facilityPermissions = new Map<string, ReadonlySet<string>>();
  for (const [facilityId, permissions] of Object.entries(facility)) {
    facilityPermissions.set(facilityId, new Set(permissions));
  }
  return {
    userId: 'user-1',
    sessionId: 'session-1',
    globalPermissions: new Set(global),
    facilityPermissions,
  };
}

describe('policy engine', () => {
  it('empty actor denies everything', () => {
    const a = emptyActor();
    expect(canGlobally(a, 'inventory.read')).toBe(false);
    expect(canAnywhere(a, 'inventory.read')).toBe(false);
    expect(canAtFacility(a, 'facility-1', 'inventory.read')).toBe(false);
  });

  it('canGlobally only honors global role permissions', () => {
    const a = actor(['organization.read'], { 'facility-1': ['inventory.read'] });
    expect(canGlobally(a, 'organization.read')).toBe(true);
    expect(canGlobally(a, 'inventory.read')).toBe(false);
  });

  it('canAnywhere honors global or any facility permission', () => {
    const a = actor(['organization.read'], { 'facility-1': ['inventory.read'] });
    expect(canAnywhere(a, 'organization.read')).toBe(true);
    expect(canAnywhere(a, 'inventory.read')).toBe(true);
    expect(canAnywhere(a, 'donation.screen')).toBe(false);
  });

  it('canAtFacility is scoped to the requested facility', () => {
    const a = actor([], {
      'facility-1': ['inventory.read', 'facility.manage_members'],
      'facility-2': ['inventory.issue'],
    });
    expect(canAtFacility(a, 'facility-1', 'inventory.read')).toBe(true);
    expect(canAtFacility(a, 'facility-1', 'inventory.issue')).toBe(false);
    expect(canAtFacility(a, 'facility-2', 'inventory.issue')).toBe(true);
    expect(canAtFacility(a, 'facility-3', 'inventory.read')).toBe(false);
  });

  it('global permission satisfies a facility-scoped check', () => {
    const globalAdmin = actor(['inventory.issue'], {});
    expect(canAtFacility(globalAdmin, 'any-facility', 'inventory.issue')).toBe(true);
  });

  it('evaluatePermissions supports allOf (default) and anyOf', () => {
    const a = actor([], { 'facility-1': ['inventory.read', 'inventory.search'] });
    const atFacility = (p: string) => canAtFacility(a, 'facility-1', p);
    expect(evaluatePermissions(['inventory.read', 'inventory.search'], atFacility, false)).toBe(true);
    expect(evaluatePermissions(['inventory.read', 'donation.screen'], atFacility, false)).toBe(false);
    expect(evaluatePermissions(['inventory.read', 'donation.screen'], atFacility, true)).toBe(true);
    expect(evaluatePermissions([], atFacility, false)).toBe(true);
  });

  it('mergePermissions unions permission lists', () => {
    const merged = mergePermissions([['a'], ['b', 'a'], []]);
    expect([...merged].sort()).toEqual(['a', 'b']);
  });
});