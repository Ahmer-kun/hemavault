import { randomInt } from 'node:crypto';

export const PUBLIC_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const PUBLIC_CODE_LENGTH = 10;

function defaultRandom(max: number): number {
  return randomInt(max);
}

export function generatePublicCode(
  prefix: string,
  random: (max: number) => number = defaultRandom,
): string {
  const body = Array.from(
    { length: PUBLIC_CODE_LENGTH },
    () => PUBLIC_CODE_ALPHABET[random(PUBLIC_CODE_ALPHABET.length)],
  ).join('');
  return `${prefix}-${body}`;
}