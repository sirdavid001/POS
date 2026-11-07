import { Resend } from 'resend';
import config from '../../config/index.js';
import { renderQuickPosEmail } from '../email/template.js';

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
  const recipientName = String(name || 'there').trim() || 'there';
  const businessName = String(storeName || 'your store').trim() || 'your store';
  const intro = `We received a request to reset the password for ${businessName}. This secure link expires in ${expiresInMinutes} minutes.`;

  const result = await resend.emails.send({
    from: config.email.from,
    to,
    replyTo: config.email.replyTo,
    subject: 'Reset your QuickPOS password',
    html: renderQuickPosEmail({
      title: `Reset your password, ${recipientName}`,
      preheader: `Reset access to ${businessName}.`,
      intro,
      badge: 'Security',
      contentHtml: '<div style="margin:22px 0 0;padding:15px 16px;border-left:3px solid #d97706;background:#fffbeb;color:#475569;font-size:14px;line-height:1.6;">If you did not request this, ignore this email. Your password will not change.</div>',
      cta: { label: 'Reset password', url: resetUrl },
      supportEmail: config.email.replyTo,
      footerNote: 'For your security, QuickPOS will never ask for your password by email.',
    }),
    text: `Hello ${recipientName},\n\n${intro}\n\nReset password: ${resetUrl}\n\nIf you did not request this, ignore this email. Your password will not change.\n\nSupport: ${config.email.replyTo}`,
  });

  if (result.error) {
    throw new Error(result.error.message || 'Resend rejected the password reset email');
  }

  return result.data || result;
}
