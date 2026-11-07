import { describe, expect, test, vi } from 'vitest';
import { buildActivationReminder } from './activation-reminder.js';
import {
  ACTIVATION_REMINDER_DELAY_SECONDS,
  ACTIVATION_REMINDER_RETENTION_SECONDS,
  ACTIVATION_REMINDER_TOPIC,
  scheduleActivationReminder,
} from './activation-reminder-queue.js';

describe('activation reminder queue', () => {
  test('queues a delayed, idempotent 24-hour reminder', async () => {
    const sendFn = vi.fn().mockResolvedValue({ messageId: 'message-1' });
    await scheduleActivationReminder(42, { sendFn });

    expect(sendFn).toHaveBeenCalledWith(
      ACTIVATION_REMINDER_TOPIC,
      { storeId: 42 },
      {
        delaySeconds: ACTIVATION_REMINDER_DELAY_SECONDS,
        retentionSeconds: ACTIVATION_REMINDER_RETENTION_SECONDS,
        idempotencyKey: 'activation-reminder-42',
      }
    );
    expect(ACTIVATION_REMINDER_DELAY_SECONDS).toBe(86400);
    expect(ACTIVATION_REMINDER_RETENTION_SECONDS).toBeGreaterThan(
      ACTIVATION_REMINDER_DELAY_SECONDS
    );
  });

  test('builds a professional activation email without support BCC content', () => {
    const message = buildActivationReminder({
      name: 'Store Owner',
      storeName: 'Example Store',
      activationUrl: 'https://quickpos.com.ng/account#billing',
      supportEmail: 'support@quickpos.com.ng',
    });

    expect(message.subject).toContain('Example Store');
    expect(message.html).toContain('Activate QuickPOS');
    expect(message.html).toContain('NGN or USD');
    expect(message.text).toContain('account#billing');
  });
});
