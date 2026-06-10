import { Resend } from 'resend';
import config from '../../config/index.js';

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export async function sendPasswordResetEmail({
  to,
  name,
  storeName,
  resetUrl,
  expiresInMinutes,
}) {
  if (!config.email.resendApiKey || !to) {
    return { skipped: true };
  }

  const resend = new Resend(config.email.resendApiKey);
  const safeName = escapeHtml(name || 'there');
  const safeStoreName = escapeHtml(storeName || 'your store');
  const safeResetUrl = escapeHtml(resetUrl);

  const result = await resend.emails.send({
    from: config.email.from,
    to,
    replyTo: config.email.replyTo,
    subject: 'Reset your QuickPOS password',
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#172033">
        <h1 style="font-size:24px">Reset your QuickPOS password</h1>
        <p style="line-height:1.65">Hello ${safeName},</p>
        <p style="line-height:1.65">
          We received a request to reset the password for ${safeStoreName}.
          This secure link expires in ${expiresInMinutes} minutes.
        </p>
        <p style="margin:28px 0">
          <a href="${safeResetUrl}" style="background:#4f46e5;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;display:inline-block">
            Reset password
          </a>
        </p>
        <p style="line-height:1.65">
          If you did not request this, you can ignore this email. Your password will not change.
        </p>
        <p style="line-height:1.65">
          For help, email <a href="mailto:support@quickpos.name.ng">support@quickpos.name.ng</a>.
        </p>
      </div>
    `,
  });

  if (result.error) {
    throw new Error(result.error.message || 'Resend rejected the password reset email');
  }

  return result.data || result;
}
