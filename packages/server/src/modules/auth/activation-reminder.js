import { Resend } from 'resend';
import config from '../../config/index.js';
import { query } from '../../config/database.js';
import { renderQuickPosEmail } from '../email/template.js';

export function buildActivationReminder({ name, storeName, activationUrl, supportEmail }) {
  const recipient = String(name || 'there').trim() || 'there';
  const store = String(storeName || 'your store').trim() || 'your store';
  const subject = `Finish activating QuickPOS — ${store}`;
  const intro = `Your QuickPOS workspace for ${store} is ready. Complete activation to unlock app downloads, sales, inventory updates, staff access, and reports.`;

  return {
    subject,
    html: renderQuickPosEmail({
      title: `Activate your store, ${recipient}`,
      preheader: `Complete activation for ${store} to unlock full QuickPOS access.`,
      intro,
      badge: 'Activation pending',
      contentHtml: '<div style="margin:22px 0 0;padding:15px 16px;border-left:3px solid #4f46e5;background:#f8fafc;color:#475569;font-size:14px;line-height:1.6;">Your billing page automatically shows the correct NGN or USD price for your location. Payment is verified before access is activated.</div>',
      cta: { label: 'Activate QuickPOS', url: activationUrl },
      supportEmail,
      footerNote: 'This reminder was sent because this QuickPOS store is still awaiting activation.',
    }),
    text: `Hi ${recipient},\n\n${intro}\n\nYour billing page automatically shows the correct NGN or USD price for your location. Payment is verified before access is activated.\n\nActivate QuickPOS: ${activationUrl}\n\nNeed help? Contact ${supportEmail}.`,
  };
}

export async function sendActivationReminder(storeId) {
  const result = await query(
    `SELECT s.id, s.name AS store_name, COALESCE(s.email, owner.email) AS email,
            owner.name AS owner_name, ss.activation_fee_paid, ss.status
     FROM stores s
     JOIN store_subscriptions ss ON ss.store_id = s.id
     LEFT JOIN LATERAL (
       SELECT u.email, u.name
       FROM users u JOIN roles r ON r.id = u.role_id
       WHERE u.store_id = s.id AND r.name = 'admin' AND u.is_active = true
       ORDER BY u.created_at LIMIT 1
     ) owner ON true
     WHERE s.id = $1`,
    [storeId]
  );
  const store = result.rows[0];
  if (!store || !store.email) return { skipped: true, reason: 'missing_recipient' };
  if (store.activation_fee_paid || !['pending_activation', 'trialing'].includes(store.status)) {
    return { skipped: true, reason: 'already_activated' };
  }
  if (!config.email.resendApiKey) return { skipped: true, reason: 'email_not_configured' };

  const claimed = await query(
    `INSERT INTO subscription_notifications (store_id, notification_type, notification_key)
     VALUES ($1, 'activation_reminder', 'registration_24h')
     ON CONFLICT (store_id, notification_type, notification_key) DO NOTHING
     RETURNING id`,
    [storeId]
  );
  if (!claimed.rows[0]) return { skipped: true, duplicate: true };

  const message = buildActivationReminder({
    name: store.owner_name,
    storeName: store.store_name,
    activationUrl: 'https://quickpos.com.ng/account#billing',
    supportEmail: config.email.replyTo,
  });
  const resend = new Resend(config.email.resendApiKey);
  try {
    const { data, error } = await resend.emails.send({
      from: config.email.welcomeFrom,
      to: [store.email],
      replyTo: config.email.replyTo || undefined,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });
    if (error) throw new Error(error.message || 'Resend rejected the activation reminder');
    await query(
      'UPDATE subscription_notifications SET provider_message_id = $1 WHERE id = $2',
      [data?.id || null, claimed.rows[0].id]
    );
    return data;
  } catch (error) {
    await query('DELETE FROM subscription_notifications WHERE id = $1', [claimed.rows[0].id]);
    throw error;
  }
}
