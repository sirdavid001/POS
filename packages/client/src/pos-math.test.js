import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateCartTotals,
  changeDue,
  createClientOrderId,
  quickCashAmounts,
  resolveDiscount,
} from './pos-math.js';

test('applies an order discount after tax, like the server', () => {
  const totals = calculateCartTotals([{ price: 1000, qty: 2 }], 7.5, 150);
  assert.equal(totals.total, 2000);
});

test('resolves naira and percent discounts and caps them at the bill', () => {
  assert.deepEqual(resolveDiscount({ value: '500', unit: 'amount', billTotal: 2150 }), { amount: 500, capped: false });
  assert.deepEqual(resolveDiscount({ value: 10, unit: 'percent', billTotal: 2150 }), { amount: 215, capped: false });
  assert.deepEqual(resolveDiscount({ value: 5000, unit: 'amount', billTotal: 2150 }), { amount: 2150, capped: true });
  assert.deepEqual(resolveDiscount({ value: 'abc', unit: 'amount', billTotal: 2150 }), { amount: 0, capped: false });
  assert.deepEqual(resolveDiscount({ value: -20, unit: 'percent', billTotal: 2150 }), { amount: 0, capped: false });
});

test('suggests the exact amount and the next round notes', () => {
  assert.deepEqual(quickCashAmounts(13330), [13330, 13500, 14000, 15000]);
  assert.deepEqual(quickCashAmounts(5000), [5000]);
  assert.deepEqual(quickCashAmounts(350), [350, 500, 1000, 5000]);
});

test('works out change, or null when the cash is short', () => {
  assert.equal(changeDue(15000, 13330), 1670);
  assert.equal(changeDue(13330, 13330), 0);
  assert.equal(changeDue(10000, 13330), null);
});

test('calculates the amount shown at checkout including tax', () => {
  assert.deepEqual(calculateCartTotals([
    { price: 350, qty: 2 },
    { price: 200, qty: 1 },
  ], 7.5), {
    subtotal: 900,
    tax: 67.5,
    discount: 0,
    total: 967.5,
  });
});

test('creates stable non-empty client order identifiers', () => {
  const first = createClientOrderId();
  const second = createClientOrderId();
  assert.ok(first.length >= 8);
  assert.notEqual(first, second);
});
