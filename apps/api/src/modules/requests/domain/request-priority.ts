import { RequestUrgency } from '@prisma/client';

/**
 * Pure emergency/priority rules (Phase 5 Step 6, ADR-021).
 *
 * Urgency changes operational ordering and audit/escalation metadata ONLY.
 * It never bypasses state machines, authorization, facility scope, compatibility
 * policy, expiry, quarantine, recall, reservation locking, or issuance validation.
 */
export const EMERGENCY_URGENCIES: ReadonlySet<RequestUrgency> = new Set([
  RequestUrgency.EMERGENCY,
  RequestUrgency.CRITICAL,
]);

const URGENCY_RANK: Record<RequestUrgency, number> = {
  [RequestUrgency.NORMAL]: 0,
  [RequestUrgency.URGENT]: 1,
  [RequestUrgency.EMERGENCY]: 2,
  [RequestUrgency.CRITICAL]: 3,
};

export function isEmergencyUrgency(urgency: RequestUrgency): boolean {
  return EMERGENCY_URGENCIES.has(urgency);
}

export function urgencyRank(urgency: RequestUrgency): number {
  return URGENCY_RANK[urgency];
}

export interface UrgencyState {
  urgency: RequestUrgency;
  emergencyEscalatedAt: Date | null;
}

export interface EscalationDecision {
  emergencyEscalatedAt: Date | null;
  /** True when the request becomes emergency/critical for the first time. */
  escalated: boolean;
  /** True when an emergency/critical request is downgraded to a non-emergency urgency. */
  deescalated: boolean;
}

/**
 * Resolves the persisted escalation timestamp without resetting it on repeat
 * updates. A downgrade clears the timestamp so the flag reflects current urgency.
 */
export function resolveEmergencyEscalation(
  nextUrgency: RequestUrgency,
  previous: UrgencyState | null,
  now: Date = new Date(),
): EscalationDecision {
  const previousWasEmergency = previous ? isEmergencyUrgency(previous.urgency) : false;

  if (!isEmergencyUrgency(nextUrgency)) {
    return {
      emergencyEscalatedAt: null,
      escalated: false,
      deescalated: previousWasEmergency,
    };
  }

  if (previousWasEmergency && previous?.emergencyEscalatedAt) {
    return {
      emergencyEscalatedAt: previous.emergencyEscalatedAt,
      escalated: false,
      deescalated: false,
    };
  }

  return { emergencyEscalatedAt: now, escalated: true, deescalated: false };
}

export interface PrioritySortable {
  urgency: RequestUrgency;
  requiredByAt: Date | null;
  createdAt: Date;
}

/**
 * Operational request queue ordering: highest urgency first, then earliest
 * required-by time (missing required-by sorts last), then oldest first.
 * Mirrors the repository's SQL/Prisma ordering so unit tests guard the contract.
 */
export function compareRequestPriority(a: PrioritySortable, b: PrioritySortable): number {
  const byUrgency = urgencyRank(b.urgency) - urgencyRank(a.urgency);
  if (byUrgency !== 0) return byUrgency;

  const aRequired = a.requiredByAt?.getTime() ?? Number.POSITIVE_INFINITY;
  const bRequired = b.requiredByAt?.getTime() ?? Number.POSITIVE_INFINITY;
  if (aRequired !== bRequired) return aRequired - bRequired;

  return a.createdAt.getTime() - b.createdAt.getTime();
}
