import { query } from '../../config/database.js';

export const getProducts = async (req, res, next) => {
  try {
    const { page = 1, limit = 50, search, category_id, sort = 'name', order = 'asc' } = req.query;
    const offset = (page - 1) * limit;
    const storeId = req.user.store_id;

    let sql = `
      SELECT p.*, c.name as category_name
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.store_id = $1
    `;
    const params = [storeId];
    let paramIndex = 2;

    if (search) {
      sql += ` AND (p.name ILIKE $${paramIndex} OR p.sku ILIKE $${paramIndex} OR p.barcode ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    if (category_id) {
      sql += ` AND p.category_id = $${paramIndex}`;
      params.push(category_id);
      paramIndex++;
    }

    const allowedSorts = ['name', 'price', 'stock_quantity', 'created_at'];
    const sortCol = allowedSorts.includes(sort) ? sort : 'name';
    const sortOrder = order === 'desc' ? 'DESC' : 'ASC';
    sql += ` ORDER BY p.${sortCol} ${sortOrder}`;
    sql += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);

    const result = await query(sql, params);

    // Get total count
    let countSql = 'SELECT COUNT(*) FROM products WHERE store_id = $1';
    const countParams = [storeId];
    if (search) {
      countSql += ` AND (name ILIKE $2 OR sku ILIKE $2 OR barcode ILIKE $2)`;
      countParams.push(`%${search}%`);
    }
    const countResult = await query(countSql, countParams);

    res.json({
      products: result.rows,
      total: parseInt(countResult.rows[0].count),
      page: parseInt(page),
      limit: parseInt(limit),
    });
  } catch (err) {
    next(err);
  }
};

export const getProduct = async (req, res, next) => {
  try {
    const result = await query(
      `SELECT p.*, c.name as category_name FROM products p
       LEFT JOIN categories c ON p.category_id = c.id
       WHERE p.id = $1 AND p.store_id = $2`,
      [req.params.id, req.user.store_id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Product not found' });
    res.json({ product: result.rows[0] });
  } catch (err) {
    next(err);
  }
};

export const createProduct = async (req, res, next) => {
  try {
    const { name, description, category_id, sku, barcode, price, cost_price, stock_quantity, low_stock_threshold } = req.body;
    const result = await query(
      `INSERT INTO products (store_id, category_id, name, description, sku, barcode, price, cost_price, stock_quantity, low_stock_threshold)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [req.user.store_id, category_id || null, name, description || null, sku || null, barcode || null, price, cost_price || 0, stock_quantity, low_stock_threshold]
    );
    res.status(201).json({ product: result.rows[0] });
  } catch (err) {
    next(err);
  }
};

export const updateProduct = async (req, res, next) => {
  try {
    const fields = req.body;
    const sets = [];
    const params = [];
    let i = 1;

    for (const [key, value] of Object.entries(fields)) {
      sets.push(`${key} = $${i}`);
      params.push(value);
      i++;
    }

    if (sets.length === 0) return res.status(400).json({ error: 'No fields to update' });

    sets.push(`updated_at = NOW()`);
    params.push(req.params.id, req.user.store_id);

    const result = await query(
      `UPDATE products SET ${sets.join(', ')} WHERE id = $${i} AND store_id = $${i + 1} RETURNING *`,
      params
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Product not found' });
    res.json({ product: result.rows[0] });
  } catch (err) {
    next(err);
  }
};

export const deleteProduct = async (req, res, next) => {
  try {
    const result = await query(
      'DELETE FROM products WHERE id = $1 AND store_id = $2 RETURNING id',
      [req.params.id, req.user.store_id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Product not found' });
    res.json({ message: 'Product deleted' });
  } catch (err) {
    next(err);
  }
};

export const getLowStock = async (req, res, next) => {
  try {
    const result = await query(
      `SELECT p.*, c.name as category_name FROM products p
       LEFT JOIN categories c ON p.category_id = c.id
       WHERE p.store_id = $1 AND p.stock_quantity <= p.low_stock_threshold AND p.is_active = true
       ORDER BY p.stock_quantity ASC`,
      [req.user.store_id]
    );
    res.json({ products: result.rows });
  } catch (err) {
    next(err);
  }
};
