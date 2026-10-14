import { describe, expect, test } from 'vitest';
import { buildWelcomeEmail } from './welcome-email.js';

describe('welcome email template', () => {
  test('renders a branded, accessible HTML email and a plain-text alternative', () => {
    const message = buildWelcomeEmail({
      name: 'Rita Inyang',
      storeName: 'SWEET SKIN ESSENTIALS',
      appUrl: 'https://quickpos.com.ng/account#signin',
      supportEmail: 'support@quickpos.com.ng',
    });

    expect(message.subject).toBe('Welcome to QuickPOS — SWEET SKIN ESSENTIALS');
    expect(message.html).toContain('<html lang="en" dir="ltr">');
    expect(message.html).toContain('SWEET SKIN ESSENTIALS');
    expect(message.html).toContain('· Dashboard');
    expect(message.html).toContain('min-height:44px');
    expect(message.html).toContain('mailto:support@quickpos.com.ng');
    expect(message.text).toContain('Open QuickPOS: https://quickpos.com.ng/account#signin');
  });

  test('escapes customer-controlled content in the HTML version', () => {
    const message = buildWelcomeEmail({
      name: '<script>alert(1)</script>',
      storeName: 'A & B',
      appUrl: 'https://quickpos.com.ng/account#signin',
      supportEmail: 'support@quickpos.com.ng',
    });

    expect(message.html).not.toContain('<script>');
    expect(message.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(message.html).toContain('A &amp; B');
  });
});
