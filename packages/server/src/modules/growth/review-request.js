import { Resend } from 'resend';
import config from '../../config/index.js';
import { query } from '../../config/database.js';
import logger from '../../config/logger.js';
import { renderQuickPosEmail } from '../email/template.js';

export const REVIEW_REQUEST_TYPE = 'review_request';
export const REVIEW_REQUEST_KEY = 'first';
const BATCH_LIMIT = 50;

// Review platforms (Google, Trustpilot, Capterra) forbid rewarding reviews and asking only
// happy customers, so this message goes once to every eligible paying store, never filtered
// by satisfaction, and never offers anything in return.
export function buildReviewRequest({ name, storeName, reviewUrl, supportEmail }) {
  const recipient = String(name || 'there').trim() || 'there';
  const store = String(storeName || 'your store').trim() || 'your store';
  const subject = `How is QuickPOS working for ${store}?`;
  const intro = `${store} has been using QuickPOS for a few weeks now. Store owners choosing POS software rely on honest reviews from businesses like yours. Whether your experience has been good or bad, would you take two minutes to share it?`;
  const note = 'Your review is public and written in your own words. We ask every active QuickPOS store once, and we never offer discounts or rewards for reviews.';
  const help = 'If something is not working the way you need, reply to this email and our support team will help.';

  return {
    subject,
    html: renderQuickPosEmail({
      title: `How is QuickPOS working for you, ${recipient}?`,
      preheader: `Share an honest review of QuickPOS for ${store}.`,
      intro,
      badge: 'Your feedback',
      contentHtml: `<div style="margin:22px 0 0;padding:15px 16px;border-left:3px solid #4f46e5;background:#f8fafc;color:#475569;font-size:14px;line-height:1.6;">${note}</div><p style="margin:18px 0 0;color:#475569;font-size:14px;line-height:1.6;">${help}</p>`,
      cta: { label: 'Write a review', url: reviewUrl },
      supportEmail,
      footerNote: 'We send this request once to each active QuickPOS store.',
    }),
    text: `Hi ${recipient},\n\n${intro}\n\nWrite a review: ${reviewUrl}\n\n${note}\n\n${help}\n\nSupport: ${supportEmail}`,
  };
}

export function reviewRequestEnabled(settings = config.growth) {
  try {
    return new URL(settings.reviewRequestUrl).protocol === 'https:';
  } catch {
    return false;
  }
}

async function sendOne(store, resend) {
  const claimed = await query(
    `INSERT INTO subscription_notifications (store_id, notification_type, notification_key)
     VALUES ($1, $2, $3)
     ON CONFLICT (store_id, notification_type, notification_key) DO NOTHING
     RETURNING id`,
    [store.store_id, REVIEW_REQUEST_TYPE, REVIEW_REQUEST_KEY]
  );
  if (!claimed.rows[0]) return false;

  const message = buildReviewRequest({
    name: store.owner_name,
    storeName: store.store_name,
    reviewUrl: config.growth.reviewRequestUrl,
    supportEmail: config.email.replyTo,
  });
  try {
    const { data, error } = await resend.emails.send({
      from: config.email.from,
      to: [store.email],
      replyTo: config.email.replyTo || undefined,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });
    if (error) throw new Error(error.message || 'Resend rejected the review request');
    await query(
      'UPDATE subscription_notifications SET provider_message_id = $1 WHERE id = $2',
      [data?.id || null, claimed.rows[0].id]
    );
    return true;
  } catch (error) {
    await query('DELETE FROM subscription_notifications WHERE id = $1', [claimed.rows[0].id]);
    throw error;
  }
}

// Sends the one-time review request to stores that have been paying customers for at least
// config.growth.reviewRequestDelayDays. Does nothing until REVIEW_REQUEST_URL is configured.
export async function sendReviewRequests() {
  if (!reviewRequestEnabled()) return { enabled: false, eligible: 0, sent: 0, failed: 0 };
  if (!config.email.resendApiKey) return { enabled: false, eligible: 0, sent: 0, failed: 0 };

  const result = await query(
    `SELECT s.id AS store_id, s.name AS store_name,
            COALESCE(s.email, owner.email) AS email, owner.name AS owner_name
     FROM stores s
     JOIN store_subscriptions ss ON ss.store_id = s.id
     LEFT JOIN LATERAL (
       SELECT MIN(COALESCE(bt.paid_at, bt.created_at)) AS first_paid_at
       FROM billing_transactions bt
       WHERE bt.store_id = s.id AND bt.status = 'success'
     ) pay ON true
     LEFT JOIN LATERAL (
       SELECT u.email, u.name
       FROM users u JOIN roles r ON r.id = u.role_id
       WHERE u.store_id = s.id AND r.name = 'admin' AND u.is_active = true
       ORDER BY u.created_at LIMIT 1
     ) owner ON true
     WHERE ss.activation_fee_paid = true
       AND ss.status IN ('active', 'grandfathered')
       AND COALESCE(pay.first_paid_at, ss.created_at) <= NOW() - make_interval(days => $1)
       AND COALESCE(s.email, owner.email) IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM subscription_notifications sn
         WHERE sn.store_id = s.id
           AND sn.notification_type = $2
           AND sn.notification_key = $3
       )
     ORDER BY s.id
     LIMIT ${BATCH_LIMIT}`,
    [config.growth.reviewRequestDelayDays, REVIEW_REQUEST_TYPE, REVIEW_REQUEST_KEY]
  );

  const resend = new Resend(config.email.resendApiKey);
  let sent = 0;
  let failed = 0;
  for (const store of result.rows) {
    try {
      if (await sendOne(store, resend)) sent += 1;
    } catch (error) {
      failed += 1;
      logger.error('Review request email failed', { storeId: store.store_id, error: error.message });
    }
  }
  return { enabled: true, eligible: result.rows.length, sent, failed };
}
