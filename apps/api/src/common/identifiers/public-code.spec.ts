import { describe, expect, it } from 'vitest';
import { generatePublicCode, PUBLIC_CODE_ALPHABET, PUBLIC_CODE_LENGTH } from './public-code';

describe('public code generator', () => {
  it('produces the prefixed, fixed-length format', () => {
    const code = generatePublicCode('D');
    expect(code).toMatch(/^D-[A-Z2-9]+$/);
    expect(code.slice(2).length).toBe(PUBLIC_CODE_LENGTH);
  });

  it('uses only non-ambiguous alphabet characters', () => {
    const code = generatePublicCode('DN');
    for (const char of code.slice(3)) {
      expect(Array.from(PUBLIC_CODE_ALPHABET)).toContain(char);
    }
  });

  it('respects an injected deterministic random source', () => {
    const code = generatePublicCode('D', () => 0);
    expect(code).toBe(`D-${PUBLIC_CODE_ALPHABET.charAt(0).repeat(PUBLIC_CODE_LENGTH)}`);
  });

  it('is practically collision free', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i += 1) {
      const code = generatePublicCode('D');
      expect(seen.has(code)).toBe(false);
      seen.add(code);
    }
  });
});