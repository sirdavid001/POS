import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { authenticate, authorize } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { query } from '../../config/database.js';
import { profileSchema, storeSchema } from './schema.js';

const router = Router();

router.use(authenticate);
router.use(authorize('admin'));

function addUpdate(updates, params, column, value, expression = null) {
  if (value === undefined) return;
  params.push(value);
  updates.push(`${column} = ${expression || `$${params.length}`}`);
}

router.get('/overview', async (req, res, next) => {
  try {
    const storeResult = await query(
      'SELECT * FROM stores WHERE id = $1',
      [req.user.store_id]
    );

    res.json({
      user: req.user,
      store: storeResult.rows[0] || null,
      subscription: req.subscription,
    });
  } catch (error) {
    next(error);
  }
});

router.patch('/profile', validate(profileSchema), async (req, res, next) => {
  try {
    const { name, phone, email, password } = req.body;
    const updates = [];
    const params = [];

    if (email && email !== req.user.email) {
      const existing = await query(
        'SELECT id FROM users WHERE LOWER(email) = LOWER($1) AND id <> $2',
        [email, req.user.id]
      );
      if (existing.rows.length > 0) {
        return res.status(409).json({ error: 'Email already registered' });
      }
    }

    addUpdate(updates, params, 'name', name);
    addUpdate(updates, params, 'phone', phone);
    addUpdate(updates, params, 'email', email);

    if (password !== undefined) {
      const passwordHash = await bcrypt.hash(password, 12);
      addUpdate(updates, params, 'password_hash', passwordHash);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'Provide at least one profile field to update' });
    }

    params.push(req.user.id, req.user.store_id);
    const result = await query(
      `UPDATE users SET
         ${updates.join(', ')},
         updated_at = NOW()
       WHERE id = $${params.length - 1} AND store_id = $${params.length}
       RETURNING id, email, name, phone, store_id`,
      params
    );

    res.json({
      user: {
        ...result.rows[0],
        role: req.user.role,
        storeId: result.rows[0].store_id,
      },
      subscription: req.subscription,
    });
  } catch (error) {
    next(error);
  }
});

router.patch('/store', validate(storeSchema), async (req, res, next) => {
  try {
    const {
      name,
      address,
      phone,
      email,
      tax_rate: taxRate,
      currency,
      receipt_header: receiptHeader,
      receipt_footer: receiptFooter,
    } = req.body;
    const updates = [];
    const params = [];

    addUpdate(updates, params, 'name', name);
    addUpdate(updates, params, 'address', address);
    addUpdate(updates, params, 'phone', phone);
    addUpdate(updates, params, 'email', typeof email === 'string' ? email.toLowerCase() : email);
    addUpdate(updates, params, 'tax_rate', taxRate);
    addUpdate(updates, params, 'currency', currency?.toUpperCase());
    addUpdate(updates, params, 'receipt_header', receiptHeader);
    addUpdate(updates, params, 'receipt_footer', receiptFooter);

    if (updates.length === 0) {
      return res.status(400).json({ error: 'Provide at least one store field to update' });
    }

    params.push(req.user.store_id);
    const result = await query(
      `UPDATE stores SET
         ${updates.join(', ')},
         updated_at = NOW()
       WHERE id = $${params.length}
       RETURNING *`,
      params
    );

    res.json({ store: result.rows[0], subscription: req.subscription });
  } catch (error) {
    next(error);
  }
});

router.patch('/staff/:id', async (req, res, next) => {
  try {
    const targetResult = await query(
      `SELECT u.id, u.role_id, u.is_active, r.name AS role
       FROM users u JOIN roles r ON r.id = u.role_id
       WHERE u.id = $1 AND u.store_id = $2`,
      [req.params.id, req.user.store_id]
    );
    const target = targetResult.rows[0];
    if (!target) return res.status(404).json({ error: 'User not found' });

    const { role, is_active, name, email, password, phone } = req.body;
    if (Number(req.params.id) === Number(req.user.id) && (role || is_active === false)) {
      return res.status(400).json({ error: 'You cannot change your own role or deactivate your own account' });
    }
    if (role && !['admin', 'manager', 'cashier'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }
    if (password && password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    let roleId = null;
    if (role) {
      const roleResult = await query('SELECT id FROM roles WHERE name = $1', [role]);
      if (roleResult.rows.length === 0) return res.status(400).json({ error: 'Invalid role' });
      roleId = roleResult.rows[0].id;
    }
    if (target.role === 'admin' && ((role && role !== 'admin') || is_active === false)) {
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
  } catch (error) {
    next(error);
  }
});

router.delete('/staff/:id', async (req, res, next) => {
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
    if (target.role === 'admin') {
      const admins = await query(
        `SELECT COUNT(*)::int AS count
         FROM users u JOIN roles r ON r.id = u.role_id
         WHERE u.store_id = $1 AND r.name = 'admin' AND u.is_active = true`,
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
  } catch (error) {
    next(error);
  }
});

export default router;
