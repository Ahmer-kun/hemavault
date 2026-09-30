import { HttpStatus } from '@nestjs/common';
import { AppHttpException } from '../../../common/errors/app-http.exception';

export function donorNotFoundError(): AppHttpException {
  return new AppHttpException(
    HttpStatus.NOT_FOUND,
    'DONOR_NOT_FOUND',
    'The donor does not exist or is not visible in your scope.',
  );
}

export function donorReferenceNotFoundError(): AppHttpException {
  return new AppHttpException(
    HttpStatus.NOT_FOUND,
    'DONOR_REFERENCE_NOT_FOUND',
    'No donor matches this donor reference.',
  );
}

export function deferralActiveError(): AppHttpException {
  return new AppHttpException(
    HttpStatus.CONFLICT,
    'DEFERRAL_ACTIVE',
    'The donor has an active deferral and cannot donate.',
  );
}

export function deferralNotFoundError(): AppHttpException {
  return new AppHttpException(
    HttpStatus.NOT_FOUND,
    'DEFERRAL_NOT_FOUND',
    'The deferral does not exist.',
  );
}

export function deferralAlreadyResolvedError(): AppHttpException {
  return new AppHttpException(
    HttpStatus.CONFLICT,
    'DEFERRAL_ALREADY_RESOLVED',
    'The deferral has already been resolved.',
  );
}