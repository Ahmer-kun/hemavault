import { HttpStatus } from '@nestjs/common';
import { AppHttpException } from '../../../common/errors/app-http.exception';

export function requestNotFoundError(): AppHttpException {
  return new AppHttpException(
    HttpStatus.NOT_FOUND,
    'REQUEST_NOT_FOUND',
    'The requested resource could not be found.',
  );
}

export function requestFacilityNotFoundError(): AppHttpException {
  return new AppHttpException(
    HttpStatus.NOT_FOUND,
    'FACILITY_NOT_FOUND',
    'The requested facility could not be found.',
  );
}

export function invalidRequestTransitionError(from: string, to: string): AppHttpException {
  return new AppHttpException(
    HttpStatus.CONFLICT,
    'INVALID_REQUEST_TRANSITION',
    `Cannot transition request from ${from} to ${to}.`,
  );
}

export function requestTerminalStateError(status: string): AppHttpException {
  return new AppHttpException(
    HttpStatus.CONFLICT,
    'REQUEST_TERMINAL_STATE',
    `Request is in terminal state ${status}.`,
  );
}

export function requestMutableFieldsLockedError(): AppHttpException {
  return new AppHttpException(
    HttpStatus.CONFLICT,
    'REQUEST_MUTABLE_FIELDS_LOCKED',
    'Request can only be updated while in DRAFT status.',
  );
}

export function requestLinesRequiredError(): AppHttpException {
  return new AppHttpException(
    HttpStatus.BAD_REQUEST,
    'REQUEST_LINES_REQUIRED',
    'At least one request line is required.',
  );
}

export function requestRejectReasonRequiredError(): AppHttpException {
  return new AppHttpException(
    HttpStatus.BAD_REQUEST,
    'REQUEST_REJECT_REASON_REQUIRED',
    'A rejection reason is required.',
  );
}

export function requestQuantityInvalidError(): AppHttpException {
  return new AppHttpException(
    HttpStatus.BAD_REQUEST,
    'REQUEST_QUANTITY_INVALID',
    'Requested quantity must be a positive integer.',
  );
}

export function matchingPolicyUnavailableError(
  reason: string,
  details: Record<string, unknown> = {},
): AppHttpException {
  return new AppHttpException(
    HttpStatus.CONFLICT,
    'MATCHING_POLICY_UNAVAILABLE',
    'Inventory matching is unavailable because no approved active compatibility policy is available for production use. This system must not invent clinical compatibility rules.',
    { reason, ...details },
  );
}

export function matchingRuleSetAmbiguousError(details: Record<string, unknown> = {}): AppHttpException {
  return new AppHttpException(
    HttpStatus.CONFLICT,
    'MATCHING_POLICY_UNAVAILABLE',
    'Inventory matching cannot proceed because the compatibility policy selection is ambiguous.',
    { reason: 'AMBIGUOUS_RULE_SET', ...details },
  );
}
