import { HttpStatus } from '@nestjs/common';
import { AppHttpException } from '../../../common/errors/app-http.exception';

export function userNotFoundError(): AppHttpException {
  return new AppHttpException(
    HttpStatus.NOT_FOUND,
    'USER_NOT_FOUND',
    'The user does not exist.',
  );
}

export function roleNotFoundError(): AppHttpException {
  return new AppHttpException(
    HttpStatus.NOT_FOUND,
    'ROLE_NOT_FOUND',
    'The role does not exist.',
  );
}

export function invalidRoleScopeError(): AppHttpException {
  return new AppHttpException(
    HttpStatus.BAD_REQUEST,
    'INVALID_ROLE_SCOPE',
    'Only global-scoped roles can be assigned at the platform level.',
  );
}

export function roleAlreadyAssignedError(): AppHttpException {
  return new AppHttpException(
    HttpStatus.CONFLICT,
    'ROLE_ALREADY_ASSIGNED',
    'The user already holds this role.',
  );
}

export function roleAssignmentNotFoundError(): AppHttpException {
  return new AppHttpException(
    HttpStatus.NOT_FOUND,
    'ROLE_ASSIGNMENT_NOT_FOUND',
    'The role assignment does not exist.',
  );
}

export function lastSuperAdminError(): AppHttpException {
  return new AppHttpException(
    HttpStatus.CONFLICT,
    'LAST_SUPER_ADMIN',
    'The last platform super admin cannot be removed.',
  );
}