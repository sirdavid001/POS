import { Router } from 'express';
import { query } from '../../config/database.js';
import { authenticate, authorize } from '../../middleware/auth.js';
import { requireActiveSubscription } from '../../middleware/subscription.js';
import { validate } from '../../middleware/validate.js';
import { createCategorySchema, updateCategorySchema } from './schema.js';

const router = Router();
router.use(authenticate);
router.use(requireActiveSubscription());

// GET all categories
router.get('/', async (req, res, next) => {
  try {
    const result = await query(
      'SELECT * FROM categories WHERE store_id = $1 ORDER BY name',
      [req.user.store_id]
    );
    res.json({ categories: result.rows });
  } catch (err) { next(err); }
});

// POST create category
router.post('/', authorize('admin', 'manager'), validate(createCategorySchema), async (req, res, next) => {
  try {
    const { name, description, parent_id } = req.body;
    if (parent_id) {
      const parent = await query(
        'SELECT id FROM categories WHERE id = $1 AND store_id = $2',
        [parent_id, req.user.store_id]
      );
      if (!parent.rows[0]) return res.status(400).json({ error: 'Parent category does not belong to this store' });
    }
    const result = await query(
      'INSERT INTO categories (store_id, name, description, parent_id) VALUES ($1,$2,$3,$4) RETURNING *',
      [req.user.store_id, name, description || null, parent_id || null]
    );
    res.status(201).json({ category: result.rows[0] });
  } catch (err) { next(err); }
});

// PATCH update category
router.patch('/:id', authorize('admin', 'manager'), validate(updateCategorySchema), async (req, res, next) => {
  try {
    const { name, description, parent_id } = req.body;
    if (parent_id === req.params.id) {
      return res.status(400).json({ error: 'A category cannot be its own parent' });
    }
    if (parent_id) {
      const parent = await query(
        'SELECT id FROM categories WHERE id = $1 AND store_id = $2',
        [parent_id, req.user.store_id]
      );
      if (!parent.rows[0]) return res.status(400).json({ error: 'Parent category does not belong to this store' });
    }
    const parentProvided = Object.hasOwn(req.body, 'parent_id');
    const result = await query(
      `UPDATE categories SET name = COALESCE($1, name), description = COALESCE($2, description),
       parent_id = CASE WHEN $3 THEN $4 ELSE parent_id END, updated_at = NOW()
       WHERE id = $5 AND store_id = $6 RETURNING *`,
      [name, description, parentProvided, parent_id ?? null, req.params.id, req.user.store_id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Category not found' });
    res.json({ category: result.rows[0] });
  } catch (err) { next(err); }
});

// DELETE category
router.delete('/:id', authorize('admin', 'manager'), async (req, res, next) => {
  try {
    const result = await query(
      'DELETE FROM categories WHERE id = $1 AND store_id = $2 RETURNING id',
      [req.params.id, req.user.store_id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Category not found' });
    res.json({ message: 'Category deleted' });
  } catch (err) { next(err); }
});

export default router;
