import { HttpStatus } from '@nestjs/common';
import { AppHttpException } from '../../../common/errors/app-http.exception';

export function campaignNotFoundError(): AppHttpException {
  return new AppHttpException(
    HttpStatus.NOT_FOUND,
    'CAMPAIGN_NOT_FOUND',
    'The campaign does not exist or is not visible in your scope.',
  );
}

export function campaignInvalidStateError(): AppHttpException {
  return new AppHttpException(
    HttpStatus.CONFLICT,
    'INVALID_CAMPAIGN_STATE',
    'The campaign is not in a state that allows this transition.',
  );
}

export function campaignNotPublishedError(): AppHttpException {
  return new AppHttpException(
    HttpStatus.CONFLICT,
    'CAMPAIGN_NOT_PUBLISHED',
    'The campaign must be published before this action.',
  );
}

export function campaignWindowClosedError(): AppHttpException {
  return new AppHttpException(
    HttpStatus.CONFLICT,
    'CAMPAIGN_WINDOW_CLOSED',
    'The campaign is not open for this action right now.',
  );
}

export function campaignFullError(): AppHttpException {
  return new AppHttpException(
    HttpStatus.CONFLICT,
    'CAMPAIGN_FULL',
    'The campaign has reached its registration capacity.',
  );
}

export function duplicateRegistrationError(): AppHttpException {
  return new AppHttpException(
    HttpStatus.CONFLICT,
    'ALREADY_REGISTERED',
    'This donor is already registered for the campaign.',
  );
}

export function registrationNotFoundError(): AppHttpException {
  return new AppHttpException(
    HttpStatus.NOT_FOUND,
    'REGISTRATION_NOT_FOUND',
    'The registration does not exist or is not visible in your scope.',
  );
}

export function registrationAlreadyCheckedInError(): AppHttpException {
  return new AppHttpException(
    HttpStatus.CONFLICT,
    'REGISTRATION_ALREADY_CHECKED_IN',
    'A checked-in registration cannot be cancelled.',
  );
}

export function campaignTimeRangeInvalidError(): AppHttpException {
  return new AppHttpException(
    HttpStatus.BAD_REQUEST,
    'CAMPAIGN_TIME_RANGE_INVALID',
    'endsAt must be after startsAt.',
  );
}

export function campaignFacilityNotFoundError(): AppHttpException {
  return new AppHttpException(
    HttpStatus.NOT_FOUND,
    'FACILITY_NOT_FOUND',
    'The facility does not exist.',
  );
}

export function campaignFacilityInactiveError(): AppHttpException {
  return new AppHttpException(
    HttpStatus.CONFLICT,
    'FACILITY_NOT_ACTIVE',
    'Campaigns can only be created for active facilities.',
  );
}