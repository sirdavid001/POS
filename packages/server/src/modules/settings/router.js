import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { query } from '../../config/database.js';
import { authenticate, authorize } from '../../middleware/auth.js';
import { requireActiveSubscription } from '../../middleware/subscription.js';

const router = Router();
router.use(authenticate);
router.use(requireActiveSubscription());

// GET store settings
router.get('/store', async (req, res, next) => {
  try {
    const result = await query('SELECT * FROM stores WHERE id = $1', [req.user.store_id]);
    res.json({ store: result.rows[0] });
  } catch (err) { next(err); }
});

// PATCH update store settings
router.patch('/store', authorize('admin'), async (req, res, next) => {
  try {
    const { name, address, phone, email, tax_rate, currency, logo_url, receipt_header, receipt_footer } = req.body;
    const result = await query(
      `UPDATE stores SET
        name = COALESCE($1,name), address = COALESCE($2,address), phone = COALESCE($3,phone),
        email = COALESCE($4,email), tax_rate = COALESCE($5,tax_rate), currency = COALESCE($6,currency),
        logo_url = COALESCE($7,logo_url), receipt_header = COALESCE($8,receipt_header),
        receipt_footer = COALESCE($9,receipt_footer), updated_at = NOW()
       WHERE id = $10 RETURNING *`,
      [name, address, phone, email, tax_rate, currency, logo_url, receipt_header, receipt_footer, req.user.store_id]
    );
    res.json({ store: result.rows[0] });
  } catch (err) { next(err); }
});

// GET users (staff management)
router.get('/users', authorize('admin', 'manager'), async (req, res, next) => {
  try {
    const result = await query(
      `SELECT u.id, u.email, u.name, u.phone, u.is_active, u.last_login, u.created_at,
              r.name as role, creator.name AS created_by
       FROM users u
       JOIN roles r ON u.role_id = r.id
       LEFT JOIN users creator ON creator.id = u.created_by_user_id
       WHERE u.store_id = $1 ORDER BY u.created_at DESC`,
      [req.user.store_id]
    );
    res.json({ users: result.rows });
  } catch (err) { next(err); }
});

router.post('/users', authorize('admin', 'manager'), async (req, res, next) => {
  try {
    const { name, email, password, role = 'cashier', phone } = req.body;
    if (!name?.trim() || !email?.trim() || !password || password.length < 6) {
      return res.status(400).json({ error: 'Name, email, and a password of at least 6 characters are required' });
    }
    if (!['admin', 'manager', 'cashier'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }
    if (req.user.role === 'manager' && role !== 'cashier') {
      return res.status(403).json({ error: 'Managers can create cashier accounts only' });
    }

    const roleResult = await query('SELECT id FROM roles WHERE name = $1', [role]);
    const passwordHash = await bcrypt.hash(password, 12);
    const result = await query(
      `INSERT INTO users
       (store_id, role_id, email, password_hash, name, phone, created_by_user_id)
       VALUES ($1, $2, LOWER($3), $4, $5, $6, $7)
       RETURNING id, email, name, phone, is_active, created_at`,
      [
        req.user.store_id,
        roleResult.rows[0].id,
        email.trim(),
        passwordHash,
        name.trim(),
        phone?.trim() || null,
        req.user.id,
      ]
    );
    res.status(201).json({ user: { ...result.rows[0], role } });
  } catch (err) { next(err); }
});

// PATCH update user credentials, role, or status
router.patch('/users/:id', authorize('admin', 'manager'), async (req, res, next) => {
  try {
    const targetResult = await query(
      `SELECT u.id, u.role_id, u.is_active, r.name AS role
       FROM users u JOIN roles r ON r.id = u.role_id
       WHERE u.id = $1 AND u.store_id = $2`,
      [req.params.id, req.user.store_id]
    );
    const target = targetResult.rows[0];
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (req.user.role === 'manager' && target.role !== 'cashier') {
      return res.status(403).json({ error: 'Managers can manage cashier accounts only' });
    }

    const { role, is_active, name, email, password, phone } = req.body;
    if (Number(req.params.id) === Number(req.user.id) && (role || is_active === false)) {
      return res.status(400).json({ error: 'You cannot change your own role or deactivate your own account' });
    }
    if (req.user.role === 'manager' && role && role !== 'cashier') {
      return res.status(403).json({ error: 'Managers can assign the cashier role only' });
    }
    if (password && password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    let roleId = null;
    if (role) {
      const roleResult = await query('SELECT id FROM roles WHERE name = $1', [role]);
      if (roleResult.rows.length === 0) return res.status(400).json({ error: 'Invalid role' });
      roleId = roleResult.rows[0].id;
    }
    if (target.role === 'admin' && (role && role !== 'admin' || is_active === false)) {
      const admins = await query(
        `SELECT COUNT(*)::int AS count
         FROM users u JOIN roles r ON r.id = u.role_id
         WHERE u.store_id = $1 AND r.name = 'admin' AND u.is_active = true`,
        [req.user.store_id]
      );
      if (admins.rows[0].count <= 1) {
        return res.status(400).json({ error: 'A store must keep at least one active admin' });
      }
    }

    const passwordHash = password ? await bcrypt.hash(password, 12) : null;
    const result = await query(
      `UPDATE users SET
        role_id = COALESCE($1, role_id),
        is_active = COALESCE($2, is_active),
        name = COALESCE($3, name),
        email = COALESCE(LOWER($4), email),
        password_hash = COALESCE($5, password_hash),
        phone = COALESCE($6, phone),
        updated_at = NOW()
       WHERE id = $7 AND store_id = $8
       RETURNING id, email, name, phone, is_active`,
      [
        roleId,
        is_active,
        name?.trim() || null,
        email?.trim() || null,
        passwordHash,
        phone?.trim() || null,
        req.params.id,
        req.user.store_id,
      ]
    );

    res.json({ user: { ...result.rows[0], role: role || target.role } });
  } catch (err) { next(err); }
});

router.delete('/users/:id', authorize('admin', 'manager'), async (req, res, next) => {
  try {
    if (Number(req.params.id) === Number(req.user.id)) {
      return res.status(400).json({ error: 'You cannot delete your own account' });
    }
    const targetResult = await query(
      `SELECT u.id, r.name AS role
       FROM users u JOIN roles r ON r.id = u.role_id
       WHERE u.id = $1 AND u.store_id = $2`,
      [req.params.id, req.user.store_id]
    );
    const target = targetResult.rows[0];
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (req.user.role === 'manager' && target.role !== 'cashier') {
      return res.status(403).json({ error: 'Managers can delete cashier accounts only' });
    }
    if (target.role === 'admin') {
      const admins = await query(
        `SELECT COUNT(*)::int AS count
         FROM users u JOIN roles r ON r.id = u.role_id
         WHERE u.store_id = $1 AND r.name = 'admin'`,
        [req.user.store_id]
      );
      if (admins.rows[0].count <= 1) {
        return res.status(400).json({ error: 'A store must keep at least one admin' });
      }
    }
    await query(
      `UPDATE users SET is_active = false, updated_at = NOW()
       WHERE id = $1 AND store_id = $2`,
      [req.params.id, req.user.store_id]
    );
    await query('DELETE FROM refresh_tokens WHERE user_id = $1', [req.params.id]);
    res.json({ message: 'Staff member archived' });
  } catch (err) { next(err); }
});

export default router;
