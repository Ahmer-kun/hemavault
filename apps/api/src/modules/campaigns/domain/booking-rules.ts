import { CampaignStatus } from '@prisma/client';

export interface CampaignGateContext {
  status: CampaignStatus;
  capacity: number | null;
  startsAt: Date;
  endsAt: Date;
  registeredCount: number;
  alreadyRegistered: boolean;
  activeDeferral: boolean;
}

export type BookingDenialReason =
  | 'CAMPAIGN_NOT_PUBLISHED'
  | 'CAMPAIGN_FULL'
  | 'CAMPAIGN_WINDOW_CLOSED'
  | 'DEFERRAL_ACTIVE'
  | 'ALREADY_REGISTERED';

export type GateVerdict = { allowed: true } | { allowed: false; reason: BookingDenialReason };

export function canBookCampaignRegistration(context: CampaignGateContext, now: Date): GateVerdict {
  if (context.status !== 'PUBLISHED') {
    return { allowed: false, reason: 'CAMPAIGN_NOT_PUBLISHED' };
  }
  if (context.alreadyRegistered) {
    return { allowed: false, reason: 'ALREADY_REGISTERED' };
  }
  if (context.activeDeferral) {
    return { allowed: false, reason: 'DEFERRAL_ACTIVE' };
  }
  if (now.getTime() > context.endsAt.getTime()) {
    return { allowed: false, reason: 'CAMPAIGN_WINDOW_CLOSED' };
  }
  if (context.capacity !== null && context.registeredCount >= context.capacity) {
    return { allowed: false, reason: 'CAMPAIGN_FULL' };
  }
  return { allowed: true };
}

export function canCheckInToCampaign(context: CampaignGateContext, now: Date): GateVerdict {
  if (context.status !== 'PUBLISHED') {
    return { allowed: false, reason: 'CAMPAIGN_NOT_PUBLISHED' };
  }
  if (context.activeDeferral) {
    return { allowed: false, reason: 'DEFERRAL_ACTIVE' };
  }
  if (now.getTime() < context.startsAt.getTime() || now.getTime() > context.endsAt.getTime()) {
    return { allowed: false, reason: 'CAMPAIGN_WINDOW_CLOSED' };
  }
  return { allowed: true };
}