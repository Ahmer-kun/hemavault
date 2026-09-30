export const DONATION_ACTIONS = {
  DONATION_CREATED: 'donation.created',
  DONATION_CHECKED_IN: 'donation.checked_in',
  DONATION_COLLECTED: 'donation.collected',
  DONATION_SCREENING_STARTED: 'donation.screening_started',
  DONATION_QUARANTINED: 'donation.quarantined',
  DONATION_REJECTED: 'donation.rejected',
  DONATION_RELEASED: 'donation.released',
} as const;

export const DONATION_PUBLIC_CODE_PREFIX = 'DN';