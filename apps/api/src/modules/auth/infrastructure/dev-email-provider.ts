import { Injectable, Logger } from '@nestjs/common';
import { EmailProvider, OutboundEmail } from './email-provider';

@Injectable()
export class DevConsoleEmailProvider implements EmailProvider {
  private readonly logger = new Logger('EmailProvider');
  readonly outbox: OutboundEmail[] = [];

  private dispatch(outbound: OutboundEmail, kind: string): void {
    this.outbox.push(outbound);
    this.logger.log(
      `[${kind}] to=${outbound.to} subject="${outbound.subject}" token=${outbound.tokenValue ?? '<none>'} expiresAt=${outbound.expiresAt.toISOString()}`,
    );
  }

  async sendVerificationEmail(outbound: OutboundEmail): Promise<void> {
    this.dispatch(outbound, 'EMAIL_VERIFICATION');
  }

  async sendPasswordResetEmail(outbound: OutboundEmail): Promise<void> {
    this.dispatch(outbound, 'PASSWORD_RESET');
  }
}