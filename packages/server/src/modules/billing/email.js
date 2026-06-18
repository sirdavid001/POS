import { Resend } from 'resend';
import config from '../../config/index.js';
import { query } from '../../config/database.js';

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export async function sendBillingEmail({
  storeId,
  to,
  type,
  key,
  subject,
  heading,
  body,
}) {
  if (!config.email.resendApiKey || !to) {
    return { skipped: true };
  }

  const claimed = await query(
    `INSERT INTO subscription_notifications (store_id, notification_type, notification_key)
     VALUES ($1, $2, $3)
     ON CONFLICT (store_id, notification_type, notification_key) DO NOTHING
     RETURNING id`,
    [storeId, type, String(key)]
  );

  if (!claimed.rows[0]) {
    return { skipped: true, duplicate: true };
  }

  const resend = new Resend(config.email.resendApiKey);
  try {
    const result = await resend.emails.send({
      from: config.email.from,
      to,
      replyTo: config.email.replyTo,
      subject,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#172033">
          <h1 style="font-size:24px">${escapeHtml(heading)}</h1>
          <p style="line-height:1.65">${escapeHtml(body)}</p>
          <p style="line-height:1.65">Manage your plan in QuickPOS. For help, email
            <a href="mailto:support@quickpos.com.ng">support@quickpos.com.ng</a>.
          </p>
        </div>
      `,
    });

    const messageId = result.data?.id || result.id || null;
    await query(
      'UPDATE subscription_notifications SET provider_message_id = $1 WHERE id = $2',
      [messageId, claimed.rows[0].id]
    );
    return result.data || result;
  } catch (error) {
    await query('DELETE FROM subscription_notifications WHERE id = $1', [claimed.rows[0].id]);
    throw error;
  }
}
