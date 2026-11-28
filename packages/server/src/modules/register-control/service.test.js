import { describe, expect, it, vi } from 'vitest';
import {
  badgeDigest, canIssueBadge, canManageStaff, issueBadge, requireMatchingBasket, resolveBadge,
  updateBasket, withRegisterTransaction,
} from './service.js';

describe('staff badges', () => {
  it('uses a strong Code 128-friendly token and persists only a digest', () => {
    const codes = Array.from({ length: 20 }, issueBadge);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.every((code) => /^QPB[0-9]{38}$/.test(code))).toBe(true);
    expect(badgeDigest(codes[0])).toMatch(/^[a-f0-9]{64}$/);
    expect(badgeDigest(codes[0])).not.toContain(codes[0]);
  });
  it('looks up active staff only within the requesting store', async () => {
    const code = issueBadge();
    const query = vi.fn().mockResolvedValue({ rows: [] });
    await expect(resolveBadge({ query }, 18, code)).rejects.toMatchObject({ code: 'BADGE_INVALID' });
    expect(query.mock.calls[0][1]).toEqual([18, badgeDigest(code)]);
    expect(query.mock.calls[0][0]).toMatch(/u\.store_id = \$1.*is_active = true/);
  });
  it('restricts cashier cards to managers and manager or admin cards to admins', () => {
    const manager = { role: 'manager', id: 1 };
    expect(canIssueBadge(manager, { role: 'admin', id: 2 })).toBe(false);
    expect(canIssueBadge(manager, { role: 'manager', id: 2 })).toBe(false);
    expect(canIssueBadge(manager, { role: 'cashier', id: 3 })).toBe(true);
    expect(canIssueBadge(manager, manager)).toBe(false);
    const admin = { role: 'admin', id: 2 };
    expect(canIssueBadge(admin, manager)).toBe(true);
    expect(canIssueBadge(admin, admin)).toBe(true);
    expect(canIssueBadge(admin, { role: 'cashier', id: 3 })).toBe(false);
    expect(canManageStaff({ id: 3, role: 'cashier' }, manager)).toBe(false);
    expect(canIssueBadge({ id: 3, role: 'cashier' }, { id: 3, role: 'cashier' })).toBe(false);
  });
});

describe('register basket', () => {
  const basket = [{ product_id: 2, quantity: 3 }, { product_id: 7, quantity: 1 }];
  it('tracks each reduction without mutating the prior basket', () => {
    expect(updateBasket(basket, 'decrease', 2)).toEqual({
      cart: [{ product_id: 2, quantity: 2 }, { product_id: 7, quantity: 1 }],
      removed: [{ product_id: 2, quantity: 1 }],
    });
    expect(updateBasket(basket, 'remove', 2).removed).toEqual([{ product_id: 2, quantity: 3 }]);
    expect(updateBasket(basket, 'clear')).toEqual({ cart: [], removed: basket });
    expect(basket[0].quantity).toBe(3);
  });
  it('rejects stale, reduced, or substituted baskets at checkout', () => {
    const session = { cart: basket, revision: 5 };
    expect(() => requireMatchingBasket(session, [...basket].reverse(), 5)).not.toThrow();
    expect(() => requireMatchingBasket(session, basket, 4)).toThrow(/changed/);
    expect(() => requireMatchingBasket(session, [basket[0]], 5)).toThrow(/changed/);
    expect(() => requireMatchingBasket(session, [basket[0], basket[0]], 5)).toThrow(/changed/);
    expect(() => requireMatchingBasket(session, [{ ...basket[0], discount: 1 }, basket[1]], 5)).toThrow(/changed/);
  });
  it('rolls back failed register operations and releases the connection', async () => {
    const client = { query: vi.fn(), release: vi.fn() };
    await expect(withRegisterTransaction(async () => client, () => { throw new Error('denied'); })).rejects.toThrow('denied');
    expect(client.query.mock.calls).toEqual([['BEGIN'], ['ROLLBACK']]);
    expect(client.release).toHaveBeenCalledOnce();
  });
});
