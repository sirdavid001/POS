import { Router } from 'express';
import { z } from 'zod';
import { getClient, query } from '../../config/database.js';
import { validate } from '../../middleware/validate.js';
import {
  MESSAGE_SELECT,
  isMissingTable,
  migrationRequired,
  previewOf,
  serializeConversation,
  serializeMessage,
} from '../support/chat.js';

// Live chat, QuickPOS side. Mounted inside the platform router, so every route
// here already requires a signed-in platform admin.
const router = Router();

const idParams = z.object({ id: z.coerce.number().int().positive() });
const replySchema = z.object({
  params: idParams,
  body: z.object({ body: z.string().trim().min(1, 'Write a reply first').max(4000) }),
});
const statusSchema = z.object({
  params: idParams,
  body: z.object({ status: z.enum(['open', 'closed']) }),
});
const startSchema = z.object({
  params: idParams,
  body: z.object({ body: z.string().trim().min(1, 'Write a message first').max(4000) }),
});
const threadSchema = z.object({
  params: idParams,
  query: z.object({ after: z.coerce.number().int().min(0).optional() }).passthrough(),
});

const UNREAD_FOR_ADMIN = `(c.last_sender = 'store'
  AND (c.admin_last_read_at IS NULL OR c.last_message_at > c.admin_last_read_at))`;

function inboxRow(row) {
  return {
    ...serializeConversation(row),
    store_name: row.store_name,
    store_email: row.store_email,
    owner_name: row.owner_name,
    message_count: Number(row.message_count || 0),
    unread: Boolean(row.unread),
  };
}

router.get('/inbox/summary', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT COUNT(*) FILTER (WHERE c.status = 'open')::int AS open,
              COUNT(*) FILTER (WHERE ${UNREAD_FOR_ADMIN})::int AS unread
       FROM support_conversations c`
    );
    res.json({ open: result.rows[0]?.open || 0, unread: result.rows[0]?.unread || 0, available: true });
  } catch (error) {
    if (isMissingTable(error)) return res.json({ open: 0, unread: 0, available: false });
    next(error);
  }
});

router.get('/inbox', async (req, res, next) => {
  try {
    const status = ['open', 'closed', 'all'].includes(req.query.status) ? req.query.status : 'open';
    const search = String(req.query.search || '').trim().slice(0, 120);
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = 25;
    const params = [status, search];
    const where = `($1 = 'all' OR c.status = $1)
      AND ($2 = '' OR s.name ILIKE '%' || $2 || '%' OR s.email ILIKE '%' || $2 || '%')`;
    const [countResult, rowsResult] = await Promise.all([
      query(`SELECT COUNT(*)::int AS count FROM support_conversations c JOIN stores s ON s.id = c.store_id WHERE ${where}`, params),
      query(
        `SELECT c.*, s.name AS store_name, s.email AS store_email, owner.name AS owner_name,
                ${UNREAD_FOR_ADMIN} AS unread,
                (SELECT COUNT(*) FROM support_messages m WHERE m.conversation_id = c.id) AS message_count
         FROM support_conversations c
         JOIN stores s ON s.id = c.store_id
         LEFT JOIN LATERAL (
           SELECT u.name FROM users u JOIN roles r ON r.id = u.role_id
           WHERE u.store_id = s.id ORDER BY (r.name = 'admin') DESC, u.created_at LIMIT 1
         ) owner ON true
         WHERE ${where}
         ORDER BY ${UNREAD_FOR_ADMIN} DESC, c.last_message_at DESC
         LIMIT $3 OFFSET $4`,
        [...params, limit, (page - 1) * limit]
      ),
    ]);
    res.json({
      conversations: rowsResult.rows.map(inboxRow),
      pagination: { page, limit, total: Number(countResult.rows[0]?.count || 0) },
    });
  } catch (error) {
    if (isMissingTable(error)) return migrationRequired(res, 'Live chat');
    next(error);
  }
});

router.get('/inbox/:id', validate(threadSchema), async (req, res, next) => {
  try {
    const conversationResult = await query(
      `UPDATE support_conversations c SET admin_last_read_at = NOW()
       FROM stores s
       WHERE c.id = $1 AND s.id = c.store_id
       RETURNING c.*, s.name AS store_name, s.email AS store_email, s.phone AS store_phone`,
      [req.params.id]
    );
    const conversation = conversationResult.rows[0];
    if (!conversation) return res.status(404).json({ error: 'Conversation not found' });
    const after = req.query.after;
    const [messages, store] = await Promise.all([
      after
        ? query(`${MESSAGE_SELECT} WHERE m.conversation_id = $1 AND m.id > $2 ORDER BY m.id LIMIT 200`, [conversation.id, after])
        : query(`SELECT * FROM (${MESSAGE_SELECT} WHERE m.conversation_id = $1 ORDER BY m.id DESC LIMIT 200) recent ORDER BY id`, [conversation.id]),
      after ? Promise.resolve({ rows: [] }) : query(
        `SELECT ss.status AS subscription_status, ss.current_period_end, ss.activation_fee_paid,
                owner.name AS owner_name, owner.email AS owner_email, owner.phone AS owner_phone
         FROM stores s
         LEFT JOIN store_subscriptions ss ON ss.store_id = s.id
         LEFT JOIN LATERAL (
           SELECT u.name, u.email, u.phone FROM users u JOIN roles r ON r.id = u.role_id
           WHERE u.store_id = s.id ORDER BY (r.name = 'admin') DESC, u.created_at LIMIT 1
         ) owner ON true
         WHERE s.id = $1`,
        [conversation.store_id]
      ),
    ]);
    // Admin replies are shown with the admin's own name inside the console.
    const rows = messages.rows.map((row) => ({
      ...serializeMessage(row),
      sender_name: row.sender_type === 'admin' ? (row.sender_name || 'QuickPOS support') : serializeMessage(row).sender_name,
    }));
    res.json({
      conversation: {
        ...serializeConversation(conversation),
        store_name: conversation.store_name,
        store_email: conversation.store_email,
        store_phone: conversation.store_phone,
        ...(store.rows[0] || {}),
      },
      messages: rows,
    });
  } catch (error) {
    if (isMissingTable(error)) return migrationRequired(res, 'Live chat');
    next(error);
  }
});

async function addAdminMessage(client, conversation, req, body) {
  const message = (await client.query(
    `INSERT INTO support_messages (conversation_id, sender_type, sender_user_id, body)
     VALUES ($1, 'admin', $2, $3)
     RETURNING id, conversation_id, sender_type, body, created_at`,
    [conversation.id, req.user.id, body]
  )).rows[0];
  const updated = (await client.query(
    `UPDATE support_conversations SET
       status = 'open', closed_at = NULL, closed_by_user_id = NULL,
       last_message_at = $2, last_message_preview = $3, last_sender = 'admin',
       admin_last_read_at = $2, updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [conversation.id, message.created_at, previewOf(body)]
  )).rows[0];
  return { message: { ...serializeMessage(message), sender_name: req.user.name || 'QuickPOS support' }, conversation: serializeConversation(updated) };
}

async function withClient(res, next, work) {
  let client;
  try {
    client = await getClient();
  } catch (error) {
    return next(error);
  }
  try {
    await client.query('BEGIN');
    const result = await work(client);
    if (result?.rollback) {
      await client.query('ROLLBACK');
      return res.status(result.status).json({ error: result.error });
    }
    await client.query('COMMIT');
    return res.status(result.status || 200).json(result.body);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (isMissingTable(error)) return migrationRequired(res, 'Live chat');
    if (error.code === '23505') {
      return res.status(409).json({ error: 'This store already has another open chat. Reply there instead.' });
    }
    return next(error);
  } finally {
    client.release();
  }
}

router.post('/inbox/:id/messages', validate(replySchema), (req, res, next) => withClient(res, next, async (client) => {
  const conversation = (await client.query('SELECT * FROM support_conversations WHERE id = $1 FOR UPDATE', [req.params.id])).rows[0];
  if (!conversation) return { rollback: true, status: 404, error: 'Conversation not found' };
  return { status: 201, body: await addAdminMessage(client, conversation, req, req.body.body) };
}));

router.patch('/inbox/:id', validate(statusSchema), (req, res, next) => withClient(res, next, async (client) => {
  const conversation = (await client.query('SELECT * FROM support_conversations WHERE id = $1 FOR UPDATE', [req.params.id])).rows[0];
  if (!conversation) return { rollback: true, status: 404, error: 'Conversation not found' };
  if (conversation.status === req.body.status) return { body: { conversation: serializeConversation(conversation) } };
  const closing = req.body.status === 'closed';
  const note = closing ? 'QuickPOS support closed this chat. Send a message any time to start a new one.' : 'QuickPOS support reopened this chat.';
  const message = (await client.query(
    `INSERT INTO support_messages (conversation_id, sender_type, sender_user_id, body)
     VALUES ($1, 'system', $2, $3)
     RETURNING id, conversation_id, sender_type, body, created_at`,
    [conversation.id, req.user.id, note]
  )).rows[0];
  const updated = (await client.query(
    `UPDATE support_conversations SET
       status = $2,
       closed_at = CASE WHEN $2 = 'closed' THEN NOW() ELSE NULL END,
       closed_by_user_id = CASE WHEN $2 = 'closed' THEN $3::int ELSE NULL END,
       last_message_at = $4, last_message_preview = $5, last_sender = 'system',
       admin_last_read_at = $4, updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [conversation.id, req.body.status, req.user.id, message.created_at, previewOf(note)]
  )).rows[0];
  return { body: { conversation: serializeConversation(updated), message: serializeMessage(message) } };
}));

// Start (or continue) a chat with a store from the store's account window.
router.post('/stores/:id/chat', validate(startSchema), (req, res, next) => withClient(res, next, async (client) => {
  const store = (await client.query('SELECT id FROM stores WHERE id = $1', [req.params.id])).rows[0];
  if (!store) return { rollback: true, status: 404, error: 'Store not found' };
  let conversation = (await client.query(
    `SELECT * FROM support_conversations WHERE store_id = $1 AND status = 'open' FOR UPDATE`,
    [store.id]
  )).rows[0];
  if (!conversation) {
    conversation = (await client.query(
      `INSERT INTO support_conversations (store_id, started_by, started_by_user_id, status, last_sender)
       VALUES ($1, 'admin', $2, 'open', 'admin')
       RETURNING *`,
      [store.id, req.user.id]
    )).rows[0];
  }
  return { status: 201, body: await addAdminMessage(client, conversation, req, req.body.body) };
}));

export default router;
