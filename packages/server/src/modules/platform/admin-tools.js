import { Router } from 'express';
import { z } from 'zod';
import config from '../../config/index.js';
import logger from '../../config/logger.js';
import { getClient, query } from '../../config/database.js';
import { validate } from '../../middleware/validate.js';
import { addMonths, getPlan } from '../billing/subscription.js';
import { sendBillingEmail } from '../billing/email.js';
import { activateVerifiedPayment, verifyProviderTransaction } from '../billing/router.js';
import { sendPasswordResetEmail } from '../auth/email.js';
import {
  buildPasswordResetUrl,
  createPasswordResetToken,
  hashPasswordResetToken,
} from '../auth/password-reset.js';
import { isMissingTable, migrationRequired } from '../support/chat.js';
import { writeAudit } from './audit.js';

// Platform admin tools: follow-up lists, search, store controls, announcements,
// the admin team, and system status. Mounted inside the platform router, so
// every route already requires a signed-in platform admin.
const router = Router();

const idParams = z.object({ id: z.coerce.number().int().positive() });
const reason = z.string().trim().min(3, 'Give a short reason').max(300);

const manualPaymentSchema = z.object({
  params: idParams,
  body: z.object({
    plan_code: z.string().trim().min(1).max(50),
    amount: z.coerce.number().min(0).max(100000000),
    currency: z.enum(['NGN', 'USD']).default('NGN'),
    reference: z.string().trim().min(3, 'Enter the bank or transfer reference').max(120),
    paid_at: z.string().trim().optional(),
    note: z.string().trim().max(300).optional(),
  }),
});
const permanentSchema = z.object({ params: idParams, body: z.object({ permanent: z.boolean(), reason }) });
const suspendSchema = z.object({ params: idParams, body: z.object({ suspended: z.boolean(), reason }) });
const announcementSchema = z.object({
  body: z.object({
    title: z.string().trim().min(3, 'Add a short title').max(120),
    body: z.string().trim().min(3, 'Write the announcement').max(600),
    level: z.enum(['info', 'warning', 'success']).default('info'),
    ends_at: z.string().trim().optional(),
  }),
});
const adminSchema = z.object({ body: z.object({ email: z.string().trim().email('Enter a valid email address').transform((v) => v.toLowerCase()) }) });

function storeRef(row) {
  return {
    store_id: row.store_id ?? row.id,
    store_name: row.store_name ?? row.name,
    owner_email: row.owner_email || row.email || null,
    date: row.date,
    detail: row.detail || null,
    ...(row.conversation_id ? { conversation_id: Number(row.conversation_id) } : {}),
  };
}

const OWNER_EMAIL = `(SELECT u.email FROM users u JOIN roles r ON r.id = u.role_id
  WHERE u.store_id = s.id ORDER BY (r.name = 'admin') DESC, u.created_at LIMIT 1)`;

async function attentionList(sql) {
  const result = await query(sql);
  return { count: Number(result.rows[0]?.total || 0), items: result.rows.map(storeRef) };
}

// Lists that need a follow-up from QuickPOS.
router.get('/attention', async (req, res, next) => {
  try {
    const lists = {
      renewals_due: `SELECT s.id, s.name, ${OWNER_EMAIL} AS owner_email, ss.current_period_end AS date, COUNT(*) OVER () AS total
        FROM stores s JOIN store_subscriptions ss ON ss.store_id = s.id
        WHERE ss.status IN ('active', 'past_due', 'cancelled')
          AND ss.current_period_end > NOW() AND ss.current_period_end <= NOW() + INTERVAL '7 days'
        ORDER BY ss.current_period_end LIMIT 6`,
      recently_expired: `SELECT s.id, s.name, ${OWNER_EMAIL} AS owner_email, ss.current_period_end AS date, COUNT(*) OVER () AS total
        FROM stores s JOIN store_subscriptions ss ON ss.store_id = s.id
        WHERE ss.status <> 'grandfathered' AND ss.activation_fee_paid = true
          AND ss.current_period_end <= NOW() AND ss.current_period_end > NOW() - INTERVAL '30 days'
        ORDER BY ss.current_period_end DESC LIMIT 6`,
      unpaid_signups: `SELECT s.id, s.name, ${OWNER_EMAIL} AS owner_email, s.created_at AS date, COUNT(*) OVER () AS total
        FROM stores s JOIN store_subscriptions ss ON ss.store_id = s.id
        WHERE ss.activation_fee_paid = false AND ss.status IN ('pending_activation', 'trialing')
          AND s.created_at <= NOW() - INTERVAL '2 days' AND s.created_at > NOW() - INTERVAL '60 days'
        ORDER BY s.created_at DESC LIMIT 6`,
      quiet_paid_stores: `SELECT s.id, s.name, ${OWNER_EMAIL} AS owner_email,
          (SELECT MAX(o.created_at) FROM orders o WHERE o.store_id = s.id) AS date, COUNT(*) OVER () AS total
        FROM stores s JOIN store_subscriptions ss ON ss.store_id = s.id
        WHERE ss.activation_fee_paid = true AND ss.status IN ('active', 'past_due', 'cancelled')
          AND ss.current_period_end > NOW()
          AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.store_id = s.id AND o.created_at >= NOW() - INTERVAL '14 days')
        ORDER BY date NULLS FIRST LIMIT 6`,
      stuck_payments: `SELECT bt.store_id, s.name AS store_name, ${OWNER_EMAIL} AS owner_email, bt.created_at AS date,
          bt.provider || ' · ' || bt.provider_reference AS detail, COUNT(*) OVER () AS total
        FROM billing_transactions bt JOIN stores s ON s.id = bt.store_id
        WHERE bt.status = 'initialized' AND bt.provider IN ('paystack', 'flutterwave')
          AND bt.created_at <= NOW() - INTERVAL '1 hour' AND bt.created_at > NOW() - INTERVAL '14 days'
        ORDER BY bt.created_at DESC LIMIT 6`,
    };
    const entries = await Promise.all(Object.entries(lists).map(async ([key, sql]) => [key, await attentionList(sql)]));
    const result = Object.fromEntries(entries);
    try {
      result.unanswered_chats = await attentionList(`SELECT c.id AS conversation_id, c.store_id, s.name AS store_name, ${OWNER_EMAIL} AS owner_email,
          c.last_message_at AS date, c.last_message_preview AS detail, COUNT(*) OVER () AS total
        FROM support_conversations c JOIN stores s ON s.id = c.store_id
        WHERE c.status = 'open' AND c.last_sender = 'store'
        ORDER BY c.last_message_at LIMIT 6`);
    } catch (error) {
      if (!isMissingTable(error)) throw error;
      result.unanswered_chats = { count: 0, items: [], available: false };
    }
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get('/search', async (req, res, next) => {
  try {
    const term = String(req.query.q || '').trim().slice(0, 120);
    if (term.length < 2) return res.json({ stores: [], people: [], payments: [] });
    const [stores, people, payments] = await Promise.all([
      query(
        `SELECT s.id, s.name, s.email, s.phone, s.created_at FROM stores s
         WHERE s.name ILIKE '%' || $1 || '%' OR s.email ILIKE '%' || $1 || '%' OR s.phone ILIKE '%' || $1 || '%'
         ORDER BY s.created_at DESC LIMIT 8`,
        [term]
      ),
      query(
        `SELECT u.id, u.name, u.email, u.phone, u.is_active, r.name AS role, u.store_id, s.name AS store_name
         FROM users u JOIN roles r ON r.id = u.role_id JOIN stores s ON s.id = u.store_id
         WHERE u.name ILIKE '%' || $1 || '%' OR u.email ILIKE '%' || $1 || '%' OR u.phone ILIKE '%' || $1 || '%'
         ORDER BY u.created_at DESC LIMIT 8`,
        [term]
      ),
      query(
        `SELECT bt.id, bt.store_id, s.name AS store_name, bt.provider, bt.provider_reference,
                bt.amount_ngn AS amount, bt.currency, bt.status, COALESCE(bt.paid_at, bt.created_at) AS date
         FROM billing_transactions bt JOIN stores s ON s.id = bt.store_id
         WHERE bt.provider_reference ILIKE '%' || $1 || '%' OR bt.provider_transaction_id ILIKE '%' || $1 || '%'
         ORDER BY bt.created_at DESC LIMIT 8`,
        [term]
      ),
    ]);
    res.json({ stores: stores.rows, people: people.rows, payments: payments.rows });
  } catch (error) {
    next(error);
  }
});

// Store usage, shown in the store window.
router.get('/stores/:id/usage', async (req, res, next) => {
  try {
    const storeId = Number(req.params.id);
    if (!Number.isSafeInteger(storeId) || storeId < 1) return res.status(400).json({ error: 'Invalid store' });
    const result = await query(
      `SELECT
         (SELECT COUNT(*) FROM products p WHERE p.store_id = $1 AND p.is_active = true)::int AS products,
         (SELECT COUNT(*) FROM customers c WHERE c.store_id = $1)::int AS customers,
         (SELECT COUNT(*) FROM users u WHERE u.store_id = $1)::int AS staff,
         (SELECT COUNT(*) FROM orders o WHERE o.store_id = $1 AND o.status = 'completed' AND o.created_at >= NOW() - INTERVAL '30 days')::int AS orders_30d,
         (SELECT COALESCE(SUM(o.total), 0) FROM orders o WHERE o.store_id = $1 AND o.status = 'completed' AND o.created_at >= NOW() - INTERVAL '30 days')::numeric AS sales_30d,
         (SELECT MAX(o.created_at) FROM orders o WHERE o.store_id = $1) AS last_order_at,
         (SELECT MAX(u.last_login) FROM users u WHERE u.store_id = $1) AS last_login_at,
         (SELECT currency FROM stores WHERE id = $1) AS currency`,
      [storeId]
    );
    const row = result.rows[0] || {};
    res.json({ usage: { ...row, sales_30d: Number(row.sales_30d || 0) } });
  } catch (error) {
    next(error);
  }
});

async function inTransaction(res, next, work) {
  let client;
  try {
    client = await getClient();
  } catch (error) {
    return next(error);
  }
  try {
    await client.query('BEGIN');
    const outcome = await work(client);
    if (outcome?.error) {
      await client.query('ROLLBACK');
      res.status(outcome.status || 400).json({ error: outcome.error });
      return null;
    }
    await client.query('COMMIT');
    return outcome;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error.code === '23505') {
      res.status(409).json({ error: 'That reference has already been recorded.' });
      return null;
    }
    next(error);
    return null;
  } finally {
    client.release();
  }
}

// Bank transfers and cash payments made outside Paystack and Flutterwave.
router.post('/stores/:id/manual-payment', validate(manualPaymentSchema), async (req, res, next) => {
  const plan = await getPlan(req.body.plan_code).catch((error) => { next(error); return undefined; });
  if (plan === undefined) return;
  if (!plan) return res.status(400).json({ error: 'Choose an active plan' });
  const paidAt = req.body.paid_at ? new Date(req.body.paid_at) : new Date();
  if (Number.isNaN(paidAt.getTime()) || paidAt.getTime() > Date.now() + 60_000) {
    return res.status(400).json({ error: 'Enter the date the payment was received (not in the future)' });
  }
  const amount = Math.round(req.body.amount);

  const outcome = await inTransaction(res, next, async (client) => {
    const current = (await client.query('SELECT * FROM store_subscriptions WHERE store_id = $1 FOR UPDATE', [req.params.id])).rows[0];
    if (!current) return { status: 404, error: 'This store has no subscription record yet' };
    if (plan.code === 'activation_5m' && current.activation_fee_paid) {
      return { status: 409, error: 'This store has already paid the activation fee. Record a renewal plan instead.' };
    }
    const now = new Date();
    const currentEnd = current.current_period_end ? new Date(current.current_period_end) : null;
    const periodStart = currentEnd && currentEnd > now ? currentEnd : now;
    const periodEnd = addMonths(periodStart, plan.duration_months);

    const transaction = (await client.query(
      `INSERT INTO billing_transactions
         (store_id, provider, provider_reference, plan_code, amount_ngn, currency, status, paid_at, metadata)
       VALUES ($1, 'manual', $2, $3, $4, $5, 'success', $6, $7)
       RETURNING id`,
      [req.params.id, req.body.reference, plan.code, amount, req.body.currency, paidAt,
        JSON.stringify({ recorded_by: req.user.id, note: req.body.note || null })]
    )).rows[0];
    // The provider fields are left alone so a card subscription keeps its link.
    const updated = (await client.query(
      `UPDATE store_subscriptions SET
         plan_code = $2,
         status = CASE WHEN status = 'grandfathered' THEN status ELSE 'active' END,
         current_period_start = $3,
         current_period_end = GREATEST(COALESCE(current_period_end, $4), $4),
         activation_fee_paid = activation_fee_paid OR $5,
         cancel_at_period_end = false,
         last_verified_at = NOW(),
         updated_at = NOW()
       WHERE store_id = $1
       RETURNING status, current_period_end`,
      [req.params.id, plan.code, periodStart, periodEnd, plan.code === 'activation_5m']
    )).rows[0];
    await client.query(
      `INSERT INTO audit_logs (store_id, entity_type, action, new_values)
       VALUES ($1, 'subscription', 'payment_recorded_manually', $2)`,
      [req.params.id, JSON.stringify({ reference: req.body.reference, plan_code: plan.code, amount, currency: req.body.currency, period_end: periodEnd })]
    );
    await writeAudit(client, req, {
      storeId: req.params.id,
      action: 'manual_payment_recorded',
      oldValues: { status: current.status, current_period_end: current.current_period_end },
      newValues: { plan_code: plan.code, plan_name: plan.name, amount, currency: req.body.currency, reference: req.body.reference, paid_at: paidAt, note: req.body.note || null, current_period_end: updated.current_period_end },
    });
    return { transactionId: Number(transaction.id), subscription: updated };
  });
  if (!outcome) return;

  const store = await query(
    `SELECT COALESCE(s.email, owner.email) AS email FROM stores s
     LEFT JOIN LATERAL (SELECT u.email FROM users u JOIN roles r ON r.id = u.role_id
       WHERE u.store_id = s.id AND r.name = 'admin' ORDER BY u.created_at LIMIT 1) owner ON true
     WHERE s.id = $1`,
    [req.params.id]
  ).catch(() => ({ rows: [] }));
  const amountLabel = new Intl.NumberFormat('en-NG', { style: 'currency', currency: req.body.currency, maximumFractionDigits: req.body.currency === 'NGN' ? 0 : 2 }).format(amount);
  sendBillingEmail({
    storeId: Number(req.params.id),
    to: store.rows[0]?.email,
    type: 'payment_success',
    key: `manual:${req.body.reference}`,
    subject: 'QuickPOS payment received',
    heading: 'Your QuickPOS access is active',
    body: `We received your ${amountLabel} payment for the ${plan.name} plan. Your access is paid through ${new Date(outcome.subscription.current_period_end).toLocaleDateString('en-NG')}.`,
  }).catch((error) => logger.warn('Manual payment receipt email failed', { error: error.message }));

  res.status(201).json({ payment_id: outcome.transactionId, subscription: outcome.subscription });
});

router.post('/stores/:id/permanent', validate(permanentSchema), async (req, res, next) => {
  const outcome = await inTransaction(res, next, async (client) => {
    const current = (await client.query('SELECT status, current_period_end FROM store_subscriptions WHERE store_id = $1 FOR UPDATE', [req.params.id])).rows[0];
    if (!current) return { status: 404, error: 'This store has no subscription record yet' };
    if ((current.status === 'grandfathered') === req.body.permanent) {
      return { status: 400, error: req.body.permanent ? 'This store already has permanent access' : 'This store does not have permanent access' };
    }
    const updated = (await client.query(
      `UPDATE store_subscriptions SET
         status = CASE
           WHEN $2 THEN 'grandfathered'
           WHEN current_period_end > NOW() THEN 'active'
           ELSE 'expired' END,
         updated_at = NOW()
       WHERE store_id = $1
       RETURNING status, current_period_end`,
      [req.params.id, req.body.permanent]
    )).rows[0];
    await writeAudit(client, req, {
      storeId: req.params.id,
      action: req.body.permanent ? 'permanent_access_granted' : 'permanent_access_removed',
      oldValues: { status: current.status },
      newValues: { status: updated.status, reason: req.body.reason },
    });
    return { subscription: updated };
  });
  if (outcome) res.json(outcome);
});

// Suspends every sign-in for a store, or restores the people a suspension disabled.
router.post('/stores/:id/suspend', validate(suspendSchema), async (req, res, next) => {
  const outcome = await inTransaction(res, next, async (client) => {
    const store = (await client.query('SELECT id FROM stores WHERE id = $1', [req.params.id])).rows[0];
    if (!store) return { status: 404, error: 'Store not found' };
    if (req.body.suspended) {
      const affected = (await client.query(
        `UPDATE users u SET is_active = false, updated_at = NOW()
         WHERE u.store_id = $1 AND u.is_active = true
           AND NOT EXISTS (SELECT 1 FROM platform_admins pa WHERE pa.user_id = u.id)
         RETURNING u.id`,
        [store.id]
      )).rows.map((row) => row.id);
      if (!affected.length) return { status: 400, error: 'Every sign-in for this store is already disabled' };
      await client.query('DELETE FROM refresh_tokens WHERE user_id = ANY($1::int[])', [affected]);
      await writeAudit(client, req, { storeId: store.id, action: 'store_suspended', oldValues: { user_ids: affected }, newValues: { reason: req.body.reason } });
      return { suspended: true, users: affected.length };
    }
    const last = (await client.query(
      `SELECT old_values FROM platform_audit_logs
       WHERE target_store_id = $1 AND action = 'store_suspended'
       ORDER BY created_at DESC LIMIT 1`,
      [store.id]
    )).rows[0];
    const ids = (last?.old_values?.user_ids || []).map(Number).filter(Number.isSafeInteger);
    if (!ids.length) return { status: 400, error: 'This store has no suspension to undo. Enable people one by one instead.' };
    const restored = (await client.query(
      `UPDATE users SET is_active = true, updated_at = NOW()
       WHERE store_id = $1 AND id = ANY($2::int[]) AND is_active = false
       RETURNING id`,
      [store.id, ids]
    )).rows.length;
    await writeAudit(client, req, { storeId: store.id, action: 'store_restored', newValues: { user_ids: ids, reason: req.body.reason } });
    return { suspended: false, users: restored };
  });
  if (outcome) res.json(outcome);
});

router.post('/users/:id/password-reset', async (req, res, next) => {
  try {
    const userId = Number(req.params.id);
    if (!Number.isSafeInteger(userId) || userId < 1) return res.status(400).json({ error: 'Invalid user' });
    const user = (await query(
      `SELECT u.id, u.email, u.name, u.store_id, u.is_active, s.name AS store_name,
              EXISTS(SELECT 1 FROM platform_admins pa WHERE pa.user_id = u.id) AS is_platform_admin
       FROM users u JOIN stores s ON s.id = u.store_id WHERE u.id = $1`,
      [userId]
    )).rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.is_platform_admin) return res.status(400).json({ error: 'Platform admins reset their own password from the sign-in page' });
    if (!user.is_active) return res.status(400).json({ error: 'Enable this person’s sign-in before sending a reset link' });
    if (!config.email.resendApiKey) return res.status(503).json({ error: 'Email sending is not set up on the server.' });

    const token = createPasswordResetToken();
    const expiresAt = new Date(Date.now() + config.auth.passwordResetExpiryMinutes * 60 * 1000);
    const outcome = await inTransaction(res, next, async (client) => {
      await client.query('UPDATE password_reset_tokens SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL', [user.id]);
      await client.query(
        `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, requested_ip, user_agent)
         VALUES ($1, $2, $3, $4, $5)`,
        [user.id, hashPasswordResetToken(token), expiresAt, req.ip || null, 'QP Control']
      );
      await writeAudit(client, req, { storeId: user.store_id, userId: user.id, action: 'password_reset_sent' });
      return { ok: true };
    });
    if (!outcome) return;
    await sendPasswordResetEmail({
      to: user.email,
      name: user.name,
      storeName: user.store_name,
      resetUrl: buildPasswordResetUrl(config.auth.passwordResetUrl, token),
      expiresInMinutes: config.auth.passwordResetExpiryMinutes,
    });
    res.json({ sent: true, email: user.email });
  } catch (error) {
    next(error);
  }
});

// Ask Paystack or Flutterwave whether a checkout that never finished was paid.
router.post('/payments/:id/verify', async (req, res, next) => {
  try {
    const paymentId = Number(req.params.id);
    if (!Number.isSafeInteger(paymentId) || paymentId < 1) return res.status(400).json({ error: 'Invalid payment' });
    const payment = (await query('SELECT * FROM billing_transactions WHERE id = $1', [paymentId])).rows[0];
    if (!payment) return res.status(404).json({ error: 'Payment not found' });
    if (payment.status !== 'initialized') return res.status(400).json({ error: 'Only payments still waiting at checkout can be checked' });
    if (!['paystack', 'flutterwave'].includes(payment.provider)) return res.status(400).json({ error: 'Only Paystack and Flutterwave payments can be checked' });
    let verified;
    try {
      verified = await verifyProviderTransaction(payment.provider, payment.provider_reference, payment.provider_transaction_id);
    } catch (error) {
      if (error.code === 'PAYMENT_NOT_COMPLETE') {
        return res.status(409).json({ error: `${payment.provider === 'paystack' ? 'Paystack' : 'Flutterwave'} says this payment was not completed.` });
      }
      throw error;
    }
    if (verified.reference !== payment.provider_reference) {
      return res.status(409).json({ error: 'The provider returned a different payment reference' });
    }
    await activateVerifiedPayment(payment.provider, verified);
    const updated = (await query('SELECT status FROM billing_transactions WHERE id = $1', [paymentId])).rows[0];
    await writeAudit({ query }, req, {
      storeId: payment.store_id,
      action: 'payment_checked',
      newValues: { provider: payment.provider, reference: payment.provider_reference, status: updated?.status },
    });
    res.json({ status: updated?.status || 'unknown' });
  } catch (error) {
    next(error);
  }
});

router.get('/announcements', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT a.*, u.name AS created_by_name,
              (a.starts_at <= NOW() AND (a.ends_at IS NULL OR a.ends_at > NOW())) AS is_live
       FROM platform_announcements a LEFT JOIN users u ON u.id = a.created_by_user_id
       ORDER BY a.created_at DESC LIMIT 50`
    );
    res.json({ announcements: result.rows.map((row) => ({ ...row, id: Number(row.id) })) });
  } catch (error) {
    if (isMissingTable(error)) return migrationRequired(res, 'Announcements');
    next(error);
  }
});

router.post('/announcements', validate(announcementSchema), async (req, res, next) => {
  try {
    const endsAt = req.body.ends_at ? new Date(req.body.ends_at) : null;
    if (endsAt && (Number.isNaN(endsAt.getTime()) || endsAt.getTime() <= Date.now())) {
      return res.status(400).json({ error: 'Choose an end date in the future, or leave it empty' });
    }
    const row = (await query(
      `INSERT INTO platform_announcements (title, body, level, ends_at, created_by_user_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.body.title, req.body.body, req.body.level, endsAt, req.user.id]
    )).rows[0];
    await writeAudit({ query }, req, { action: 'announcement_published', newValues: { id: Number(row.id), title: row.title, level: row.level, ends_at: row.ends_at } });
    res.status(201).json({ announcement: { ...row, id: Number(row.id), is_live: true } });
  } catch (error) {
    if (isMissingTable(error)) return migrationRequired(res, 'Announcements');
    next(error);
  }
});

router.post('/announcements/:id/end', async (req, res, next) => {
  try {
    const row = (await query(
      `UPDATE platform_announcements SET ends_at = NOW(), ended_by_user_id = $2, updated_at = NOW()
       WHERE id = $1 AND (ends_at IS NULL OR ends_at > NOW())
       RETURNING id, title`,
      [Number(req.params.id) || 0, req.user.id]
    )).rows[0];
    if (!row) return res.status(404).json({ error: 'This announcement is not live' });
    await writeAudit({ query }, req, { action: 'announcement_ended', newValues: { id: Number(row.id), title: row.title } });
    res.json({ ended: true });
  } catch (error) {
    if (isMissingTable(error)) return migrationRequired(res, 'Announcements');
    next(error);
  }
});

router.get('/admins', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT pa.user_id, pa.granted_at, u.name, u.email, u.is_active, u.last_login,
              s.name AS store_name, granter.name AS granted_by_name
       FROM platform_admins pa
       JOIN users u ON u.id = pa.user_id
       LEFT JOIN stores s ON s.id = u.store_id
       LEFT JOIN users granter ON granter.id = pa.granted_by_user_id
       ORDER BY pa.granted_at`
    );
    res.json({ admins: result.rows.map((row) => ({ ...row, is_you: row.user_id === req.user.id })) });
  } catch (error) {
    next(error);
  }
});

router.post('/admins', validate(adminSchema), async (req, res, next) => {
  try {
    const user = (await query('SELECT id, name, email, is_active FROM users WHERE LOWER(email) = $1', [req.body.email])).rows[0];
    if (!user) return res.status(404).json({ error: 'No QuickPOS account uses that email. The person must create an account first.' });
    if (!user.is_active) return res.status(400).json({ error: 'That account’s sign-in is disabled' });
    const inserted = (await query(
      `INSERT INTO platform_admins (user_id, granted_by_user_id) VALUES ($1, $2)
       ON CONFLICT (user_id) DO NOTHING RETURNING user_id`,
      [user.id, req.user.id]
    )).rows[0];
    if (!inserted) return res.status(409).json({ error: 'That person is already a platform admin' });
    await writeAudit({ query }, req, { userId: user.id, action: 'platform_admin_granted', newValues: { email: user.email } });
    res.status(201).json({ admin: { user_id: user.id, name: user.name, email: user.email } });
  } catch (error) {
    next(error);
  }
});

router.delete('/admins/:userId', async (req, res, next) => {
  const userId = Number(req.params.userId);
  if (!Number.isSafeInteger(userId) || userId < 1) return res.status(400).json({ error: 'Invalid user' });
  if (userId === req.user.id) return res.status(400).json({ error: 'You cannot remove your own platform access' });
  const outcome = await inTransaction(res, next, async (client) => {
    const admins = (await client.query('SELECT user_id FROM platform_admins FOR UPDATE')).rows.map((row) => row.user_id);
    if (!admins.includes(userId)) return { status: 404, error: 'That person is not a platform admin' };
    if (admins.length <= 1) return { status: 400, error: 'QuickPOS must keep at least one platform admin' };
    await client.query('DELETE FROM platform_admins WHERE user_id = $1', [userId]);
    await writeAudit(client, req, { userId, action: 'platform_admin_removed' });
    return { removed: true };
  });
  if (outcome) res.json(outcome);
});

router.get('/system', async (req, res, next) => {
  try {
    const started = Date.now();
    await query('SELECT 1');
    const latency = Date.now() - started;
    const [migrations, tables, plans] = await Promise.all([
      query('SELECT name, applied_at FROM schema_migrations ORDER BY name').catch(() => ({ rows: [] })),
      query(`SELECT to_regclass('public.support_conversations') IS NOT NULL AS live_chat,
                    to_regclass('public.platform_announcements') IS NOT NULL AS announcements`),
      query(
        `SELECT sp.code, sp.name, sp.price_ngn, sp.duration_months, sp.recurring, sp.is_active,
                COUNT(ss.id) FILTER (WHERE ss.status IN ('active', 'past_due', 'cancelled') AND ss.current_period_end > NOW())::int AS active_stores
         FROM subscription_plans sp LEFT JOIN store_subscriptions ss ON ss.plan_code = sp.code
         GROUP BY sp.code ORDER BY sp.is_active DESC, sp.price_ngn`
      ),
    ]);
    res.json({
      database: { ok: true, latency_ms: latency },
      features: tables.rows[0] || {},
      migrations: migrations.rows,
      email: { configured: Boolean(config.email.resendApiKey && config.email.from) },
      payments: {
        paystack: Boolean(config.paystack.secretKey),
        flutterwave: Boolean(config.flutterwave.secretKey),
      },
      scheduled_jobs: { configured: Boolean(config.billing.cronSecret) },
      version: process.env.VERCEL_GIT_COMMIT_SHA ? process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7) : null,
      environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'development',
      plans: plans.rows,
      server_time: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
});

export default router;
