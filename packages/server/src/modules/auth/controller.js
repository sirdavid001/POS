import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { query } from '../../config/database.js';
import config from '../../config/index.js';
import logger from '../../config/logger.js';

export const register = async (req, res, next) => {
  try {
    const { email, password, name, phone } = req.body;

    // Check existing user
    const existing = await query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    // Default to cashier role, first store
    const roleResult = await query("SELECT id FROM roles WHERE name = 'cashier'");
    const storeResult = await query('SELECT id FROM stores LIMIT 1');

    if (!storeResult.rows[0]) {
      return res.status(400).json({ error: 'No store configured. Please set up a store first.' });
    }

    const result = await query(
      `INSERT INTO users (store_id, role_id, email, password_hash, name, phone)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, email, name`,
      [storeResult.rows[0].id, roleResult.rows[0].id, email, passwordHash, name, phone || null]
    );

    logger.info(`User registered: ${email}`);
    res.status(201).json({ message: 'User registered successfully', user: result.rows[0] });
  } catch (err) {
    next(err);
  }
};

export const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const result = await query(
      `SELECT u.id, u.email, u.name, u.password_hash, u.store_id, u.is_active, r.name as role
       FROM users u JOIN roles r ON u.role_id = r.id
       WHERE u.email = $1`,
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = result.rows[0];
    if (!user.is_active) {
      return res.status(403).json({ error: 'Account is deactivated' });
    }

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Generate tokens
    const accessToken = jwt.sign(
      { userId: user.id, role: user.role, storeId: user.store_id },
      config.jwt.secret,
      { expiresIn: config.jwt.expiry }
    );

    const refreshToken = crypto.randomBytes(64).toString('hex');
    const refreshExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await query(
      'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
      [user.id, refreshToken, refreshExpiry]
    );

    // Update last login
    await query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id]);

    res.json({
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        storeId: user.store_id,
      },
    });
  } catch (err) {
    next(err);
  }
};

export const refreshAccessToken = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;

    const result = await query(
      `SELECT rt.*, u.id as user_id, u.store_id, r.name as role
       FROM refresh_tokens rt
       JOIN users u ON rt.user_id = u.id
       JOIN roles r ON u.role_id = r.id
       WHERE rt.token = $1 AND rt.expires_at > NOW()`,
      [refreshToken]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }

    const tokenData = result.rows[0];

    // Generate new access token
    const accessToken = jwt.sign(
      { userId: tokenData.user_id, role: tokenData.role, storeId: tokenData.store_id },
      config.jwt.secret,
      { expiresIn: config.jwt.expiry }
    );

    res.json({ accessToken });
  } catch (err) {
    next(err);
  }
};

export const logout = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) {
      await query('DELETE FROM refresh_tokens WHERE token = $1', [refreshToken]);
    }
    res.json({ message: 'Logged out successfully' });
  } catch (err) {
    next(err);
  }
};

export const getMe = async (req, res) => {
  res.json({ user: req.user });
};
