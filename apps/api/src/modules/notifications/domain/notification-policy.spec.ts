import { describe, expect, it } from 'vitest';
import { NotificationPriority, NotificationType } from '@prisma/client';
import {
  defaultPriorityFor,
  isPreferenceSuppressible,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_TYPES,
} from './notification-policy';

describe('notification policy', () => {
  it('classifies emergency notifications as critical', () => {
    expect(defaultPriorityFor(NotificationType.EMERGENCY_REQUEST)).toBe(
      NotificationPriority.CRITICAL,
    );
  });

  it('never suppresses critical notifications through preferences', () => {
    expect(isPreferenceSuppressible(NotificationPriority.CRITICAL)).toBe(false);
    expect(isPreferenceSuppressible(NotificationPriority.HIGH)).toBe(true);
    expect(isPreferenceSuppressible(NotificationPriority.NORMAL)).toBe(true);
    expect(isPreferenceSuppressible(NotificationPriority.LOW)).toBe(true);
  });

  it('assigns a priority to every notification type', () => {
    for (const type of NOTIFICATION_TYPES) {
      expect(defaultPriorityFor(type)).toBeTypeOf('string');
    }
  });

  it('allowlists only supported delivery channels', () => {
    expect([...NOTIFICATION_CHANNELS]).toEqual(['IN_APP', 'EMAIL', 'SMS']);
  });
});
