import { describe, expect, test } from '@jest/globals';
import {
  buildPasswordResetUrl,
  createPasswordResetToken,
  hashPasswordResetToken,
} from './password-reset.js';

describe('password reset helpers', () => {
  test('creates unpredictable tokens and stores only a SHA-256 hash', () => {
    const token = createPasswordResetToken();
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(hashPasswordResetToken(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashPasswordResetToken(token)).not.toBe(token);
  });

  test('builds a reset link for the hash router', () => {
    expect(buildPasswordResetUrl('https://app.quickpos.test/#/reset-password', 'abc 123'))
      .toBe('https://app.quickpos.test/#/reset-password?token=abc%20123');
  });
});
