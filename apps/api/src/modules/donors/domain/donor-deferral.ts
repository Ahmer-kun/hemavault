export interface DeferralState {
  effectiveAt: Date;
  expiresAt: Date | null;
  resolvedAt: Date | null;
}

export function isDeferralActive(deferral: DeferralState, now = new Date()): boolean {
  if (deferral.resolvedAt) {
    return false;
  }
  if (now.getTime() < deferral.effectiveAt.getTime()) {
    return false;
  }
  if (deferral.expiresAt && now.getTime() > deferral.expiresAt.getTime()) {
    return false;
  }
  return true;
}