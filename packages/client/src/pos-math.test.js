import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateCartTotals, createClientOrderId } from './pos-math.js';

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
