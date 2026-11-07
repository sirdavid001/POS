import { Resend } from 'resend';
import config from '../../config/index.js';
import { query } from '../../config/database.js';
import { renderEmailDetails, renderQuickPosEmail } from '../email/template.js';

export function buildSupportNotification({ heading, intro, details }) {
  const textDetails = details.map(([label, value]) => `${label}: ${value}`).join('\n');

  return {
    html: renderQuickPosEmail({
      title: heading,
      preheader: intro,
      intro,
      badge: 'Support notification',
      contentHtml: renderEmailDetails(details),
      supportEmail: config.email.replyTo,
      footerNote: 'This internal QuickPOS notification was sent only to the configured support address.',
    }),
    text: `${heading}\n\n${intro}\n\n${textDetails}`,
  };
}

async function sendSupportNotification({ storeId, type, key, subject, heading, intro, details }) {
  const to = config.email.supportCopyTo;
  if (!config.email.resendApiKey || !to) return { skipped: true };

  const claimed = await query(
    `INSERT INTO subscription_notifications (store_id, notification_type, notification_key)
     VALUES ($1, $2, $3)
     ON CONFLICT (store_id, notification_type, notification_key) DO NOTHING
     RETURNING id`,
    [storeId, type, String(key)]
  );
  if (!claimed.rows[0]) return { skipped: true, duplicate: true };

  const message = buildSupportNotification({ heading, intro, details });
  const resend = new Resend(config.email.resendApiKey);
  try {
    const { data, error } = await resend.emails.send({
      from: config.email.welcomeFrom,
      to: [to],
      replyTo: config.email.replyTo || undefined,
      subject,
      html: message.html,
      text: message.text,
    });
    if (error) throw new Error(error.message || 'Resend rejected the support notification');
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

export function sendRegistrationSupportNotification({
  storeId,
  storeName,
  ownerName,
  ownerEmail,
}) {
  return sendSupportNotification({
    storeId,
    type: 'support_registration_success',
    key: 'account_created',
    subject: `New QuickPOS registration — ${storeName}`,
    heading: 'New registration completed',
    intro: 'A new QuickPOS store and owner account were created successfully.',
    details: [
      ['Store', storeName],
      ['Owner', ownerName],
      ['Email', ownerEmail],
      ['Activation', 'Pending payment'],
    ],
  });
}

export function sendPaymentSupportNotification({
  storeId,
  storeName,
  customerEmail,
  provider,
  reference,
  planName,
  amount,
  paidThrough,
}) {
  return sendSupportNotification({
    storeId,
    type: 'support_payment_success',
    key: `${provider}:${reference}`,
    subject: `QuickPOS payment confirmed — ${storeName}`,
    heading: 'Payment confirmed and access activated',
    intro: 'QuickPOS verified this payment directly with the provider and activated the store.',
    details: [
      ['Store', storeName],
      ['Customer', customerEmail],
      ['Amount', amount],
      ['Plan', planName],
      ['Provider', provider],
      ['Access through', paidThrough],
      ['Reference', reference],
    ],
  });
}
