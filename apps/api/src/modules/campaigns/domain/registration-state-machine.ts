import { RegistrationStatus } from '@prisma/client';

export interface RegistrationTransition {
  from: RegistrationStatus;
  to: RegistrationStatus;
}

export const REGISTRATION_TRANSITIONS: readonly RegistrationTransition[] = [
  { from: 'CONFIRMED', to: 'CHECKED_IN' },
  { from: 'CONFIRMED', to: 'CANCELLED' },
];

const ALLOWED_TARGETS = new Map<RegistrationStatus, ReadonlySet<RegistrationStatus>>();
for (const transition of REGISTRATION_TRANSITIONS) {
  const targets = new Set(ALLOWED_TARGETS.get(transition.from));
  targets.add(transition.to);
  ALLOWED_TARGETS.set(transition.from, targets);
}

export function canTransitionRegistration(from: RegistrationStatus, to: RegistrationStatus): boolean {
  return ALLOWED_TARGETS.get(from)?.has(to) ?? false;
}

export function allowedRegistrationTargets(status: RegistrationStatus): readonly RegistrationStatus[] {
  return ALLOWED_TARGETS.get(status) ? [...ALLOWED_TARGETS.get(status)!] : [];
}