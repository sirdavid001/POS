import { Resend } from 'resend';
import config from '../../config/index.js';
import { query } from '../../config/database.js';
import { escapeEmailHtml, renderQuickPosEmail } from '../email/template.js';

function cleanText(value, fallback) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text || fallback;
}

export function buildWelcomeEmail({ name, storeName, appUrl, supportEmail }) {
  const recipientName = cleanText(name, 'there');
  const businessName = cleanText(storeName, 'your store');
  const safeStoreName = escapeEmailHtml(businessName);
  const subject = `Welcome to QuickPOS — ${businessName}`;
  const preview = `Your ${businessName} workspace is ready for sales, stock, staff, and reports.`;
  const contentHtml = `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;margin:24px 0 0;border:1px solid #e2e8f0;border-radius:14px;border-collapse:separate;overflow:hidden;background:#f8fafc;">
      <tr><td style="padding:13px 15px;background:#111827;color:#ffffff;font-size:14px;font-weight:800;">${safeStoreName} <span style="color:#94a3b8;font-weight:500;">· Dashboard</span></td></tr>
      <tr><td style="padding:15px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
          <tr><td style="padding:11px 12px;border-left:3px solid #4f46e5;background:#ffffff;color:#475569;font-size:14px;line-height:1.5;"><strong style="color:#111827;">Sales</strong><br>Run checkout and keep every order organised.</td></tr>
          <tr><td height="9" style="font-size:0;line-height:0;">&nbsp;</td></tr>
          <tr><td style="padding:11px 12px;border-left:3px solid #059669;background:#ffffff;color:#475569;font-size:14px;line-height:1.5;"><strong style="color:#111827;">Inventory</strong><br>Track products, suppliers, and low-stock alerts.</td></tr>
          <tr><td height="9" style="font-size:0;line-height:0;">&nbsp;</td></tr>
          <tr><td style="padding:11px 12px;border-left:3px solid #d97706;background:#ffffff;color:#475569;font-size:14px;line-height:1.5;"><strong style="color:#111827;">Staff and reports</strong><br>Manage secure roles and understand performance.</td></tr>
        </table>
      </td></tr>
    </table>`;
  const html = renderQuickPosEmail({
    title: `Welcome to QuickPOS, ${recipientName}`,
    preheader: preview,
    intro: `Your workspace for ${businessName} has been created. Everything you need to run sales and daily store operations is ready in one place.`,
    badge: 'Workspace ready',
    contentHtml,
    cta: { label: 'Open QuickPOS', url: appUrl },
    supportEmail,
    footerNote: 'This email was sent because a QuickPOS store account was created for this address.',
  });
  const text = `Welcome to QuickPOS, ${recipientName}

Your workspace for ${businessName} has been created. QuickPOS brings checkout, inventory, staff access, customers, and business reports into one clear system.

Open QuickPOS: ${appUrl}

Need help getting started? Reply to this email or contact ${supportEmail}.

Warm regards,
The QuickPOS Team`;

  return { subject, html, text };
}

export async function sendWelcomeEmail({ storeId, to, name, storeName, notificationKey = 'account_created' }) {
  if (!config.email.resendApiKey || !to) return { skipped: true };

  // The key de-duplicates sends: one automatic welcome per store, and manual
  // resends from the platform console use their own time-boxed key.
  const claimed = await query(
    `INSERT INTO subscription_notifications (store_id, notification_type, notification_key)
     VALUES ($1, 'welcome', $2)
     ON CONFLICT (store_id, notification_type, notification_key) DO NOTHING
     RETURNING id`,
    [storeId, notificationKey]
  );
  if (!claimed.rows[0]) return { skipped: true, duplicate: true };

  const supportEmail = config.email.supportCopyTo || config.email.replyTo;
  const message = buildWelcomeEmail({
    name,
    storeName,
    appUrl: config.email.appUrl,
    supportEmail,
  });
  const resend = new Resend(config.email.resendApiKey);

  try {
    const { data, error } = await resend.emails.send({
      from: config.email.welcomeFrom,
      to: [to],
      replyTo: config.email.replyTo || undefined,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });
    if (error) throw new Error(error.message || 'Resend rejected the welcome email');
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
