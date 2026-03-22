import { Router } from 'express';
import { query } from '../../config/database.js';
import { authenticate, authorize } from '../../middleware/auth.js';

const router = Router();
router.use(authenticate);

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
router.get('/users', authorize('admin'), async (req, res, next) => {
  try {
    const result = await query(
      `SELECT u.id, u.email, u.name, u.phone, u.is_active, u.last_login, u.created_at, r.name as role
       FROM users u JOIN roles r ON u.role_id = r.id
       WHERE u.store_id = $1 ORDER BY u.created_at DESC`,
      [req.user.store_id]
    );
    res.json({ users: result.rows });
  } catch (err) { next(err); }
});

// PATCH update user role/status
router.patch('/users/:id', authorize('admin'), async (req, res, next) => {
  try {
    const { role, is_active } = req.body;
    let roleId = null;

    if (role) {
      const roleResult = await query('SELECT id FROM roles WHERE name = $1', [role]);
      if (roleResult.rows.length === 0) return res.status(400).json({ error: 'Invalid role' });
      roleId = roleResult.rows[0].id;
    }

    const result = await query(
      `UPDATE users SET
        role_id = COALESCE($1, role_id),
        is_active = COALESCE($2, is_active),
        updated_at = NOW()
       WHERE id = $3 AND store_id = $4 RETURNING id, email, name, is_active`,
      [roleId, is_active, req.params.id, req.user.store_id]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json({ user: result.rows[0] });
  } catch (err) { next(err); }
});

export default router;
