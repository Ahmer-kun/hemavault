export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');

export interface OutboundEmail {
  to: string;
  subject: string;
  body: string;
  tokenValue?: string;
  expiresAt: Date;
}

export interface EmailProvider {
  sendVerificationEmail(outbound: OutboundEmail): Promise<void>;
  sendPasswordResetEmail(outbound: OutboundEmail): Promise<void>;
}