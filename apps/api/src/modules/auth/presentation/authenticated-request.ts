import type { Request } from 'express';
import type { AuthenticatedSession } from '../infrastructure/session.service';
import type { ActorContext } from '../../rbac/domain/policy';

export { AuthenticatedSession };
export type { ActorContext };

export interface AuthenticatedRequest extends Request {
  authSession?: AuthenticatedSession;
  actor?: ActorContext;
  csrfViolation?: boolean;
}