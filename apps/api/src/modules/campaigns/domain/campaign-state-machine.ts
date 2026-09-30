import { CampaignStatus } from '@prisma/client';

export interface CampaignTransition {
  from: CampaignStatus;
  to: CampaignStatus;
}

export const CAMPAIGN_TRANSITIONS: readonly CampaignTransition[] = [
  { from: 'DRAFT', to: 'PUBLISHED' },
  { from: 'DRAFT', to: 'CANCELLED' },
  { from: 'PUBLISHED', to: 'CANCELLED' },
  { from: 'PUBLISHED', to: 'COMPLETED' },
];

export const TERMINAL_CAMPAIGN_STATUSES: readonly CampaignStatus[] = ['CANCELLED', 'COMPLETED'];

const ALLOWED_TARGETS = new Map<CampaignStatus, ReadonlySet<CampaignStatus>>();
for (const transition of CAMPAIGN_TRANSITIONS) {
  const targets = new Set(ALLOWED_TARGETS.get(transition.from));
  targets.add(transition.to);
  ALLOWED_TARGETS.set(transition.from, targets);
}

export function canTransitionCampaign(from: CampaignStatus, to: CampaignStatus): boolean {
  return ALLOWED_TARGETS.get(from)?.has(to) ?? false;
}

export function allowedCampaignTargets(status: CampaignStatus): readonly CampaignStatus[] {
  return ALLOWED_TARGETS.get(status) ? [...ALLOWED_TARGETS.get(status)!] : [];
}