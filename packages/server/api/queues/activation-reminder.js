import { QueueClient } from '@vercel/queue';
import { sendActivationReminder } from '../../src/modules/auth/activation-reminder.js';

const queue = new QueueClient();

export default queue.handleNodeCallback(
  async (message) => {
    const storeId = Number(message?.storeId);
    if (!Number.isSafeInteger(storeId) || storeId < 1) {
      throw new Error('Activation reminder message requires a valid storeId');
    }
    await sendActivationReminder(storeId);
  },
  {
    visibilityTimeoutSeconds: 60,
    retry: (_error, metadata) => {
      if (metadata.deliveryCount >= 5) return { acknowledge: true };
      return { afterSeconds: Math.min(300, 30 * (2 ** metadata.deliveryCount)) };
    },
  }
);
