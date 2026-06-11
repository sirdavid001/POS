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

export default router;
