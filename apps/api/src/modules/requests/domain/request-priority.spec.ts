import { RequestUrgency } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  compareRequestPriority,
  isEmergencyUrgency,
  resolveEmergencyEscalation,
  urgencyRank,
} from './request-priority';

describe('request priority and emergency escalation rules', () => {
  it('classifies only EMERGENCY and CRITICAL as emergency urgency', () => {
    expect(isEmergencyUrgency(RequestUrgency.NORMAL)).toBe(false);
    expect(isEmergencyUrgency(RequestUrgency.URGENT)).toBe(false);
    expect(isEmergencyUrgency(RequestUrgency.EMERGENCY)).toBe(true);
    expect(isEmergencyUrgency(RequestUrgency.CRITICAL)).toBe(true);
  });

  it('ranks urgency from NORMAL to CRITICAL', () => {
    expect(urgencyRank(RequestUrgency.NORMAL)).toBeLessThan(urgencyRank(RequestUrgency.URGENT));
    expect(urgencyRank(RequestUrgency.URGENT)).toBeLessThan(urgencyRank(RequestUrgency.EMERGENCY));
    expect(urgencyRank(RequestUrgency.EMERGENCY)).toBeLessThan(urgencyRank(RequestUrgency.CRITICAL));
  });

  it('sets an escalation timestamp on create for emergency/critical only', () => {
    const now = new Date('2026-11-10T10:00:00.000Z');
    expect(resolveEmergencyEscalation(RequestUrgency.NORMAL, null, now)).toEqual({
      emergencyEscalatedAt: null,
      escalated: false,
      deescalated: false,
    });
    expect(resolveEmergencyEscalation(RequestUrgency.URGENT, null, now).emergencyEscalatedAt).toBeNull();
    expect(resolveEmergencyEscalation(RequestUrgency.EMERGENCY, null, now)).toEqual({
      emergencyEscalatedAt: now,
      escalated: true,
      deescalated: false,
    });
    expect(resolveEmergencyEscalation(RequestUrgency.CRITICAL, null, now)).toEqual({
      emergencyEscalatedAt: now,
      escalated: true,
      deescalated: false,
    });
  });

  it('does not reset the escalation timestamp or re-audit on repeat emergency updates', () => {
    const original = new Date('2026-11-10T09:00:00.000Z');
    const decision = resolveEmergencyEscalation(
      RequestUrgency.CRITICAL,
      { urgency: RequestUrgency.EMERGENCY, emergencyEscalatedAt: original },
      new Date('2026-11-10T10:00:00.000Z'),
    );
    expect(decision).toEqual({
      emergencyEscalatedAt: original,
      escalated: false,
      deescalated: false,
    });
  });

  it('escalates when a normal/urgent draft is raised to emergency/critical', () => {
    const now = new Date('2026-11-10T10:00:00.000Z');
    const decision = resolveEmergencyEscalation(
      RequestUrgency.CRITICAL,
      { urgency: RequestUrgency.URGENT, emergencyEscalatedAt: null },
      now,
    );
    expect(decision).toEqual({
      emergencyEscalatedAt: now,
      escalated: true,
      deescalated: false,
    });
  });

  it('clears escalation when an emergency request is downgraded', () => {
    const decision = resolveEmergencyEscalation(
      RequestUrgency.URGENT,
      { urgency: RequestUrgency.CRITICAL, emergencyEscalatedAt: new Date() },
      new Date('2026-11-10T10:00:00.000Z'),
    );
    expect(decision).toEqual({
      emergencyEscalatedAt: null,
      escalated: false,
      deescalated: true,
    });
  });

  it('orders the queue by urgency, then required-by (missing last), then age', () => {
    const base = new Date('2026-11-10T08:00:00.000Z');
    const rows = [
      {
        label: 'normal-no-deadline',
        urgency: RequestUrgency.NORMAL,
        requiredByAt: null,
        createdAt: new Date(base.getTime() + 1_000),
      },
      {
        label: 'urgent-deadline',
        urgency: RequestUrgency.URGENT,
        requiredByAt: new Date('2026-11-13T08:00:00.000Z'),
        createdAt: base,
      },
      {
        label: 'emergency-no-deadline',
        urgency: RequestUrgency.EMERGENCY,
        requiredByAt: null,
        createdAt: base,
      },
      {
        label: 'critical-later-deadline',
        urgency: RequestUrgency.CRITICAL,
        requiredByAt: new Date('2026-11-12T08:00:00.000Z'),
        createdAt: base,
      },
      {
        label: 'critical-earlier-deadline',
        urgency: RequestUrgency.CRITICAL,
        requiredByAt: new Date('2026-11-11T08:00:00.000Z'),
        createdAt: base,
      },
    ];

    const sorted = [...rows].sort(compareRequestPriority).map((row) => row.label);
    expect(sorted).toEqual([
      'critical-earlier-deadline',
      'critical-later-deadline',
      'emergency-no-deadline',
      'urgent-deadline',
      'normal-no-deadline',
    ]);
  });

  it('breaks exact priority ties by oldest request first', () => {
    const requiredByAt = new Date('2026-11-12T08:00:00.000Z');
    const older = {
      label: 'older',
      urgency: RequestUrgency.URGENT,
      requiredByAt,
      createdAt: new Date('2026-11-10T07:00:00.000Z'),
    };
    const newer = {
      label: 'newer',
      urgency: RequestUrgency.URGENT,
      requiredByAt,
      createdAt: new Date('2026-11-10T08:00:00.000Z'),
    };
    expect([newer, older].sort(compareRequestPriority).map((row) => row.label)).toEqual([
      'older',
      'newer',
    ]);
  });
});
