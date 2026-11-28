import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { canIssueStaffCard } from '../../../../shared/src/staff-card-access.js';

// A long numeric suffix lets Code 128 compress pairs of digits on a wallet-size card.
export const issueBadge = () => `QPB${BigInt(`0x${randomBytes(15).toString('hex')}`).toString().padStart(38, '0')}`;
export const badgeDigest = (badge) => createHash('sha256').update(badge).digest('hex');
export const privileged = (role) => role === 'manager' || role === 'admin';
export const canManageStaff = (actor, subject) => actor.id === subject.id ||
  actor.role === 'admin' || (actor.role === 'manager' && subject.role === 'cashier');
export const canIssueBadge = (actor, subject) => canIssueStaffCard(actor.role, subject.role);

export class RegisterError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function registerPolicy(client, storeId) {
  const { rows: [row] } = await client.query(
    'SELECT badge_checkout_required FROM stores WHERE id = $1 FOR SHARE', [storeId]
  );
  return Boolean(row?.badge_checkout_required);
}

export async function audit(client, actor, entity, entityId, action, details = {}) {
  await client.query(
    `INSERT INTO audit_logs (store_id, user_id, entity_type, entity_id, action, new_values)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [actor.store_id, actor.id, entity, entityId, action, JSON.stringify({
      ...details, actor_name: actor.name, actor_role: actor.role,
    })]
  );
}

export async function withRegisterTransaction(getClient, work) {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function resolveBadge(client, storeId, badge) {
  const { rows: [member] } = await client.query(
    `SELECT u.id, u.store_id, u.name, u.staff_badge_hash, r.name AS role
     FROM users u JOIN roles r ON r.id = u.role_id
     WHERE u.store_id = $1 AND u.staff_badge_hash = $2 AND u.is_active = true
     FOR SHARE OF u`,
    [storeId, badgeDigest(badge)]
  );
  if (!member) throw new RegisterError(403, 'This badge is not active for this store.', 'BADGE_INVALID');
  return member;
}

export function presentSession(session) {
  return {
    id: session.id, cashier: { id: session.cashier_id, name: session.cashier_name },
    cart: session.cart, revision: session.revision, expires_at: session.expires_at,
  };
}

export async function presentRegisterBasket(client, storeId, session) {
  if (!session.cart.length) return session;
  const { rows } = await client.query(
    'SELECT id, name, price, stock_quantity FROM products WHERE store_id = $1 AND id = ANY($2::int[])',
    [storeId, session.cart.map((line) => line.product_id)]
  );
  const lookup = new Map(rows.map((product) => [product.id, product]));
  return { ...session, cart: session.cart.map((line) => {
    const product = lookup.get(line.product_id);
    return product ? { ...line, name: product.name, price: product.price, stock_quantity: product.stock_quantity } : line;
  }) };
}

export async function loadSession(client, actor, id) {
  if (!id) throw new RegisterError(403, 'Scan a staff badge to open a register session.', 'BADGE_SESSION_REQUIRED');
  const { rows: [session] } = await client.query(
    `SELECT s.*, u.name AS cashier_name, r.name AS cashier_role
     FROM register_sessions s JOIN users u ON u.id = s.cashier_id AND u.store_id = s.store_id
     JOIN roles r ON r.id = u.role_id
     WHERE s.id = $1 AND s.store_id = $2 AND s.host_id = $3 AND s.closed_at IS NULL
       AND s.expires_at > NOW() AND u.is_active = true AND u.staff_badge_hash = s.badge_hash
       AND (u.id = s.host_id OR r.name = 'cashier')
     FOR UPDATE OF s FOR SHARE OF u`,
    [id, actor.store_id, actor.id]
  );
  if (!session) throw new RegisterError(403, 'Register session expired or badge revoked. Scan a staff badge again.', 'BADGE_SESSION_REQUIRED');
  return session;
}

export async function startSession(client, actor, badge, terminalId) {
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
    `register:${actor.store_id}:${actor.id}:${terminalId}`,
  ]);
  const { rows: [existing] } = await client.query(
    `SELECT s.*, (s.expires_at > NOW() AND u.is_active AND u.staff_badge_hash = s.badge_hash
        AND (u.id = s.host_id OR r.name = 'cashier')) AS usable
     FROM register_sessions s JOIN users u ON u.id = s.cashier_id AND u.store_id = s.store_id
     JOIN roles r ON r.id = u.role_id
     WHERE s.store_id = $1 AND s.host_id = $2 AND s.terminal_id = $3 AND s.closed_at IS NULL
     FOR UPDATE OF s FOR SHARE OF u`,
    [actor.store_id, actor.id, terminalId]
  );
  const member = await resolveBadge(client, actor.store_id, badge);
  if (member.id !== actor.id && member.role !== 'cashier') {
    throw new RegisterError(403, 'Use your own badge or scan a cashier badge to open the register.', 'BADGE_ROLE');
  }
  if (existing?.usable && existing.cashier_id === member.id) {
    return presentSession({ ...existing, cashier_name: member.name });
  }
  if (existing?.usable && existing.cart.length) {
    throw new RegisterError(409, 'The previous cashier must scan their badge, then complete or clear the basket.', 'BASKET_NOT_EMPTY');
  }
  if (existing) {
    await client.query('UPDATE register_sessions SET closed_at = NOW() WHERE id = $1 AND store_id = $2', [existing.id, actor.store_id]);
  }
  const { rows: [session] } = await client.query(
    `INSERT INTO register_sessions (id, store_id, host_id, cashier_id, badge_hash, terminal_id, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW() + INTERVAL '8 hours') RETURNING *`,
    [randomUUID(), actor.store_id, actor.id, member.id, member.staff_badge_hash, terminalId]
  );
  await audit(client, member, 'register', null, 'register_opened', { terminal_user_id: actor.id });
  return presentSession({ ...session, cashier_name: member.name });
}

export function updateBasket(cart, operation, productId) {
  const line = cart.find((item) => item.product_id === productId);
  if (operation === 'clear') return { cart: [], removed: cart };
  if (operation === 'add') {
    if (line) return { cart: cart.map((item) => item === line ? { ...item, quantity: item.quantity + 1 } : item) };
    if (cart.length >= 250) throw new RegisterError(400, 'The basket has reached its item limit.', 'BASKET_LIMIT');
    return { cart: [...cart, { product_id: productId, quantity: 1 }] };
  }
  if (!line) throw new RegisterError(409, 'This item is no longer in the basket.', 'BASKET_CHANGED');
  const quantity = operation === 'decrease' ? 1 : line.quantity;
  return {
    cart: line.quantity === quantity
      ? cart.filter((item) => item !== line)
      : cart.map((item) => item === line ? { ...item, quantity: item.quantity - quantity } : item),
    removed: [{ product_id: productId, quantity }],
  };
}

export function requireMatchingBasket(session, items, revision) {
  const expected = new Map(session.cart.map((item) => [item.product_id, item.quantity]));
  if (session.revision !== revision || items.length !== expected.size || expected.size === 0 ||
      !items.every(({ product_id, quantity, discount }) => !discount && expected.get(product_id) === quantity && expected.delete(product_id))) {
    throw new RegisterError(409, 'The register basket changed. Review it before completing the sale.', 'BASKET_CHANGED');
  }
}
