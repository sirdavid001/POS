import { Router } from 'express';
import { Resend } from 'resend';
import config from '../../config/index.js';
import logger from '../../config/logger.js';
import { validate } from '../../middleware/validate.js';
import { supportContactSchema } from './schema.js';

const router = Router();
const SUPPORT_EMAIL = 'support@quickpos.name.ng';

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildSupportMessage(body) {
  const rows = [
    ['Name', body.name],
    ['Email', body.email],
    ['Phone', body.phone || '-'],
    ['Store', body.store_name || '-'],
    ['Category', body.category],
    ['Priority', body.priority],
    ['Platform', body.platform],
    ['App version', body.app_version || '-'],
    ['Subject', body.subject],
  ];

  const text = [
    'New QuickPOS support request',
    '',
    ...rows.map(([label, value]) => `${label}: ${value}`),
    '',
    'Message:',
    body.message,
    '',
    'Reminder: never request passwords, card details, CVV, OTP, banking PIN, or full card numbers.',
  ].join('\n');

  const htmlRows = rows.map(([label, value]) => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-weight:700;">${escapeHtml(label)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${escapeHtml(value)}</td>
    </tr>
  `).join('');

  const html = `
    <div style="font-family:Inter,Segoe UI,Arial,sans-serif;color:#111827;line-height:1.6;">
      <h2 style="margin:0 0 12px;">New QuickPOS support request</h2>
      <table style="border-collapse:collapse;width:100%;max-width:720px;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
        ${htmlRows}
      </table>
      <h3 style="margin:22px 0 8px;">Message</h3>
      <div style="white-space:pre-wrap;padding:14px 16px;border:1px solid #e5e7eb;border-radius:12px;background:#f9fafb;">${escapeHtml(body.message)}</div>
      <p style="margin-top:18px;color:#6b7280;font-size:13px;">
        Security reminder: never request passwords, card details, CVV, OTP, banking PIN, or full card numbers.
      </p>
    </div>
  `;

  return { text, html };
}

router.post('/contact', validate(supportContactSchema), async (req, res, next) => {
  try {
    if (req.body.website) {
      return res.status(202).json({ message: 'Support request received.' });
    }

    const { html, text } = buildSupportMessage(req.body);
    const subject = `[QuickPOS Support] ${req.body.category}: ${req.body.subject}`;

    if (!config.email.resendApiKey || !config.email.from) {
      logger.warn('Support request email skipped because email delivery is not configured', {
        email: req.body.email,
        category: req.body.category,
      });
      return res.status(202).json({
        message: 'Email delivery is not configured. Please send the prepared request to support.',
        delivery: { skipped: true },
        fallback_email: SUPPORT_EMAIL,
      });
    }

    const resend = new Resend(config.email.resendApiKey);
    const result = await resend.emails.send({
      from: config.email.from,
      to: SUPPORT_EMAIL,
      replyTo: req.body.email,
      subject,
      html,
      text,
    });

    if (result.error) {
      throw new Error(result.error.message || 'Support email could not be sent');
    }

    logger.info('Support request sent', {
      category: req.body.category,
      priority: req.body.priority,
      email: req.body.email,
      providerMessageId: result.data?.id,
    });

    res.status(202).json({
      message: 'Support request sent. QuickPOS support will reply by email.',
      delivery: { id: result.data?.id },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
