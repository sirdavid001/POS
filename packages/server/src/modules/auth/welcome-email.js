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

function cleanText(value, fallback) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text || fallback;
}

export function buildWelcomeEmail({ name, storeName, appUrl, supportEmail }) {
  const recipientName = cleanText(name, 'there');
  const businessName = cleanText(storeName, 'your store');
  const safeName = escapeHtml(recipientName);
  const safeStoreName = escapeHtml(businessName);
  const safeAppUrl = escapeHtml(appUrl);
  const safeSupportEmail = escapeHtml(supportEmail);
  const subject = `Welcome to QuickPOS — ${businessName}`;
  const preview = `Your ${businessName} workspace is ready for sales, stock, staff, and reports.`;

  const html = `<!doctype html>
<html lang="en" dir="ltr">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${escapeHtml(subject)}</title>
  </head>
  <body style="margin:0;background:#f3f4f6;color:#172033;font-family:Arial,Helvetica,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(preview)}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#f3f4f6;">
      <tr>
        <td align="center" style="padding:28px 12px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid #e5e7eb;border-radius:18px;overflow:hidden;">
            <tr>
              <td style="padding:24px 28px;background:#111827;color:#ffffff;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                  <tr>
                    <td width="48" valign="middle">
                      <div style="width:40px;height:40px;line-height:40px;text-align:center;border-radius:12px;background:#4f46e5;color:#ffffff;font-size:20px;font-weight:800;">Q</div>
                    </td>
                    <td valign="middle" style="font-size:20px;font-weight:800;letter-spacing:-0.4px;">QuickPOS</td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:36px 28px 12px;">
                <p style="margin:0 0 12px;color:#4f46e5;font-size:13px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;">Welcome aboard</p>
                <h1 style="margin:0 0 18px;color:#111827;font-size:30px;line-height:1.2;letter-spacing:-0.7px;">Welcome to QuickPOS, ${safeName}</h1>
                <p style="margin:0;color:#4b5563;font-size:16px;line-height:1.65;">Your workspace for <strong style="color:#172033;">${safeStoreName}</strong> has been created. QuickPOS brings checkout, inventory, staff access, customers, and business reports into one clear system.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 28px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border:1px solid #dbe1ea;border-radius:14px;overflow:hidden;background:#f8fafc;">
                  <tr>
                    <td style="padding:14px 16px;background:#111827;color:#ffffff;font-size:14px;font-weight:700;">${safeStoreName} <span style="color:#9ca3af;font-weight:400;">· Dashboard</span></td>
                  </tr>
                  <tr>
                    <td style="padding:16px;">
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                        <tr>
                          <td style="padding:12px;border:1px solid #e5e7eb;border-radius:10px;background:#ffffff;">
                            <p style="margin:0 0 4px;color:#4f46e5;font-size:13px;font-weight:800;">SALES</p>
                            <p style="margin:0;color:#4b5563;font-size:14px;line-height:1.5;">Run fast checkout and keep every order organised.</p>
                          </td>
                        </tr>
                        <tr><td height="10" style="font-size:0;line-height:0;">&nbsp;</td></tr>
                        <tr>
                          <td style="padding:12px;border:1px solid #e5e7eb;border-radius:10px;background:#ffffff;">
                            <p style="margin:0 0 4px;color:#059669;font-size:13px;font-weight:800;">INVENTORY</p>
                            <p style="margin:0;color:#4b5563;font-size:14px;line-height:1.5;">Track products, stock levels, suppliers, and low-stock alerts.</p>
                          </td>
                        </tr>
                        <tr><td height="10" style="font-size:0;line-height:0;">&nbsp;</td></tr>
                        <tr>
                          <td style="padding:12px;border:1px solid #e5e7eb;border-radius:10px;background:#ffffff;">
                            <p style="margin:0 0 4px;color:#d97706;font-size:13px;font-weight:800;">STAFF &amp; REPORTS</p>
                            <p style="margin:0;color:#4b5563;font-size:14px;line-height:1.5;">Manage secure roles and understand performance from one dashboard.</p>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:10px 28px 30px;">
                <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                  <tr>
                    <td align="center" bgcolor="#4f46e5" style="border-radius:10px;">
                      <a href="${safeAppUrl}" style="display:inline-block;min-height:44px;line-height:44px;padding:0 22px;color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;">Open QuickPOS</a>
                    </td>
                  </tr>
                </table>
                <p style="margin:24px 0 0;color:#4b5563;font-size:15px;line-height:1.65;">Need help getting started? Reply to this email or contact <a href="mailto:${safeSupportEmail}" style="color:#4f46e5;font-weight:700;">${safeSupportEmail}</a>.</p>
                <p style="margin:20px 0 0;color:#172033;font-size:15px;line-height:1.65;">Warm regards,<br><strong>The QuickPOS Team</strong></p>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 28px;border-top:1px solid #e5e7eb;background:#f8fafc;color:#6b7280;font-size:12px;line-height:1.6;">This transactional email was sent because a QuickPOS store account was created for this address. QuickPOS is operated by SIRDAVID MULTI-TRADE LTD.</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = `Welcome to QuickPOS, ${recipientName}

Your workspace for ${businessName} has been created. QuickPOS brings checkout, inventory, staff access, customers, and business reports into one clear system.

Open QuickPOS: ${appUrl}

Need help getting started? Reply to this email or contact ${supportEmail}.

Warm regards,
The QuickPOS Team`;

  return { subject, html, text };
}

export async function sendWelcomeEmail({ storeId, to, name, storeName }) {
  if (!config.email.resendApiKey || !to) {
    return { skipped: true };
  }

  const claimed = await query(
    `INSERT INTO subscription_notifications (store_id, notification_type, notification_key)
     VALUES ($1, 'welcome', 'account_created')
     ON CONFLICT (store_id, notification_type, notification_key) DO NOTHING
     RETURNING id`,
    [storeId]
  );

  if (!claimed.rows[0]) {
    return { skipped: true, duplicate: true };
  }

  const supportEmail = config.email.supportCopyTo || config.email.replyTo;
  const message = buildWelcomeEmail({
    name,
    storeName,
    appUrl: config.email.appUrl,
    supportEmail,
  });
  const bcc = supportEmail && supportEmail.toLowerCase() !== to.toLowerCase()
    ? [supportEmail]
    : undefined;
  const resend = new Resend(config.email.resendApiKey);

  try {
    const { data, error } = await resend.emails.send({
      from: config.email.from,
      to: [to],
      bcc,
      replyTo: config.email.replyTo || undefined,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });

    if (error) {
      throw new Error(error.message || 'Resend rejected the welcome email');
    }

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
