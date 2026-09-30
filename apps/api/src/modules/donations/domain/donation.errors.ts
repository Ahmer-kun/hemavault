import { HttpStatus } from '@nestjs/common';
import { AppHttpException } from '../../../common/errors/app-http.exception';

export function donationNotFoundError(): AppHttpException {
  return new AppHttpException(
    HttpStatus.NOT_FOUND,
    'DONATION_NOT_FOUND',
    'The donation does not exist or is not visible in your scope.',
  );
}

export function invalidDonationStateError(): AppHttpException {
  return new AppHttpException(
    HttpStatus.CONFLICT,
    'INVALID_DONATION_STATE',
    'The donation is not in a state that allows this transition.',
  );
}

export function donationBloodGroupRequiredError(): AppHttpException {
  return new AppHttpException(
    HttpStatus.BAD_REQUEST,
    'BLOOD_GROUP_REQUIRED',
    'The verified blood group is required for this step.',
  );
}

export function donationVolumeRequiredError(): AppHttpException {
  return new AppHttpException(
    HttpStatus.BAD_REQUEST,
    'VOLUME_REQUIRED',
    'The collected volume is required for this step.',
  );
}

export function donationRejectReasonRequiredError(): AppHttpException {
  return new AppHttpException(
    HttpStatus.BAD_REQUEST,
    'REJECT_REASON_REQUIRED',
    'A reasonCode is required to reject a donation.',
  );
}

export function donationFacilityNotFoundError(): AppHttpException {
  return new AppHttpException(
    HttpStatus.NOT_FOUND,
    'FACILITY_NOT_FOUND',
    'The facility does not exist.',
  );
}

export function donationFacilityInactiveError(): AppHttpException {
  return new AppHttpException(
    HttpStatus.CONFLICT,
    'FACILITY_NOT_ACTIVE',
    'Donations can only be created at active facilities.',
  );
}