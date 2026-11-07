import { send } from '@vercel/queue';

export const ACTIVATION_REMINDER_TOPIC = 'quickpos-activation-reminders';
export const ACTIVATION_REMINDER_DELAY_SECONDS = 24 * 60 * 60;
export const ACTIVATION_REMINDER_RETENTION_SECONDS = 2 * 24 * 60 * 60;

export function scheduleActivationReminder(
  storeId,
  { delaySeconds = ACTIVATION_REMINDER_DELAY_SECONDS, sendFn = send } = {}
) {
  return sendFn(
    ACTIVATION_REMINDER_TOPIC,
    { storeId },
    {
      delaySeconds,
      retentionSeconds: ACTIVATION_REMINDER_RETENTION_SECONDS,
      idempotencyKey: `activation-reminder-${storeId}`,
    }
  );
}
