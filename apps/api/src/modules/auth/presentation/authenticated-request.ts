import type { Request } from 'express';
import type { AuthenticatedSession } from '../infrastructure/session.service';

export { AuthenticatedSession };

export interface AuthenticatedRequest extends Request {
  authSession?: AuthenticatedSession;
  csrfViolation?: boolean;
}