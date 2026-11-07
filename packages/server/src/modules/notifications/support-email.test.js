import { describe, expect, test } from 'vitest';
import { buildSupportNotification } from './support-email.js';

describe('support notifications', () => {
  test('renders a concise internal notification and escapes customer data', () => {
    const message = buildSupportNotification({
      heading: 'New registration completed',
      intro: 'A store registered successfully.',
      details: [['Store', '<script>Example</script>']],
    });

    expect(message.html).not.toContain('<script>');
    expect(message.html).toContain('&lt;script&gt;Example&lt;/script&gt;');
    expect(message.text).toContain('Store: <script>Example</script>');
  });
});
