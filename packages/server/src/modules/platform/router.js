import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requirePlatformAdmin } from '../../middleware/auth.js';
import { getClient, query } from '../../config/database.js';
import { validate } from '../../middleware/validate.js';

const router = Router();

router.use(authenticate);
router.use(requirePlatformAdmin);

const accessSchema = z.object({
  body: z.object({ is_active: z.boolean() }),
});

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
    const search = searchTerm(req.query.search);
    const status = ['all', 'paid', 'pending', 'active', 'inactive'].includes(req.query.status)
      ? req.query.status
      : 'all';
    const { page, limit, offset } = pageOptions(req.query.page, req.query.limit);
    const params = [search, status];
    const filters = [
      `($1 = '' OR s.name ILIKE '%' || $1 || '%' OR s.email ILIKE '%' || $1 || '%'
        OR owner.email ILIKE '%' || $1 || '%' OR owner.name ILIKE '%' || $1 || '%')`,
      statusClause(status, 2),
    ];

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
         LEFT JOIN LATERAL (
           SELECT u.name, u.email
           FROM users u
           JOIN roles r ON r.id = u.role_id
           WHERE u.store_id = s.id
           ORDER BY (r.name = 'admin') DESC, u.created_at
           LIMIT 1
         ) owner ON true
         WHERE ${filters.join(' AND ')}`,
        params
      ),
      query(
        `SELECT
           s.id, s.name, s.email, s.phone, s.currency, s.created_at,
           owner.id AS owner_id, owner.name AS owner_name, owner.email AS owner_email,
           owner.phone AS owner_phone, owner.is_active AS owner_is_active,
           ss.status AS subscription_status, ss.plan_code, ss.provider,
           ss.activation_fee_paid, ss.current_period_end,
           payment.provider AS payment_provider,
           payment.provider_reference AS payment_reference,
           payment.amount_ngn AS payment_amount,
           payment.currency AS payment_currency,
           payment.paid_at AS payment_paid_at
         FROM stores s
         LEFT JOIN store_subscriptions ss ON ss.store_id = s.id
         LEFT JOIN LATERAL (
           SELECT u.id, u.name, u.email, u.phone, u.is_active
           FROM users u
           JOIN roles r ON r.id = u.role_id
           WHERE u.store_id = s.id
           ORDER BY (r.name = 'admin') DESC, u.created_at
           LIMIT 1
         ) owner ON true
         LEFT JOIN LATERAL (
           SELECT bt.provider, bt.provider_reference, bt.amount_ngn, bt.currency, bt.paid_at
           FROM billing_transactions bt
           WHERE bt.store_id = s.id AND bt.status = 'success'
           ORDER BY bt.paid_at DESC NULLS LAST, bt.created_at DESC
           LIMIT 1
         ) payment ON true
         WHERE ${filters.join(' AND ')}
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
    const search = searchTerm(req.query.search);
    const status = ['all', 'initialized', 'success', 'failed', 'paid_duplicate'].includes(req.query.status)
      ? req.query.status
      : 'all';
    const { page, limit, offset } = pageOptions(req.query.page, req.query.limit);
    const params = [search, status];
    const where = `($1 = '' OR s.name ILIKE '%' || $1 || '%' OR bt.provider_reference ILIKE '%' || $1 || '%')
      AND ($2 = 'all' OR bt.status = $2)`;
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

router.get('/stores/:id', async (req, res, next) => {
  try {
    const [storeResult, usersResult, paymentsResult] = await Promise.all([
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
    ]);
    if (!storeResult.rows[0]) return res.status(404).json({ error: 'Store not found' });
    res.json({
      store: storeResult.rows[0],
      users: usersResult.rows,
      payments: paymentsResult.rows,
    });
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
