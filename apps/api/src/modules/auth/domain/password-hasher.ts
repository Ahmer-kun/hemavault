import { verify as argonVerify, hash as argonHash } from '@node-rs/argon2';
import { Injectable, Logger } from '@nestjs/common';

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, hash: string): Promise<boolean>;
}

const ARGON2_OPTIONS = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

@Injectable()
export class Argon2PasswordHasher implements PasswordHasher {
  private readonly logger = new Logger(Argon2PasswordHasher.name);

  async hash(password: string): Promise<string> {
    return argonHash(password, ARGON2_OPTIONS);
  }

  async verify(password: string, encoded: string): Promise<boolean> {
    try {
      return await argonVerify(encoded, password, ARGON2_OPTIONS);
    } catch (error) {
      this.logger.warn(
        `Password verification failed with malformed hash: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      return false;
    }
  }
}