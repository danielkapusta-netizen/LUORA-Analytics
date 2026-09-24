import { describe, expect, it } from 'vitest';
import { decryptJson, encryptJson, hashPassword, verifyPassword } from '@/server/crypto';

describe('credential encryption', () => {
  it('round-trips JSON and uses a fresh IV each time', () => {
    const secret = { apiToken: 'abc', nested: { n: 1 } };
    const a = encryptJson(secret);
    const b = encryptJson(secret);
    expect(a).not.toBe(b);
    expect(a).not.toContain('abc');
    expect(decryptJson(a)).toEqual(secret);
  });

  it('rejects tampered ciphertext', () => {
    const [v, iv, tag, data] = encryptJson({ x: 1 }).split(':');
    const flipped = Buffer.from(data, 'base64');
    flipped[0] ^= 1;
    expect(() => decryptJson([v, iv, tag, flipped.toString('base64')].join(':'))).toThrow();
  });
});

describe('passwords', () => {
  it('verifies the right password only', async () => {
    const hash = await hashPassword('correct horse');
    expect(await verifyPassword('correct horse', hash)).toBe(true);
    expect(await verifyPassword('wrong', hash)).toBe(false);
    expect(await verifyPassword('x', 'garbage')).toBe(false);
  });
});
