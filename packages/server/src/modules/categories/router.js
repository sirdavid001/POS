import { Router } from 'express';
import { query } from '../../config/database.js';
import { authenticate, authorize } from '../../middleware/auth.js';

const router = Router();
router.use(authenticate);

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
router.post('/', authorize('admin', 'manager'), async (req, res, next) => {
  try {
    const { name, description, parent_id } = req.body;
    const result = await query(
      'INSERT INTO categories (store_id, name, description, parent_id) VALUES ($1,$2,$3,$4) RETURNING *',
      [req.user.store_id, name, description || null, parent_id || null]
    );
    res.status(201).json({ category: result.rows[0] });
  } catch (err) { next(err); }
});

// PATCH update category
router.patch('/:id', authorize('admin', 'manager'), async (req, res, next) => {
  try {
    const { name, description, parent_id } = req.body;
    const result = await query(
      `UPDATE categories SET name = COALESCE($1, name), description = COALESCE($2, description),
       parent_id = $3, updated_at = NOW() WHERE id = $4 AND store_id = $5 RETURNING *`,
      [name, description, parent_id ?? null, req.params.id, req.user.store_id]
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
