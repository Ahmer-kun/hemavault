import { HttpStatus } from '@nestjs/common';
import { AppHttpException } from '../../../common/errors/app-http.exception';

export function transferNotFoundError(): AppHttpException {
  return new AppHttpException(
    HttpStatus.NOT_FOUND,
    'TRANSFER_NOT_FOUND',
    'The requested resource could not be found.',
  );
}

export function transferFacilityNotFoundError(): AppHttpException {
  return new AppHttpException(
    HttpStatus.BAD_REQUEST,
    'TRANSFER_FACILITY_NOT_FOUND',
    'The source or destination facility does not exist or is not active.',
  );
}

export function transferSameFacilityError(): AppHttpException {
  return new AppHttpException(
    HttpStatus.BAD_REQUEST,
    'TRANSFER_SAME_FACILITY',
    'Source and destination facilities must differ.',
  );
}

export function transferOrganizationMismatchError(): AppHttpException {
  return new AppHttpException(
    HttpStatus.BAD_REQUEST,
    'TRANSFER_ORGANIZATION_MISMATCH',
    'Transfers are only permitted between facilities in the same organization.',
  );
}

export function transferItemsRequiredError(): AppHttpException {
  return new AppHttpException(
    HttpStatus.BAD_REQUEST,
    'TRANSFER_ITEMS_REQUIRED',
    'At least one inventory unit is required.',
  );
}

export function transferTooManyItemsError(max: number): AppHttpException {
  return new AppHttpException(
    HttpStatus.BAD_REQUEST,
    'TRANSFER_TOO_MANY_ITEMS',
    `A transfer may contain at most ${max} units.`,
    { max },
  );
}

export function transferDuplicateItemError(): AppHttpException {
  return new AppHttpException(
    HttpStatus.BAD_REQUEST,
    'DUPLICATE_TRANSFER_ITEM',
    'Each inventory unit may appear only once in a transfer.',
  );
}

export function transferItemIneligibleError(
  unitId: string,
  reason: string,
  details: Record<string, unknown> = {},
): AppHttpException {
  return new AppHttpException(
    HttpStatus.CONFLICT,
    'TRANSFER_UNIT_INELIGIBLE',
    'One or more units are not eligible for transfer.',
    { unitId, reason, ...details },
  );
}

export function transferInvalidTransitionError(from: string, to: string): AppHttpException {
  return new AppHttpException(
    HttpStatus.CONFLICT,
    'TRANSFER_INVALID_TRANSITION',
    `Transfer status ${from} cannot transition to ${to}.`,
    { from, to },
  );
}

export function transferTerminalStateError(status: string): AppHttpException {
  return new AppHttpException(
    HttpStatus.CONFLICT,
    'TRANSFER_TERMINAL_STATE',
    `Transfer status ${status} is terminal.`,
    { status },
  );
}

export function transferNotApprovableError(status: string): AppHttpException {
  return new AppHttpException(
    HttpStatus.CONFLICT,
    'TRANSFER_NOT_APPROVABLE',
    `Transfer status ${status} cannot be approved.`,
    { status },
  );
}

export function transferNotPackableError(status: string): AppHttpException {
  return new AppHttpException(
    HttpStatus.CONFLICT,
    'TRANSFER_NOT_PACKABLE',
    `Transfer status ${status} cannot be packed.`,
    { status },
  );
}

export function transferNotDispatchableError(status: string): AppHttpException {
  return new AppHttpException(
    HttpStatus.CONFLICT,
    'TRANSFER_NOT_DISPATCHABLE',
    `Transfer status ${status} cannot be dispatched.`,
    { status },
  );
}

export function transferNotReceivableError(status: string): AppHttpException {
  return new AppHttpException(
    HttpStatus.CONFLICT,
    'TRANSFER_NOT_RECEIVABLE',
    `Transfer status ${status} cannot be received.`,
    { status },
  );
}

export function transferNotCancellableError(status: string): AppHttpException {
  return new AppHttpException(
    HttpStatus.CONFLICT,
    'TRANSFER_NOT_CANCELLABLE',
    'Transfers can only be cancelled before dispatch; dispatched units require the documented exception/return workflow.',
    { status },
  );
}

export function transferNotRejectableError(status: string): AppHttpException {
  return new AppHttpException(
    HttpStatus.CONFLICT,
    'TRANSFER_NOT_REJECTABLE',
    `Transfer status ${status} cannot be rejected.`,
    { status },
  );
}

export function transferReasonRequiredError(kind: 'rejection' | 'cancellation'): AppHttpException {
  return new AppHttpException(
    HttpStatus.BAD_REQUEST,
    'TRANSFER_REASON_REQUIRED',
    `A ${kind} reason is required.`,
  );
}

export function transferIdempotencyConflictError(): AppHttpException {
  return new AppHttpException(
    HttpStatus.CONFLICT,
    'IDEMPOTENCY_KEY_CONFLICT',
    'The idempotency key was already used for a different transfer command.',
  );
}

export function transferUnitStateConflictError(unitId: string): AppHttpException {
  return new AppHttpException(
    HttpStatus.CONFLICT,
    'TRANSFER_UNIT_STATE_CONFLICT',
    'One or more transfer units changed state while the command was executing.',
    { unitId },
  );
}
