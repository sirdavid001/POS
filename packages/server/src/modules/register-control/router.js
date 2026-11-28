import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { authenticate, authorize } from '../../middleware/auth.js';
import { requireActiveSubscription } from '../../middleware/subscription.js';
import { getClient, query } from '../../config/database.js';
import { validate } from '../../middleware/validate.js';
import { PostgresRateLimitStore } from '../../middleware/postgres-rate-limit-store.js';
import {
  RegisterError, audit, badgeDigest, canIssueBadge, canManageStaff, issueBadge,
  loadSession, presentRegisterBasket, presentSession, privileged, registerPolicy, resolveBadge, startSession,
  updateBasket, withRegisterTransaction,
} from './service.js';

const router = Router();
router.use(authenticate, requireActiveSubscription());
router.use((_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });
router.use((req, res, next) => {
  if (req.subscription?.paid_staff_tools) return next();
  return res.status(402).json({
    error: 'Staff profiles, badge checkout and the activity log require an active paid QuickPOS subscription.',
    code: 'PAID_STAFF_TOOLS_REQUIRED',
    subscription: req.subscription,
  });
});
const positiveInt = z.coerce.number().int().positive().max(2147483647);
const memberParams = z.object({ id: positiveInt });
const sessionParams = z.object({ id: z.uuid() });
const code = z.string().trim().toUpperCase().regex(/^QPB[0-9]{38}$/);
const pin = z.string().regex(/^[0-9]{8}$/, 'Use an 8-digit supervisor PIN');
const basketLimiter = rateLimit({
  windowMs: 60_000, max: 300,
  keyGenerator: (req) => String(req.user.id),
  store: new PostgresRateLimitStore('register-basket'), legacyHeaders: false, standardHeaders: 'draft-8',
  message: { error: 'Too many register requests. Wait a moment before scanning again.' },
});
const supervisorPinLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 10, skipSuccessfulRequests: true,
  keyGenerator: (req) => String(req.user.store_id),
  store: new PostgresRateLimitStore('register-pin'), legacyHeaders: false, standardHeaders: 'draft-8',
  skip: (req) => !req.body.approval_pin,
  message: { error: 'Too many incorrect PIN attempts. Use a supervisor badge or try again later.' },
});
const actions = ['account_login', 'register_opened', 'register_closed', 'basket_reduced', 'basket_cleared',
  'sale_completed', 'sale_refunded', 'staff_profile_updated', 'staff_badge_issued', 'staff_badge_revoked',
  'supervisor_pin_changed', 'register_policy_changed'];
const inlinePhoto = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

const route = (work) => async (req, res, next) => {
  try { await work(req, res); }
  catch (error) {
    if (error instanceof RegisterError) return res.status(error.status).json({ error: error.message, code: error.code });
    next(error);
  }
};

function transaction(work) { return withRegisterTransaction(getClient, work); }
function problem(status, message, code) { throw new RegisterError(status, message, code); }
const userFields = `u.id, u.name, u.email, u.phone, u.staff_photo, u.is_active, u.staff_badge_issued_at,
  r.name AS role, s.name AS store_name, (u.register_pin_hash IS NOT NULL) AS supervisor_pin_set`;

async function getMember(client, actor, id, { badge = false, lock = false } = {}) {
  const { rows: [member] } = await client.query(
    `SELECT ${userFields}${lock ? ', u.password_hash' : ''}
     FROM users u JOIN roles r ON r.id = u.role_id JOIN stores s ON s.id = u.store_id
     WHERE u.id = $1 AND u.store_id = $2${lock ? ' FOR UPDATE OF u' : ''}`,
    [id, actor.store_id]
  );
  if (!member || !(badge ? canIssueBadge(actor, member) : canManageStaff(actor, member))) {
    problem(404, 'Staff member not found.', 'STAFF_NOT_FOUND');
  }
  return member;
}

router.get('/profile', route(async (req, res) => {
  res.json({ profile: await getMember({ query }, req.user, req.user.id) });
}));

router.get('/profiles/:id', validate(z.object({ params: memberParams })), route(async (req, res) => {
  res.json({ profile: await getMember({ query }, req.user, req.params.id) });
}));

router.get('/badges/:id', authorize('admin', 'manager'), validate(z.object({ params: memberParams })), route(async (req, res) => {
  const { id, name, role, staff_badge_issued_at, is_active } = await getMember({ query }, req.user, req.params.id, { badge: true });
  res.json({ profile: { id, name, role, staff_badge_issued_at, is_active } });
}));

router.patch('/supervisor-pin', authorize('admin', 'manager'), validate(z.object({ body: z.object({
  pin: pin.nullable(),
  password: z.string().min(1).max(1024),
}) })), route(async (req, res) => {
  const { rows: [member] } = await query('SELECT password_hash FROM users WHERE id = $1 AND store_id = $2', [req.user.id, req.user.store_id]);
  if (!member || !await bcrypt.compare(req.body.password, member.password_hash)) {
    problem(403, 'Enter your current password to manage your supervisor PIN.', 'PIN_PASSWORD_REQUIRED');
  }
  if (req.body.pin && (/^(\d)\1{7}$/.test(req.body.pin) || ['12345678', '87654321', '01234567'].includes(req.body.pin))) {
    problem(400, 'Choose a PIN that is not repeated or sequential.', 'PIN_TOO_SIMPLE');
  }
  const hashed = req.body.pin ? await bcrypt.hash(req.body.pin, 12) : null;
  await transaction(async (client) => {
    const { rows: [locked] } = await client.query(
      `SELECT u.password_hash, r.name AS role FROM users u JOIN roles r ON r.id = u.role_id
       WHERE u.id = $1 AND u.store_id = $2 AND u.is_active FOR UPDATE OF u`, [req.user.id, req.user.store_id]
    );
    if (!locked || locked.password_hash !== member.password_hash || !privileged(locked.role)) {
      problem(403, 'Account access changed. Sign in again.', 'STAFF_ACCESS_CHANGED');
    }
    await client.query('UPDATE users SET register_pin_hash = $1 WHERE id = $2 AND store_id = $3', [hashed, req.user.id, req.user.store_id]);
    await audit(client, req.user, 'staff', req.user.id, 'supervisor_pin_changed', { enabled: Boolean(hashed) });
  });
  res.json({ enabled: Boolean(hashed) });
}));

const profileBody = z.object({
  name: z.string().trim().min(1).max(255),
  email: z.string().trim().toLowerCase().email().max(255),
  phone: z.string().trim().max(50),
  photo: z.string().max(180000).regex(inlinePhoto, 'Choose a JPG, PNG or WebP photo').nullable().optional(),
  current_password: z.string().max(1024).optional(),
});
router.patch('/profiles/:id', validate(z.object({ params: memberParams, body: profileBody })), route(async (req, res) => {
  const profile = await transaction(async (client) => {
    // Password verification runs before taking the row lock; compare the hash again after locking.
    const member = await getMember(client, req.user, req.params.id);
    if (!member.is_active) problem(409, 'Restore this staff account before editing their profile.', 'STAFF_INACTIVE');
    const { name, email, phone, photo, current_password } = req.body;
    if (email !== member.email) {
      // A profile editor must not take over a privileged account by changing its login email.
      if (req.user.id !== member.id) problem(403, 'Only this staff member can change their own sign-in email here.', 'EMAIL_SELF_ONLY');
      const { rows: [current] } = await client.query('SELECT password_hash FROM users WHERE id = $1 AND store_id = $2', [member.id, req.user.store_id]);
      if (!current_password || !current || !await bcrypt.compare(current_password, current.password_hash)) {
        problem(403, 'Enter your current password to change your sign-in email.', 'EMAIL_PASSWORD_REQUIRED');
      }
      const locked = await getMember(client, req.user, member.id, { lock: true });
      if (locked.password_hash !== current.password_hash || locked.email !== member.email || !locked.is_active) {
        problem(409, 'This profile changed. Reload it and try again.', 'PROFILE_CHANGED');
      }
    } else {
      const locked = await getMember(client, req.user, member.id, { lock: true });
      if (locked.email !== member.email || !locked.is_active) problem(409, 'This profile changed. Reload it and try again.', 'PROFILE_CHANGED');
    }
    await client.query(
      `UPDATE users SET name = $1, email = $2, phone = $3,
       staff_photo = CASE WHEN $4 THEN $5 ELSE staff_photo END, updated_at = NOW()
       WHERE id = $6 AND store_id = $7`,
      [name, email, phone || null, photo !== undefined, photo ?? null, member.id, req.user.store_id]
    );
    await audit(client, req.user, 'staff', member.id, 'staff_profile_updated', {
      subject_name: name, email_changed: member.email !== email, photo_changed: photo !== undefined,
    });
    return getMember(client, req.user, member.id);
  });
  res.json({ profile });
}));

router.post('/badges/:id', authorize('admin', 'manager'), validate(z.object({ params: memberParams })), route(async (req, res) => {
  const result = await transaction(async (client) => {
    const member = await getMember(client, req.user, req.params.id, { badge: true, lock: true });
    if (!member.is_active) problem(409, 'Only active staff can receive a badge.', 'STAFF_INACTIVE');
    const badge = issueBadge();
    await client.query(
      `UPDATE users SET staff_badge_hash = $1, staff_badge_issued_at = NOW()
       WHERE id = $2 AND store_id = $3`,
      [badgeDigest(badge), member.id, req.user.store_id]
    );
    await audit(client, req.user, 'staff', member.id, 'staff_badge_issued', { subject_name: member.name });
    const profile = await getMember(client, req.user, member.id, { badge: true });
    return { badge, profile };
  });
  res.status(201).json(result);
}));

router.delete('/badges/:id', authorize('admin', 'manager'), validate(z.object({ params: memberParams })), route(async (req, res) => {
  await transaction(async (client) => {
    const member = await getMember(client, req.user, req.params.id, { badge: true, lock: true });
    if (!member.staff_badge_issued_at) return;
    await client.query(
      'UPDATE users SET staff_badge_hash = NULL, staff_badge_issued_at = NULL WHERE id = $1 AND store_id = $2',
      [member.id, req.user.store_id]
    );
    await audit(client, req.user, 'staff', member.id, 'staff_badge_revoked', { subject_name: member.name });
  });
  res.status(204).end();
}));

router.patch('/policy', authorize('admin'), validate(z.object({ body: z.object({ enabled: z.boolean() }) })), route(async (req, res) => {
  const { enabled } = req.body;
  await transaction(async (client) => {
    await client.query('SELECT id FROM stores WHERE id = $1 FOR UPDATE', [req.user.store_id]);
    if (enabled) {
      const { rows: [owner] } = await client.query(
        `SELECT id FROM users WHERE id = $1 AND store_id = $2 AND is_active AND staff_badge_hash IS NOT NULL FOR SHARE`,
        [req.user.id, req.user.store_id]
      );
      if (!owner) problem(409, 'Issue your own admin badge before requiring badges at checkout.', 'ADMIN_BADGE_REQUIRED');
    } else {
      const { rows: [openBasket] } = await client.query(
        `SELECT s.id FROM register_sessions s
         JOIN users u ON u.id = s.cashier_id AND u.store_id = s.store_id
         WHERE s.store_id = $1 AND s.closed_at IS NULL AND s.expires_at > NOW()
           AND u.is_active AND u.staff_badge_hash = s.badge_hash AND jsonb_array_length(s.cart) > 0
         LIMIT 1`,
        [req.user.store_id]
      );
      if (openBasket) problem(409, 'Complete or clear any active baskets before turning off badge checkout.', 'BASKET_NOT_EMPTY');
      await client.query('UPDATE register_sessions SET closed_at = NOW() WHERE store_id = $1 AND closed_at IS NULL', [req.user.store_id]);
    }
    const { rowCount } = await client.query(
      'UPDATE stores SET badge_checkout_required = $1 WHERE id = $2 AND badge_checkout_required IS DISTINCT FROM $1',
      [enabled, req.user.store_id]
    );
    if (rowCount) await audit(client, req.user, 'register', null, 'register_policy_changed', { enabled });
  });
  res.json({ enabled });
}));

router.post('/sessions', validate(z.object({ body: z.object({ badge: code, terminal_id: z.uuid() }) })), route(async (req, res) => {
  const session = await transaction(async (client) => {
    if (!await registerPolicy(client, req.user.store_id)) problem(409, 'Badge checkout is not enabled for this store.', 'BADGE_MODE_DISABLED');
    // Expired sessions contain no completed sale data. Keep cleanup bounded to this store.
    await client.query(`DELETE FROM register_sessions WHERE id IN (
      SELECT id FROM register_sessions WHERE store_id = $1 AND expires_at < NOW() - INTERVAL '1 day'
      ORDER BY expires_at LIMIT 50
    )`, [req.user.store_id]);
    const state = await startSession(client, req.user, req.body.badge, req.body.terminal_id);
    return presentRegisterBasket(client, req.user.store_id, state);
  });
  res.status(201).json({ session });
}));

router.delete('/sessions/:id', validate(z.object({ params: sessionParams })), route(async (req, res) => {
  await transaction(async (client) => {
    const session = await loadSession(client, req.user, req.params.id);
    if (session.cart.length) problem(409, 'Complete the sale or get approval to clear the basket first.', 'BASKET_NOT_EMPTY');
    await client.query('UPDATE register_sessions SET closed_at = NOW() WHERE id = $1 AND store_id = $2', [session.id, req.user.store_id]);
    await audit(client, { ...req.user, id: session.cashier_id, name: session.cashier_name, role: session.cashier_role },
      'register', null, 'register_closed', { terminal_user_id: req.user.id });
  });
  res.status(204).end();
}));

const basketBody = z.object({
  operation: z.enum(['add', 'decrease', 'remove', 'clear']),
  product_id: positiveInt.optional(),
  revision: z.number().int().nonnegative(),
  approval_badge: code.optional(),
  approval_pin: z.object({ email: z.string().trim().toLowerCase().email().max(255), pin }).optional(),
}).refine((body) => (body.operation === 'clear') === (body.product_id === undefined) &&
  (Number(Boolean(body.approval_badge)) + Number(Boolean(body.approval_pin)) === (body.operation === 'add' ? 0 : 1)),
{ message: 'Provide one supervisor approval for this basket change' });

async function resolveSupervisorPin(actor, { email, pin: supplied }) {
  const { rows: [member] } = await query(
    `SELECT u.id, u.store_id, u.name, u.register_pin_hash, r.name AS role
     FROM users u JOIN roles r ON r.id = u.role_id
     WHERE u.store_id = $1 AND u.email = $2 AND u.is_active AND r.name IN ('manager', 'admin')`, [actor.store_id, email]
  );
  // Use a fixed valid work factor for missing accounts as well, without revealing which account exists.
  const dummyHash = '$2b$12$C6UzMDM.H6dfI/f/IKcEe.5BdBN2vXS6SURcYP0Yj7Z3qe.Gj.Z/2';
  const valid = await bcrypt.compare(supplied, member?.register_pin_hash || dummyHash);
  if (!member?.register_pin_hash || !valid) problem(403, 'The supervisor email or PIN was not accepted.', 'PIN_INVALID');
  return member;
}

router.patch('/sessions/:id/basket', basketLimiter, validate(z.object({ params: sessionParams, body: basketBody })), supervisorPinLimiter, route(async (req, res) => {
  const pinApprover = req.body.approval_pin ? await resolveSupervisorPin(req.user, req.body.approval_pin) : null;
  const result = await transaction(async (client) => {
    if (!await registerPolicy(client, req.user.store_id)) problem(409, 'Badge checkout is no longer enabled. Reopen the terminal.', 'BADGE_MODE_DISABLED');
    const session = await loadSession(client, req.user, req.params.id);
    const { operation, product_id: productId, revision, approval_badge: approval } = req.body;
    if (session.revision !== revision) return {
      conflict: true, session: await presentRegisterBasket(client, req.user.store_id, presentSession(session)),
    };
    if (operation === 'add') {
      const { rows: [product] } = await client.query(
        'SELECT stock_quantity FROM products WHERE id = $1 AND store_id = $2 AND is_active', [productId, req.user.store_id]
      );
      const currentQuantity = session.cart.find((line) => line.product_id === productId)?.quantity ?? 0;
      if (!product || Number(product.stock_quantity) <= currentQuantity) problem(409, 'No more stock is available for that item.', 'OUT_OF_STOCK');
    }
    let approver = approval ? await resolveBadge(client, req.user.store_id, approval) : null;
    if (pinApprover) {
      const { rows: [current] } = await client.query(
        `SELECT u.id, u.name, r.name AS role FROM users u JOIN roles r ON r.id = u.role_id
         WHERE u.id = $1 AND u.store_id = $2 AND u.is_active AND u.register_pin_hash = $3
         FOR SHARE OF u`, [pinApprover.id, req.user.store_id, pinApprover.register_pin_hash]
      );
      if (!current) problem(403, 'The supervisor PIN changed. Try again.', 'PIN_INVALID');
      approver = current;
    }
    if (approver && (!privileged(approver.role) || approver.id === session.cashier_id && session.cashier_role === 'cashier')) {
      problem(403, 'A manager or admin must approve this change.', 'BADGE_APPROVAL_REQUIRED');
    }
    const next = updateBasket(session.cart, operation, productId);
    if (approver && next.removed.length) {
      const removed = await presentRegisterBasket(client, req.user.store_id, { cart: next.removed });
      await audit(client, { ...req.user, id: session.cashier_id, name: session.cashier_name, role: session.cashier_role },
        'basket', null, operation === 'clear' ? 'basket_cleared' : 'basket_reduced', {
          operation, terminal_user_id: req.user.id, approver_id: approver.id, approver_name: approver.name,
          approver_role: approver.role, approval_method: pinApprover ? 'pin' : 'badge',
          items: removed.cart.map(({ product_id, name, quantity }) => ({ product_id, name, quantity })),
        });
    }
    const { rows: [updated] } = await client.query(
      'UPDATE register_sessions SET cart = $1, revision = revision + 1 WHERE id = $2 AND store_id = $3 RETURNING *',
      [JSON.stringify(next.cart), session.id, req.user.store_id]
    );
    return { session: await presentRegisterBasket(client, req.user.store_id, presentSession({ ...updated, cashier_name: session.cashier_name })) };
  });
  if (result.conflict) return res.status(409).json({ error: 'The basket changed. Review it and try again.', code: 'BASKET_CHANGED', session: result.session });
  res.json(result);
}));

router.get('/activity', authorize('admin'), validate(z.object({ query: z.object({
  before: positiveInt.optional(),
  action: z.enum(actions).optional(),
  actor: positiveInt.optional(),
}) })), route(async (req, res) => {
  const { before, action, actor } = req.query;
  const { rows } = await query(
    `SELECT a.id, a.created_at, a.entity_type, a.entity_id, a.user_id,
       COALESCE(a.new_values ->> 'actor_name', u.name) AS actor_name,
       COALESCE(a.new_values ->> 'actor_role', r.name) AS actor_role,
       CASE WHEN a.entity_type = 'order' AND a.action = 'create' THEN 'sale_completed'
            WHEN a.entity_type = 'order' AND a.action = 'refund' THEN 'sale_refunded' ELSE a.action END AS action,
       a.new_values ->> 'approver_name' AS approver_name,
       a.new_values ->> 'subject_name' AS subject_name,
       a.new_values ->> 'order_number' AS order_number,
       a.new_values ->> 'reason' AS reason,
       a.new_values ->> 'enabled' AS enabled,
       a.new_values ->> 'approval_method' AS approval_method,
       a.new_values -> 'items' AS items
     FROM audit_logs a
     LEFT JOIN users u ON u.id = a.user_id AND u.store_id = a.store_id
     LEFT JOIN roles r ON r.id = u.role_id
     WHERE a.store_id = $1
       AND ($2::integer IS NULL OR a.id < $2)
       AND ($3::integer IS NULL OR a.user_id = $3)
       AND ((a.entity_type = 'order' AND a.action IN ('create','refund')) OR a.action = ANY($4::text[]))
       AND ($5::text IS NULL OR a.action = $5
         OR ($5 = 'sale_completed' AND a.entity_type = 'order' AND a.action = 'create')
         OR ($5 = 'sale_refunded' AND a.entity_type = 'order' AND a.action = 'refund'))
     ORDER BY a.id DESC LIMIT 51`,
    [req.user.store_id, before ?? null, actor ?? null, actions, action ?? null]
  );
  const page = rows.slice(0, 50);
  res.json({ events: page, next: rows.length > page.length ? page.at(-1).id : null });
}));

export default router;
