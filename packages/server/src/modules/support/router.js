import { Router } from 'express';
import { Resend } from 'resend';
import config from '../../config/index.js';
import logger from '../../config/logger.js';
import { validate } from '../../middleware/validate.js';
import { supportContactSchema } from './schema.js';
import { activeAnnouncements, storeChatRouter } from './chat.js';
import { authenticate } from '../../middleware/auth.js';
import {
  escapeEmailHtml,
  renderEmailDetails,
  renderQuickPosEmail,
} from '../email/template.js';

const router = Router();
const SUPPORT_EMAIL = 'support@quickpos.com.ng';

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

  const html = renderQuickPosEmail({
    title: 'New support request',
    preheader: `${body.category}: ${body.subject}`,
    intro: 'A customer submitted a support request through the QuickPOS website.',
    badge: 'Support inbox',
    contentHtml: `${renderEmailDetails(rows)}<div style="margin:22px 0 0;padding:15px 16px;border:1px solid #e2e8f0;border-radius:12px;background:#f8fafc;color:#334155;font-size:14px;line-height:1.65;white-space:pre-wrap;"><strong style="display:block;margin-bottom:6px;color:#111827;">Customer message</strong>${escapeEmailHtml(body.message)}</div>`,
    supportEmail: SUPPORT_EMAIL,
    footerNote: 'Security reminder: never request passwords, card details, CVV, OTP, banking PIN, or full card numbers.',
  });

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

router.use('/chat', storeChatRouter);
router.get('/announcements', authenticate, activeAnnouncements);

export default router;
