import { HttpStatus } from '@nestjs/common';
import { AppHttpException } from '../../../common/errors/app-http.exception';

export function facilityNotFoundError(): AppHttpException {
  return new AppHttpException(
    HttpStatus.NOT_FOUND,
    'FACILITY_NOT_FOUND',
    'The facility does not exist.',
  );
}

export function facilityCodeConflictError(): AppHttpException {
  return new AppHttpException(
    HttpStatus.CONFLICT,
    'FACILITY_CODE_EXISTS',
    'A facility with this code already exists.',
  );
}

export function organizationNotFoundError(): AppHttpException {
  return new AppHttpException(
    HttpStatus.NOT_FOUND,
    'ORGANIZATION_NOT_FOUND',
    'The organization does not exist.',
  );
}

export function organizationInactiveError(): AppHttpException {
  return new AppHttpException(
    HttpStatus.CONFLICT,
    'ORGANIZATION_INACTIVE',
    'Facilities cannot be created under an inactive organization.',
  );
}

export function targetUserNotFoundError(): AppHttpException {
  return new AppHttpException(
    HttpStatus.NOT_FOUND,
    'USER_NOT_FOUND',
    'The target user does not exist.',
  );
}

export function targetUserInactiveError(): AppHttpException {
  return new AppHttpException(
    HttpStatus.CONFLICT,
    'TARGET_USER_INACTIVE',
    'Memberships can only be assigned to active users.',
  );
}

export function invalidMembershipRoleError(role: string): AppHttpException {
  return new AppHttpException(
    HttpStatus.BAD_REQUEST,
    'INVALID_MEMBERSHIP_ROLE',
    `Role ${role} is not a facility-scoped role.`,
    { role },
  );
}

export function membershipConflictError(): AppHttpException {
  return new AppHttpException(
    HttpStatus.CONFLICT,
    'MEMBERSHIP_EXISTS',
    'The user already holds this role at the facility.',
  );
}

export function membershipNotFoundError(): AppHttpException {
  return new AppHttpException(
    HttpStatus.NOT_FOUND,
    'MEMBERSHIP_NOT_FOUND',
    'The membership does not exist.',
  );
}