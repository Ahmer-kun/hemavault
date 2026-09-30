import { DonationState } from '@prisma/client';

export interface DonationTransition {
  from: DonationState;
  to: DonationState;
}

export const DONATION_TRANSITIONS: readonly DonationTransition[] = [
  { from: 'SCHEDULED', to: 'CHECKED_IN' },
  { from: 'SCHEDULED', to: 'CANCELLED' },
  { from: 'CHECKED_IN', to: 'COLLECTED' },
  { from: 'COLLECTED', to: 'SCREENING' },
  { from: 'SCREENING', to: 'QUARANTINED' },
  { from: 'SCREENING', to: 'REJECTED' },
  { from: 'QUARANTINED', to: 'RELEASED' },
  { from: 'QUARANTINED', to: 'REJECTED' },
  { from: 'RELEASED', to: 'COMPLETED' },
];

export const TERMINAL_DONATION_STATES: readonly DonationState[] = [
  'REJECTED',
  'CANCELLED',
  'COMPLETED',
];

const ALLOWED_TARGETS = new Map<DonationState, ReadonlySet<DonationState>>();
for (const transition of DONATION_TRANSITIONS) {
  const targets = new Set(ALLOWED_TARGETS.get(transition.from));
  targets.add(transition.to);
  ALLOWED_TARGETS.set(transition.from, targets);
}

export function canTransitionDonation(from: DonationState, to: DonationState): boolean {
  return ALLOWED_TARGETS.get(from)?.has(to) ?? false;
}

export function allowedDonationTargets(state: DonationState): readonly DonationState[] {
  return ALLOWED_TARGETS.get(state) ? [...ALLOWED_TARGETS.get(state)!] : [];
}

export function isTerminalDonationState(state: DonationState): boolean {
  return TERMINAL_DONATION_STATES.includes(state);
}