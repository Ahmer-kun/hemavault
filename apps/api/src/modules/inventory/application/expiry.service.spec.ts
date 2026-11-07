import { describe, expect, it } from 'vitest';
import { UnitState } from '@prisma/client';
import { ExpiryService } from './expiry.service';

describe('ExpiryService', () => {
  it('classifies expired AVAILABLE units as EXPIRED (effective state)', () => {
    const service = new ExpiryService({} as any, {} as any);
    const effective = service.getEffectiveState({
      state: UnitState.AVAILABLE,
      expiresAt: new Date(Date.now() - 1000),
    });
    expect(effective).toBe(UnitState.EXPIRED);
    expect(service.isAllocatable({ state: UnitState.AVAILABLE, expiresAt: new Date(Date.now() - 1000) })).toBe(false);
  });

  it('keeps non-expired AVAILABLE units allocatable', () => {
    const service = new ExpiryService({} as any, {} as any);
    expect(service.isAllocatable({ state: UnitState.AVAILABLE, expiresAt: new Date(Date.now() + 86400000) })).toBe(true);
  });

  it('does not override terminal/non-allocatable states except expiry check scope', () => {
    const service = new ExpiryService({} as any, {} as any);
    expect(service.getEffectiveState({ state: UnitState.ISSUED, expiresAt: new Date(Date.now() - 1000) })).toBe(UnitState.ISSUED);
  });
});
