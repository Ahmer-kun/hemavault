import { ParseUUIDPipe } from '@nestjs/common';

/**
 * Shared pipe for path identifiers (Phase 5 Step 7 hardening).
 *
 * Without it, a malformed UUID reached Prisma and surfaced as an opaque
 * `500 INTERNAL_ERROR`. Rejecting malformed identifiers with `400 BAD_REQUEST`
 * keeps the API contract predictable and avoids leaking driver details.
 */
export const UUIDParamPipe = new ParseUUIDPipe();
