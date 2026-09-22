import { HttpStatus } from '@nestjs/common';
import { AppHttpException } from '../../../common/errors/app-http.exception';

export function invalidCredentialsError(): AppHttpException {
  return new AppHttpException(
    HttpStatus.UNAUTHORIZED,
    'INVALID_CREDENTIALS',
    'Invalid email or password.',
  );
}

export function authenticationRequiredError(): AppHttpException {
  return new AppHttpException(
    HttpStatus.UNAUTHORIZED,
    'UNAUTHENTICATED',
    'Authentication is required.',
  );
}

export function csrfViolationError(): AppHttpException {
  return new AppHttpException(
    HttpStatus.FORBIDDEN,
    'CSRF_VIOLATION',
    'A valid anti-forgery token is required for this request.',
  );
}

export function verificationTokenInvalidError(): AppHttpException {
  return new AppHttpException(
    HttpStatus.BAD_REQUEST,
    'INVALID_VERIFICATION_TOKEN',
    'The verification token is invalid or has expired.',
  );
}

export function resetTokenInvalidError(): AppHttpException {
  return new AppHttpException(
    HttpStatus.BAD_REQUEST,
    'INVALID_RESET_TOKEN',
    'The password reset token is invalid or has expired.',
  );
}