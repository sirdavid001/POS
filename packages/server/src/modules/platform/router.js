import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requirePlatformAdmin } from '../../middleware/auth.js';
import { getClient, query } from '../../config/database.js';
import { validate } from '../../middleware/validate.js';
import { sendWelcomeEmail } from '../auth/welcome-email.js';
import { sendActivationReminder } from '../auth/activation-reminder.js';

const router = Router();

router.use(authenticate);
router.use(requirePlatformAdmin);

const accessSchema = z.object({
  body: z.object({ is_active: z.boolean() }),
});

const storeIdParams = z.object({ id: z.coerce.number().int().positive() });

const noteSchema = z.object({
  params: storeIdParams,
  body: z.object({ note: z.string().trim().min(1, 'Write a note first').max(1000) }),
});

const extendSchema = z.object({
  params: storeIdParams,
  body: z.object({
    days: z.coerce.number().int().min(1).max(366),
    reason: z.string().trim().min(3, 'Give a short reason').max(300),
  }),
});

const emailSchema = z.object({
  params: storeIdParams,
  body: z.object({ type: z.enum(['welcome', 'activation_reminder']) }),
});

const STORE_STATUSES = ['all', 'paid', 'pending', 'active', 'inactive'];
const PAYMENT_STATUSES = ['all', 'initialized', 'success', 'failed', 'paid_duplicate'];
const EXPORT_LIMIT = 5000;

function pageOptions(rawPage, rawLimit) {
  const page = Math.max(1, Number.parseInt(rawPage, 10) || 1);
  const limit = Math.min(50, Math.max(10, Number.parseInt(rawLimit, 10) || 20));
  return { page, limit, offset: (page - 1) * limit };
}

function searchTerm(value) {
  return String(value || '').trim().slice(0, 120);
}

function statusClause(status, paramIndex) {
  const clauses = {
    paid: `EXISTS (
      SELECT 1 FROM billing_transactions paid
      WHERE paid.store_id = s.id AND paid.status = 'success'
    )`,
    pending: `NOT EXISTS (
      SELECT 1 FROM billing_transactions paid
      WHERE paid.store_id = s.id AND paid.status = 'success'
    )`,
    active: `(ss.status IN ('active', 'grandfathered') AND
      (ss.status = 'grandfathered' OR ss.current_period_end > NOW()))`,
    inactive: `(ss.status IS NULL OR ss.status NOT IN ('active', 'grandfathered') OR
      (ss.status <> 'grandfathered' AND
        (ss.current_period_end IS NULL OR ss.current_period_end <= NOW())))`,
  };
  return clauses[status] || `$${paramIndex} = 'all'`;
}

// Shared WHERE clause for the store directory, its count, and its CSV export.
function storeFilters(rawSearch, rawStatus) {
  const search = searchTerm(rawSearch);
  const status = STORE_STATUSES.includes(rawStatus) ? rawStatus : 'all';
  const where = [
    `($1 = '' OR s.name ILIKE '%' || $1 || '%' OR s.email ILIKE '%' || $1 || '%'
      OR owner.email ILIKE '%' || $1 || '%' OR owner.name ILIKE '%' || $1 || '%')`,
    statusClause(status, 2),
  ].join(' AND ');
  return { search, status, params: [search, status], where };
}

function paymentFilters(rawSearch, rawStatus) {
  const search = searchTerm(rawSearch);
  const status = PAYMENT_STATUSES.includes(rawStatus) ? rawStatus : 'all';
  const where = `($1 = '' OR s.name ILIKE '%' || $1 || '%' OR bt.provider_reference ILIKE '%' || $1 || '%')
      AND ($2 = 'all' OR bt.status = $2)`;
  return { params: [search, status], where };
}

const STORE_OWNER_JOIN = `
  LEFT JOIN LATERAL (
    SELECT u.id, u.name, u.email, u.phone, u.is_active
    FROM users u
    JOIN roles r ON r.id = u.role_id
    WHERE u.store_id = s.id
    ORDER BY (r.name = 'admin') DESC, u.created_at
    LIMIT 1
  ) owner ON true`;

const STORE_LAST_PAYMENT_JOIN = `
  LEFT JOIN LATERAL (
    SELECT bt.provider, bt.provider_reference, bt.amount_ngn, bt.currency, bt.paid_at
    FROM billing_transactions bt
    WHERE bt.store_id = s.id AND bt.status = 'success'
    ORDER BY bt.paid_at DESC NULLS LAST, bt.created_at DESC
    LIMIT 1
  ) payment ON true`;

const STORE_LIST_COLUMNS = `
  s.id, s.name, s.email, s.phone, s.currency, s.created_at,
  owner.id AS owner_id, owner.name AS owner_name, owner.email AS owner_email,
  owner.phone AS owner_phone, owner.is_active AS owner_is_active,
  ss.status AS subscription_status, ss.plan_code, ss.provider,
  ss.activation_fee_paid, ss.current_period_end,
  payment.provider AS payment_provider,
  payment.provider_reference AS payment_reference,
  payment.amount_ngn AS payment_amount,
  payment.currency AS payment_currency,
  payment.paid_at AS payment_paid_at`;

router.get('/me', (req, res) => {
  res.json({
    user: {
      id: req.user.id,
      email: req.user.email,
      name: req.user.name,
    },
    platform_admin: true,
    granted_at: req.platformAdmin.granted_at,
  });
});

router.get('/overview', async (req, res, next) => {
  try {
    const { params, where } = storeFilters(req.query.search, req.query.status);
    const { page, limit, offset } = pageOptions(req.query.page, req.query.limit);

    const [summaryResult, amountsResult, countResult, storesResult, paymentsResult] = await Promise.all([
      query(
        `SELECT
           COUNT(*)::int AS registered_stores,
           COUNT(*) FILTER (WHERE s.created_at >= NOW() - INTERVAL '7 days')::int AS registered_last_7_days,
           COUNT(*) FILTER (WHERE EXISTS (
             SELECT 1 FROM billing_transactions bt
             WHERE bt.store_id = s.id AND bt.status = 'success'
           ))::int AS paid_stores,
           COUNT(*) FILTER (WHERE NOT EXISTS (
             SELECT 1 FROM billing_transactions bt
             WHERE bt.store_id = s.id AND bt.status = 'success'
           ))::int AS pending_stores
         FROM stores s`
      ),
      query(
        `SELECT currency, COUNT(*)::int AS payment_count,
                COALESCE(SUM(amount_ngn), 0)::numeric AS total_amount
         FROM billing_transactions
         WHERE status = 'success'
         GROUP BY currency
         ORDER BY currency`
      ),
      query(
        `SELECT COUNT(*)::int AS count
         FROM stores s
         LEFT JOIN store_subscriptions ss ON ss.store_id = s.id
         ${STORE_OWNER_JOIN}
         WHERE ${where}`,
        params
      ),
      query(
        `SELECT ${STORE_LIST_COLUMNS}
         FROM stores s
         LEFT JOIN store_subscriptions ss ON ss.store_id = s.id
         ${STORE_OWNER_JOIN}
         ${STORE_LAST_PAYMENT_JOIN}
         WHERE ${where}
         ORDER BY s.created_at DESC
         LIMIT $3 OFFSET $4`,
        [...params, limit, offset]
      ),
      query(
        `SELECT bt.id, bt.store_id, s.name AS store_name, bt.provider,
                bt.provider_reference, bt.plan_code, bt.amount_ngn AS amount,
                bt.currency, bt.status, bt.paid_at, bt.created_at
         FROM billing_transactions bt
         JOIN stores s ON s.id = bt.store_id
         ORDER BY COALESCE(bt.paid_at, bt.created_at) DESC
         LIMIT 8`
      ),
    ]);

    res.json({
      summary: {
        ...summaryResult.rows[0],
        payment_totals: amountsResult.rows.map((row) => ({
          currency: row.currency,
          count: Number(row.payment_count),
          amount: Number(row.total_amount),
        })),
      },
      stores: storesResult.rows,
      recent_payments: paymentsResult.rows,
      pagination: {
        page,
        limit,
        total: Number(countResult.rows[0]?.count || 0),
      },
    });
  } catch (error) {
    next(error);
  }
});

router.get('/payments', async (req, res, next) => {
  try {
    const { params, where } = paymentFilters(req.query.search, req.query.status);
    const { page, limit, offset } = pageOptions(req.query.page, req.query.limit);
    const [countResult, paymentResult] = await Promise.all([
      query(
        `SELECT COUNT(*)::int AS count
         FROM billing_transactions bt JOIN stores s ON s.id = bt.store_id
         WHERE ${where}`,
        params
      ),
      query(
        `SELECT bt.id, bt.store_id, s.name AS store_name, s.email AS store_email,
                bt.provider, bt.provider_reference, bt.provider_transaction_id,
                bt.plan_code, bt.amount_ngn AS amount, bt.currency, bt.status,
                bt.paid_at, bt.created_at
         FROM billing_transactions bt
         JOIN stores s ON s.id = bt.store_id
         WHERE ${where}
         ORDER BY COALESCE(bt.paid_at, bt.created_at) DESC
         LIMIT $3 OFFSET $4`,
        [...params, limit, offset]
      ),
    ]);
    res.json({
      payments: paymentResult.rows,
      pagination: { page, limit, total: Number(countResult.rows[0]?.count || 0) },
    });
  } catch (error) {
    next(error);
  }
});

const AUDIT_SELECT = `
  SELECT al.id, al.action, al.old_values, al.new_values, al.created_at,
         al.target_store_id, al.target_user_id,
         actor.name AS actor_name, actor.email AS actor_email,
         st.name AS store_name, target.name AS target_user_name, target.email AS target_user_email
  FROM platform_audit_logs al
  LEFT JOIN users actor ON actor.id = al.actor_user_id
  LEFT JOIN stores st ON st.id = al.target_store_id
  LEFT JOIN users target ON target.id = al.target_user_id`;

function auditEntry(row) {
  return {
    id: Number(row.id),
    action: row.action,
    old_values: row.old_values || null,
    new_values: row.new_values || null,
    created_at: row.created_at,
    store_id: row.target_store_id,
    store_name: row.store_name || null,
    target_user_name: row.target_user_name || null,
    target_user_email: row.target_user_email || null,
    actor_name: row.actor_name || null,
    actor_email: row.actor_email || null,
  };
}

async function writeAudit(runner, req, { storeId = null, userId = null, action, oldValues = null, newValues = null }) {
  const result = await runner.query(
    `INSERT INTO platform_audit_logs
       (actor_user_id, target_store_id, target_user_id, action, old_values, new_values)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, action, old_values, new_values, created_at, target_store_id, target_user_id`,
    [
      req.user.id,
      storeId,
      userId,
      action,
      oldValues == null ? null : JSON.stringify(oldValues),
      newValues == null ? null : JSON.stringify(newValues),
    ]
  );
  return result.rows[0] || null;
}

// Monthly sign-ups, first payments (paid conversions), and verified revenue.
router.get('/trends', async (req, res, next) => {
  try {
    const months = Math.min(24, Math.max(3, Number.parseInt(req.query.months, 10) || 12));
    const [countsResult, revenueResult] = await Promise.all([
      query(
        `WITH months AS (
           SELECT generate_series(
             date_trunc('month', NOW()) - ($1::int - 1) * INTERVAL '1 month',
             date_trunc('month', NOW()),
             INTERVAL '1 month'
           ) AS month
         ),
         first_paid AS (
           SELECT store_id, MIN(COALESCE(paid_at, created_at)) AS paid_at
           FROM billing_transactions
           WHERE status = 'success'
           GROUP BY store_id
         )
         SELECT to_char(m.month, 'YYYY-MM') AS month,
                (SELECT COUNT(*) FROM stores s
                  WHERE s.created_at >= m.month AND s.created_at < m.month + INTERVAL '1 month')::int AS signups,
                (SELECT COUNT(*) FROM first_paid fp
                  WHERE fp.paid_at >= m.month AND fp.paid_at < m.month + INTERVAL '1 month')::int AS first_payments
         FROM months m
         ORDER BY m.month`,
        [months]
      ),
      query(
        `SELECT to_char(date_trunc('month', COALESCE(paid_at, created_at)), 'YYYY-MM') AS month,
                currency, COUNT(*)::int AS payment_count,
                COALESCE(SUM(amount_ngn), 0)::numeric AS total_amount
         FROM billing_transactions
         WHERE status = 'success'
           AND COALESCE(paid_at, created_at) >= date_trunc('month', NOW()) - ($1::int - 1) * INTERVAL '1 month'
         GROUP BY 1, 2
         ORDER BY 1, 2`,
        [months]
      ),
    ]);
    const revenueByMonth = new Map();
    for (const row of revenueResult.rows) {
      const list = revenueByMonth.get(row.month) || [];
      list.push({ currency: row.currency, count: Number(row.payment_count), amount: Number(row.total_amount) });
      revenueByMonth.set(row.month, list);
    }
    res.json({
      months: countsResult.rows.map((row) => ({
        month: row.month,
        signups: Number(row.signups),
        first_payments: Number(row.first_payments),
        revenue: revenueByMonth.get(row.month) || [],
      })),
    });
  } catch (error) {
    next(error);
  }
});

router.get('/activity', async (req, res, next) => {
  try {
    const { page, limit, offset } = pageOptions(req.query.page, req.query.limit);
    const [countResult, rowsResult] = await Promise.all([
      query('SELECT COUNT(*)::int AS count FROM platform_audit_logs'),
      query(
        `${AUDIT_SELECT}
         ORDER BY al.created_at DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset]
      ),
    ]);
    res.json({
      activity: rowsResult.rows.map(auditEntry),
      pagination: { page, limit, total: Number(countResult.rows[0]?.count || 0) },
    });
  } catch (error) {
    next(error);
  }
});

router.get('/export/stores', async (req, res, next) => {
  try {
    const { params, where } = storeFilters(req.query.search, req.query.status);
    const result = await query(
      `SELECT ${STORE_LIST_COLUMNS}
       FROM stores s
       LEFT JOIN store_subscriptions ss ON ss.store_id = s.id
       ${STORE_OWNER_JOIN}
       ${STORE_LAST_PAYMENT_JOIN}
       WHERE ${where}
       ORDER BY s.created_at DESC
       LIMIT ${EXPORT_LIMIT + 1}`,
      params
    );
    res.json({
      stores: result.rows.slice(0, EXPORT_LIMIT),
      truncated: result.rows.length > EXPORT_LIMIT,
    });
  } catch (error) {
    next(error);
  }
});

router.get('/export/payments', async (req, res, next) => {
  try {
    const { params, where } = paymentFilters(req.query.search, req.query.status);
    const result = await query(
      `SELECT bt.id, bt.store_id, s.name AS store_name, s.email AS store_email,
              bt.provider, bt.provider_reference, bt.provider_transaction_id,
              bt.plan_code, bt.amount_ngn AS amount, bt.currency, bt.status,
              bt.paid_at, bt.created_at
       FROM billing_transactions bt
       JOIN stores s ON s.id = bt.store_id
       WHERE ${where}
       ORDER BY COALESCE(bt.paid_at, bt.created_at) DESC
       LIMIT ${EXPORT_LIMIT + 1}`,
      params
    );
    res.json({
      payments: result.rows.slice(0, EXPORT_LIMIT),
      truncated: result.rows.length > EXPORT_LIMIT,
    });
  } catch (error) {
    next(error);
  }
});

router.get('/stores/:id', async (req, res, next) => {
  try {
    const [storeResult, usersResult, paymentsResult, activityResult] = await Promise.all([
      query(
        `SELECT s.*, ss.status AS subscription_status, ss.plan_code,
                ss.provider AS subscription_provider, ss.activation_fee_paid,
                ss.current_period_start, ss.current_period_end, ss.updated_at AS subscription_updated_at
         FROM stores s
         LEFT JOIN store_subscriptions ss ON ss.store_id = s.id
         WHERE s.id = $1`,
        [req.params.id]
      ),
      query(
        `SELECT u.id, u.name, u.email, u.phone, u.is_active, u.last_login,
                u.created_at, r.name AS role,
                EXISTS(SELECT 1 FROM platform_admins pa WHERE pa.user_id = u.id) AS is_platform_admin
         FROM users u JOIN roles r ON r.id = u.role_id
         WHERE u.store_id = $1
         ORDER BY (r.name = 'admin') DESC, u.created_at`,
        [req.params.id]
      ),
      query(
        `SELECT id, provider, provider_reference, provider_transaction_id,
                plan_code, amount_ngn AS amount, currency, status, paid_at, created_at
         FROM billing_transactions
         WHERE store_id = $1
         ORDER BY COALESCE(paid_at, created_at) DESC
         LIMIT 50`,
        [req.params.id]
      ),
      query(
        `${AUDIT_SELECT}
         WHERE al.target_store_id = $1
         ORDER BY al.created_at DESC
         LIMIT 60`,
        [req.params.id]
      ),
    ]);
    if (!storeResult.rows[0]) return res.status(404).json({ error: 'Store not found' });
    const entries = activityResult.rows.map(auditEntry);
    res.json({
      store: storeResult.rows[0],
      users: usersResult.rows,
      payments: paymentsResult.rows,
      notes: entries.filter((entry) => entry.action === 'store_note_added'),
      activity: entries.filter((entry) => entry.action !== 'store_note_added').slice(0, 20),
    });
  } catch (error) {
    next(error);
  }
});

router.post('/stores/:id/notes', validate(noteSchema), async (req, res, next) => {
  try {
    const store = await query('SELECT id FROM stores WHERE id = $1', [req.params.id]);
    if (!store.rows[0]) return res.status(404).json({ error: 'Store not found' });
    const row = await writeAudit({ query }, req, {
      storeId: req.params.id,
      action: 'store_note_added',
      newValues: { note: req.body.note },
    });
    res.status(201).json({
      note: auditEntry({ ...row, actor_name: req.user.name, actor_email: req.user.email }),
    });
  } catch (error) {
    next(error);
  }
});

// Gives a store free access for a number of days, for support or goodwill.
// It never marks the activation fee as paid, so billing history stays honest.
router.post('/stores/:id/extend', validate(extendSchema), async (req, res, next) => {
  const client = await getClient().catch(next);
  if (!client) return;

  try {
    await client.query('BEGIN');
    const current = await client.query(
      `SELECT store_id, status, current_period_start, current_period_end
       FROM store_subscriptions WHERE store_id = $1
       FOR UPDATE`,
      [req.params.id]
    );
    const subscription = current.rows[0];
    if (!subscription) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'This store has no subscription record yet' });
    }
    if (subscription.status === 'grandfathered') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'This store already has permanent access' });
    }

    const updated = await client.query(
      `UPDATE store_subscriptions
       SET status = CASE WHEN status IN ('active', 'past_due', 'cancelled') THEN status ELSE 'active' END,
           current_period_start = COALESCE(current_period_start, NOW()),
           current_period_end = GREATEST(COALESCE(current_period_end, NOW()), NOW()) + make_interval(days => $2::int),
           updated_at = NOW()
       WHERE store_id = $1
       RETURNING status, current_period_start, current_period_end`,
      [req.params.id, req.body.days]
    );
    const extended = updated.rows[0];
    await writeAudit(client, req, {
      storeId: req.params.id,
      action: 'subscription_extended',
      oldValues: { status: subscription.status, current_period_end: subscription.current_period_end },
      newValues: {
        status: extended.status,
        current_period_end: extended.current_period_end,
        days: req.body.days,
        reason: req.body.reason,
      },
    });
    await client.query('COMMIT');
    res.json({ subscription: extended });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    next(error);
  } finally {
    client.release();
  }
});

const EMAIL_SKIP_MESSAGES = {
  duplicate: [409, 'This email was already sent to this store in the last hour.'],
  email_not_configured: [503, 'Email sending is not set up on the server.'],
  missing_recipient: [400, 'This store has no email address to send to.'],
  already_activated: [400, 'This store has already activated, so it does not need an activation reminder.'],
};

router.post('/stores/:id/emails', validate(emailSchema), async (req, res, next) => {
  try {
    // One manual resend per email type per store per hour.
    const notificationKey = `manual:${new Date().toISOString().slice(0, 13)}`;
    let delivery;
    if (req.body.type === 'welcome') {
      const result = await query(
        `SELECT s.id, s.name AS store_name,
                COALESCE(s.email, owner.email) AS email,
                owner.name AS owner_name
         FROM stores s
         LEFT JOIN LATERAL (
           SELECT u.email, u.name
           FROM users u
           JOIN roles r ON r.id = u.role_id
           WHERE u.store_id = s.id AND r.name = 'admin' AND u.is_active = true
           ORDER BY u.created_at
           LIMIT 1
         ) owner ON true
         WHERE s.id = $1`,
        [req.params.id]
      );
      const store = result.rows[0];
      if (!store) return res.status(404).json({ error: 'Store not found' });
      if (!store.email) delivery = { skipped: true, reason: 'missing_recipient' };
      else {
        delivery = await sendWelcomeEmail({
          storeId: store.id,
          to: store.email,
          name: store.owner_name,
          storeName: store.store_name,
          notificationKey,
        });
        if (delivery?.skipped && !delivery.duplicate) delivery = { skipped: true, reason: 'email_not_configured' };
      }
    } else {
      delivery = await sendActivationReminder(req.params.id, { notificationKey });
    }

    if (delivery?.skipped) {
      const reason = delivery.duplicate ? 'duplicate' : delivery.reason;
      const [status, message] = EMAIL_SKIP_MESSAGES[reason] || [400, 'The email was not sent.'];
      return res.status(status).json({ error: message, reason });
    }

    await writeAudit({ query }, req, {
      storeId: req.params.id,
      action: 'email_resent',
      newValues: { type: req.body.type, delivery_id: delivery?.id || null },
    });
    res.json({ sent: true, type: req.body.type });
  } catch (error) {
    next(error);
  }
});

router.patch('/users/:id/access', validate(accessSchema), async (req, res, next) => {
  const client = await getClient().catch(next);
  if (!client) return;

  try {
    await client.query('BEGIN');
    const targetResult = await client.query(
      `SELECT u.id, u.store_id, u.name, u.email, u.is_active,
              EXISTS(SELECT 1 FROM platform_admins pa WHERE pa.user_id = u.id) AS is_platform_admin
       FROM users u WHERE u.id = $1
       FOR UPDATE`,
      [req.params.id]
    );
    const target = targetResult.rows[0];
    if (!target) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'User not found' });
    }
    if (target.is_platform_admin) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Platform owner access cannot be changed here' });
    }

    const result = await client.query(
      `UPDATE users SET is_active = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING id, store_id, name, email, is_active`,
      [req.body.is_active, target.id]
    );
    if (!req.body.is_active) {
      await client.query('DELETE FROM refresh_tokens WHERE user_id = $1', [target.id]);
    }
    await client.query(
      `INSERT INTO platform_audit_logs
        (actor_user_id, target_store_id, target_user_id, action, old_values, new_values)
       VALUES ($1, $2, $3, 'user_access_changed', $4, $5)`,
      [
        req.user.id,
        target.store_id,
        target.id,
        JSON.stringify({ is_active: target.is_active }),
        JSON.stringify({ is_active: req.body.is_active }),
      ]
    );
    await client.query('COMMIT');
    res.json({ user: result.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    next(error);
  } finally {
    client.release();
  }
});

export default router;
