export const SESSION_COOKIE_NAME = 'blood_ops_session';
export const CSRF_COOKIE_NAME = 'blood_ops_csrf';
export const CSRF_HEADER_NAME = 'x-csrf-token';

export const AUTH_ACTIONS = {
  REGISTER: 'auth.register',
  EMAIL_VERIFIED: 'auth.email_verified',
  LOGIN_SUCCESS: 'auth.login_success',
  LOGIN_FAILED: 'auth.login_failed',
  LOGIN_BLOCKED: 'auth.login_blocked',
  LOGOUT: 'auth.logout',
  LOGOUT_ALL: 'auth.logout_all',
  FORGOT_PASSWORD: 'auth.forgot_password',
  PASSWORD_RESET: 'auth.password_reset',
  USER_STATUS_CHANGED: 'user.status_changed',
} as const;

export type AuthAction = (typeof AUTH_ACTIONS)[keyof typeof AUTH_ACTIONS];