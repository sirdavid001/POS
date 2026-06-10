import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { getClient, query } from '../../config/database.js';
import config from '../../config/index.js';
import logger from '../../config/logger.js';
import { createTrial, getStoreSubscription } from '../billing/subscription.js';
import { sendBillingEmail } from '../billing/email.js';
import { sendPasswordResetEmail } from './email.js';
import {
  buildPasswordResetUrl,
  createPasswordResetToken,
  hashPasswordResetToken,
} from './password-reset.js';

const PASSWORD_RESET_RESPONSE =
  'If an active account exists for that email, a password reset link has been sent.';

export const register = async (req, res, next) => {
  let client;
  try {
    client = await getClient();
    const { email, password, name, phone, store_name: storeName } = req.body;
    await client.query('BEGIN');

    const existing = await client.query('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [email]);
    if (existing.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const roleResult = await client.query("SELECT id FROM roles WHERE name = 'admin'");
    if (!roleResult.rows[0]) {
      throw new Error('Admin role is not configured. Run database seeding first.');
    }

    const storeResult = await client.query(
      `INSERT INTO stores (name, email, phone)
       VALUES ($1, LOWER($2), $3)
       RETURNING id, name, email`,
      [storeName, email, phone || null]
    );
    const store = storeResult.rows[0];

    const result = await client.query(
      `INSERT INTO users (store_id, role_id, email, password_hash, name, phone)
       VALUES ($1, $2, LOWER($3), $4, $5, $6)
       RETURNING id, email, name, store_id`,
      [store.id, roleResult.rows[0].id, email, passwordHash, name, phone || null]
    );
    const subscription = await createTrial(client, store.id);
    await client.query('COMMIT');

    try {
      await sendBillingEmail({
        storeId: store.id,
        to: email,
        type: 'trial_started',
        key: subscription.trial_ends_at,
        subject: 'Your QuickPOS trial has started',
        heading: `Welcome to QuickPOS, ${name}`,
        body: `Your store, ${store.name}, now has all QuickPOS features for seven days. Your trial ends on ${new Date(subscription.trial_ends_at).toLocaleDateString('en-NG')}.`,
      });
    } catch (emailError) {
      logger.warn('Trial email could not be sent', { storeId: store.id, error: emailError.message });
    }

    logger.info(`Owner registered for store ${store.id}: ${email}`);
    res.status(201).json({
      message: 'Store and owner account created successfully',
      user: { ...result.rows[0], role: 'admin' },
      store,
      subscription,
    });
  } catch (err) {
    if (client) await client.query('ROLLBACK');
    next(err);
  } finally {
    client?.release();
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
    const subscription = await getStoreSubscription(user.store_id);

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
      subscription,
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

    const subscription = await getStoreSubscription(tokenData.store_id);
    res.json({ accessToken, subscription });
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

export const forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;
    const result = await query(
      `SELECT u.id, u.email, u.name, u.store_id, s.name AS store_name
       FROM users u
       JOIN stores s ON s.id = u.store_id
       WHERE LOWER(u.email) = LOWER($1) AND u.is_active = true`,
      [email]
    );
    const user = result.rows[0];

    if (!user) {
      return res.json({ message: PASSWORD_RESET_RESPONSE });
    }

    const token = createPasswordResetToken();
    const tokenHash = hashPasswordResetToken(token);
    const expiresAt = new Date(
      Date.now() + config.auth.passwordResetExpiryMinutes * 60 * 1000
    );
    const resetUrl = buildPasswordResetUrl(config.auth.passwordResetUrl, token);
    const client = await getClient();

    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE password_reset_tokens
         SET used_at = NOW()
         WHERE user_id = $1 AND used_at IS NULL`,
        [user.id]
      );
      await client.query(
        `INSERT INTO password_reset_tokens
         (user_id, token_hash, expires_at, requested_ip, user_agent)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          user.id,
          tokenHash,
          expiresAt,
          req.ip || null,
          req.get('user-agent') || null,
        ]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    try {
      const delivery = await sendPasswordResetEmail({
        to: user.email,
        name: user.name,
        storeName: user.store_name,
        resetUrl,
        expiresInMinutes: config.auth.passwordResetExpiryMinutes,
      });
      if (delivery.skipped) {
        logger.warn('Password reset email skipped because email delivery is not configured', {
          userId: user.id,
          storeId: user.store_id,
        });
      }
    } catch (emailError) {
      logger.error('Password reset email could not be sent', {
        userId: user.id,
        storeId: user.store_id,
        error: emailError.message,
      });
    }

    res.json({ message: PASSWORD_RESET_RESPONSE });
  } catch (err) {
    next(err);
  }
};

export const resetPassword = async (req, res, next) => {
  let client;
  try {
    const { token, password } = req.body;
    const tokenHash = hashPasswordResetToken(token);
    client = await getClient();
    await client.query('BEGIN');

    const result = await client.query(
      `SELECT prt.id, prt.user_id
       FROM password_reset_tokens prt
       JOIN users u ON u.id = prt.user_id
       WHERE prt.token_hash = $1
         AND prt.used_at IS NULL
         AND prt.expires_at > NOW()
         AND u.is_active = true
       FOR UPDATE`,
      [tokenHash]
    );
    const reset = result.rows[0];

    if (!reset) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Reset link is invalid or has expired' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    await client.query(
      'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
      [passwordHash, reset.user_id]
    );
    await client.query(
      `UPDATE password_reset_tokens
       SET used_at = NOW()
       WHERE user_id = $1 AND used_at IS NULL`,
      [reset.user_id]
    );
    await client.query('DELETE FROM refresh_tokens WHERE user_id = $1', [reset.user_id]);
    await client.query('COMMIT');

    logger.info('Password reset completed', { userId: reset.user_id });
    res.json({ message: 'Password reset successfully. Sign in with your new password.' });
  } catch (err) {
    if (client) await client.query('ROLLBACK');
    next(err);
  } finally {
    client?.release();
  }
};

export const getMe = async (req, res) => {
  res.json({ user: req.user, subscription: req.subscription });
};
