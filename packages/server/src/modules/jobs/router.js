import { Router } from 'express';
import config from '../../config/index.js';
import { query } from '../../config/database.js';
import logger from '../../config/logger.js';
import { sendBillingEmail } from '../billing/email.js';

const router = Router();

function authorized(req) {
  const token = req.get('authorization')?.replace(/^Bearer\s+/i, '') || req.get('x-cron-secret');
  return Boolean(config.billing.cronSecret && token === config.billing.cronSecret);
}

async function runSubscriptionReminders(req, res, next) {
  if (!authorized(req)) {
    return res.status(401).json({ error: 'Invalid cron credentials' });
  }

  try {
    await query(
      `UPDATE store_subscriptions
       SET status = 'expired', updated_at = NOW()
       WHERE status <> 'grandfathered'
         AND (
           (status = 'trialing' AND trial_ends_at <= NOW())
           OR
           (status IN ('active', 'past_due', 'cancelled') AND current_period_end <= NOW())
         )`
    );

    const result = await query(
      `SELECT ss.store_id, ss.status, ss.trial_ends_at, ss.current_period_end,
              s.name AS store_name, COALESCE(s.email, owner.email) AS email
       FROM store_subscriptions ss
       JOIN stores s ON s.id = ss.store_id
       LEFT JOIN LATERAL (
         SELECT u.email
         FROM users u JOIN roles r ON r.id = u.role_id
         WHERE u.store_id = s.id AND r.name = 'admin' AND u.is_active = true
         ORDER BY u.created_at LIMIT 1
       ) owner ON true
       WHERE ss.status <> 'grandfathered'
         AND (
           ss.status = 'expired'
           OR ss.trial_ends_at::date IN (CURRENT_DATE + 3, CURRENT_DATE + 1)
           OR ss.current_period_end::date IN (CURRENT_DATE + 7, CURRENT_DATE + 1)
         )`
    );

    let sent = 0;
    for (const row of result.rows) {
      if (!row.email) continue;
      let message;
      if (row.status === 'expired') {
        message = {
          type: 'subscription_expired',
          key: row.current_period_end || row.trial_ends_at,
          subject: 'Your QuickPOS access is read-only',
          heading: 'Your QuickPOS plan has expired',
          body: 'You can still sign in, view and export reports, print, email statements, and renew. Renew your plan to record new sales or change business data.',
        };
      } else if (row.status === 'trialing') {
        const days = Math.max(1, Math.ceil((new Date(row.trial_ends_at) - Date.now()) / 86400000));
        message = {
          type: 'trial_reminder',
          key: `${row.trial_ends_at}:${days}`,
          subject: `Your existing QuickPOS trial ends in ${days} day${days === 1 ? '' : 's'}`,
          heading: 'Your existing trial is nearly complete',
          body: `Complete the ₦20,000 initial activation before ${new Date(row.trial_ends_at).toLocaleDateString('en-NG')} to unlock the next five months without interruption.`,
        };
      } else {
        const days = Math.max(1, Math.ceil((new Date(row.current_period_end) - Date.now()) / 86400000));
        message = {
          type: 'renewal_reminder',
          key: `${row.current_period_end}:${days}`,
          subject: `QuickPOS renews in ${days} day${days === 1 ? '' : 's'}`,
          heading: 'Your QuickPOS renewal is coming up',
          body: `Your current paid period ends on ${new Date(row.current_period_end).toLocaleDateString('en-NG')}.`,
        };
      }

      const delivery = await sendBillingEmail({
        storeId: row.store_id,
        to: row.email,
        ...message,
      });
      if (!delivery.skipped) sent += 1;
    }

    res.json({ processed: result.rows.length, sent });
  } catch (error) {
    logger.error('Subscription reminder job failed', { error: error.message });
    next(error);
  }
}

router.get('/subscription-reminders', runSubscriptionReminders);
router.post('/subscription-reminders', runSubscriptionReminders);

export default router;
