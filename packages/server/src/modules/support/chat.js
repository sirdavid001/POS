import { Router } from 'express';
import { Resend } from 'resend';
import { z } from 'zod';
import config from '../../config/index.js';
import logger from '../../config/logger.js';
import { getClient, query } from '../../config/database.js';
import { authenticate } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { escapeEmailHtml, renderQuickPosEmail } from '../email/template.js';

// Live support chat, store side. Polling keeps it "live" on serverless hosting.
// Chat works even when a subscription has lapsed, so stores can always reach us.

export const SUPPORT_INBOX_EMAIL = 'support@quickpos.com.ng';
const MESSAGES_PER_MINUTE = 12;

export function isMissingTable(error) {
  return error?.code === '42P01';
}

export function migrationRequired(res, feature = 'This feature') {
  return res.status(503).json({
    error: `${feature} needs a database update before it can be used.`,
    code: 'MIGRATION_REQUIRED',
  });
}

export function previewOf(body) {
  const text = String(body || '').replace(/\s+/g, ' ').trim();
  return text.length > 157 ? `${text.slice(0, 157)}…` : text;
}

export function serializeMessage(row) {
  return {
    id: Number(row.id),
    conversation_id: Number(row.conversation_id),
    sender_type: row.sender_type,
    sender_name: row.sender_type === 'admin'
      ? 'QuickPOS support'
      : row.sender_type === 'system' ? 'QuickPOS' : (row.sender_name || 'Store'),
    body: row.body,
    created_at: row.created_at,
  };
}

export function serializeConversation(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    store_id: row.store_id,
    status: row.status,
    started_by: row.started_by,
    last_message_at: row.last_message_at,
    last_message_preview: row.last_message_preview,
    last_sender: row.last_sender,
    store_last_read_at: row.store_last_read_at,
    admin_last_read_at: row.admin_last_read_at,
    closed_at: row.closed_at,
    created_at: row.created_at,
  };
}

export const MESSAGE_SELECT = `
  SELECT m.id, m.conversation_id, m.sender_type, m.body, m.created_at, u.name AS sender_name
  FROM support_messages m
  LEFT JOIN users u ON u.id = m.sender_user_id`;

async function currentConversation(storeId) {
  const result = await query(
    `SELECT * FROM support_conversations
     WHERE store_id = $1
     ORDER BY (status = 'open') DESC, last_message_at DESC
     LIMIT 1`,
    [storeId]
  );
  return result.rows[0] || null;
}

async function unreadForStore(conversation) {
  if (!conversation) return 0;
  const result = await query(
    `SELECT COUNT(*)::int AS count FROM support_messages
     WHERE conversation_id = $1 AND sender_type <> 'store'
       AND created_at > COALESCE($2::timestamptz, 'epoch'::timestamptz)`,
    [conversation.id, conversation.store_last_read_at]
  );
  return Number(result.rows[0]?.count || 0);
}

async function notifySupportOfNewChat({ storeName, userName, userEmail, body }) {
  if (!config.email.resendApiKey || !config.email.from) return;
  const resend = new Resend(config.email.resendApiKey);
  const intro = `${userName || 'A store user'} from ${storeName || 'a store'} started a live chat. Reply from the Inbox in QP Control.`;
  await resend.emails.send({
    from: config.email.from,
    to: SUPPORT_INBOX_EMAIL,
    replyTo: userEmail || undefined,
    subject: `[QuickPOS live chat] ${storeName || 'New chat'}`,
    html: renderQuickPosEmail({
      title: 'New live chat',
      preheader: previewOf(body),
      intro,
      badge: 'Live chat',
      contentHtml: `<div style="margin:22px 0 0;padding:15px 16px;border:1px solid #e2e8f0;border-radius:12px;background:#f8fafc;color:#334155;font-size:14px;line-height:1.65;white-space:pre-wrap;">${escapeEmailHtml(body)}</div>`,
      supportEmail: SUPPORT_INBOX_EMAIL,
    }),
    text: `${intro}\n\n${body}`,
  });
}

const messageSchema = z.object({
  body: z.object({ body: z.string().trim().min(1, 'Write a message first').max(4000) }),
});

const pollSchema = z.object({
  query: z.object({ after: z.coerce.number().int().min(0).optional() }).passthrough(),
});

export const storeChatRouter = Router();
storeChatRouter.use(authenticate);

storeChatRouter.get('/', validate(pollSchema), async (req, res, next) => {
  try {
    const conversation = await currentConversation(req.user.store_id);
    if (!conversation) return res.json({ conversation: null, messages: [], unread: 0 });
    const after = req.query.after;
    const messages = after
      ? await query(`${MESSAGE_SELECT} WHERE m.conversation_id = $1 AND m.id > $2 ORDER BY m.id LIMIT 200`, [conversation.id, after])
      : await query(`SELECT * FROM (${MESSAGE_SELECT} WHERE m.conversation_id = $1 ORDER BY m.id DESC LIMIT 100) recent ORDER BY id`, [conversation.id]);
    res.json({
      conversation: serializeConversation(conversation),
      messages: messages.rows.map(serializeMessage),
      unread: await unreadForStore(conversation),
    });
  } catch (error) {
    if (isMissingTable(error)) return migrationRequired(res, 'Live chat');
    next(error);
  }
});

storeChatRouter.get('/unread', async (req, res, next) => {
  try {
    const conversation = await currentConversation(req.user.store_id);
    res.json({ unread: await unreadForStore(conversation), status: conversation?.status || null });
  } catch (error) {
    if (isMissingTable(error)) return res.json({ unread: 0, status: null, available: false });
    next(error);
  }
});

storeChatRouter.post('/messages', validate(messageSchema), async (req, res, next) => {
  let client;
  try {
    client = await getClient();
  } catch (error) {
    return next(error);
  }
  try {
    await client.query('BEGIN');
    const recent = await client.query(
      `SELECT COUNT(*)::int AS count
       FROM support_messages m
       JOIN support_conversations c ON c.id = m.conversation_id
       WHERE c.store_id = $1 AND m.sender_type = 'store' AND m.created_at > NOW() - INTERVAL '1 minute'`,
      [req.user.store_id]
    );
    if (Number(recent.rows[0]?.count || 0) >= MESSAGES_PER_MINUTE) {
      await client.query('ROLLBACK');
      return res.status(429).json({ error: 'You are sending messages very quickly. Wait a moment and try again.' });
    }

    let conversation = (await client.query(
      `SELECT * FROM support_conversations WHERE store_id = $1 AND status = 'open' FOR UPDATE`,
      [req.user.store_id]
    )).rows[0];
    const isNew = !conversation;
    if (isNew) {
      conversation = (await client.query(
        `INSERT INTO support_conversations (store_id, started_by, started_by_user_id, status, last_sender)
         VALUES ($1, 'store', $2, 'open', 'store')
         RETURNING *`,
        [req.user.store_id, req.user.id]
      )).rows[0];
    }

    const message = (await client.query(
      `INSERT INTO support_messages (conversation_id, sender_type, sender_user_id, body)
       VALUES ($1, 'store', $2, $3)
       RETURNING id, conversation_id, sender_type, body, created_at`,
      [conversation.id, req.user.id, req.body.body]
    )).rows[0];
    conversation = (await client.query(
      `UPDATE support_conversations SET
         last_message_at = $2, last_message_preview = $3, last_sender = 'store',
         store_last_read_at = $2, updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [conversation.id, message.created_at, previewOf(req.body.body)]
    )).rows[0];
    await client.query('COMMIT');

    if (isNew) {
      const store = await query('SELECT name FROM stores WHERE id = $1', [req.user.store_id]).catch(() => ({ rows: [] }));
      notifySupportOfNewChat({
        storeName: store.rows[0]?.name,
        userName: req.user.name,
        userEmail: req.user.email,
        body: req.body.body,
      }).catch((error) => logger.warn('Live chat notification email failed', { error: error.message }));
    }

    res.status(201).json({
      conversation: serializeConversation(conversation),
      message: serializeMessage({ ...message, sender_name: req.user.name }),
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (isMissingTable(error)) return migrationRequired(res, 'Live chat');
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Your message crossed with another one. Send it again.' });
    }
    next(error);
  } finally {
    client.release();
  }
});

storeChatRouter.post('/read', async (req, res, next) => {
  try {
    await query(
      `UPDATE support_conversations SET store_last_read_at = NOW()
       WHERE id = (
         SELECT id FROM support_conversations WHERE store_id = $1
         ORDER BY (status = 'open') DESC, last_message_at DESC LIMIT 1
       )`,
      [req.user.store_id]
    );
    res.json({ unread: 0 });
  } catch (error) {
    if (isMissingTable(error)) return migrationRequired(res, 'Live chat');
    next(error);
  }
});

// Active announcements for the signed-in store.
export async function activeAnnouncements(req, res, next) {
  try {
    const result = await query(
      `SELECT id, title, body, level, starts_at, ends_at
       FROM platform_announcements
       WHERE starts_at <= NOW() AND (ends_at IS NULL OR ends_at > NOW())
       ORDER BY starts_at DESC
       LIMIT 5`
    );
    res.json({ announcements: result.rows.map((row) => ({ ...row, id: Number(row.id) })) });
  } catch (error) {
    if (isMissingTable(error)) return res.json({ announcements: [] });
    next(error);
  }
}
