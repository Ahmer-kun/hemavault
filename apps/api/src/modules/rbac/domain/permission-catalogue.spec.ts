import { describe, expect, it } from 'vitest';
import {
  ALL_PERMISSION_CODES,
  PERMISSION_CATALOGUE,
  ROLE_DEFINITIONS,
  assertCatalogueIntegrity,
  facilityRoles,
  globalRoles,
  permissionCodesForRole,
} from './permission-catalogue';

describe('permission catalogue', () => {
  it('has no integrity problems', () => {
    expect(assertCatalogueIntegrity()).toEqual([]);
  });

  it('has unique permission codes', () => {
    expect(new Set(ALL_PERMISSION_CODES).size).toBe(PERMISSION_CATALOGUE.length);
  });

  it('defines every role exactly once', () => {
    const codes = ROLE_DEFINITIONS.map((role) => role.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('super admin covers the entire permission catalogue', () => {
    const superAdmin = permissionCodesForRole('PLATFORM_SUPER_ADMIN');
    expect([...superAdmin].sort()).toEqual([...ALL_PERMISSION_CODES].sort());
  });

  it('partitions roles into global and facility scopes without overlap', () => {
    const global = globalRoles();
    const facility = facilityRoles();
    expect([...global, ...facility].sort()).toEqual([...ROLE_DEFINITIONS.map((r) => r.code)].sort());
    expect(global.filter((code) => facility.includes(code))).toEqual([]);
    expect(global).toContain('PLATFORM_SUPER_ADMIN');
    expect(global).toContain('PLATFORM_ADMIN');
    expect(facility).toContain('FACILITY_MANAGER');
    expect(facility).toContain('LAB_STAFF');
    expect(facility).toContain('HOSPITAL_STAFF');
  });
});