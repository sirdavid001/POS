export function calculateCartTotals(cart, taxRate = 0, discount = 0) {
  const subtotal = cart.reduce(
    (sum, item) => sum + (Number(item.price || 0) * Number(item.qty || 0)),
    0,
  );
  const safeTaxRate = Math.max(0, Number(taxRate || 0));
  const safeDiscount = Math.max(0, Number(discount || 0));
  const tax = subtotal * (safeTaxRate / 100);
  return {
    subtotal,
    tax,
    discount: safeDiscount,
    total: Math.max(0, subtotal + tax - safeDiscount),
  };
}

export function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

/**
 * Turns what the cashier typed into a discount amount for the order.
 * `unit` is 'amount' (naira off) or 'percent' (percent of the bill before discount).
 * The result never exceeds the bill, matching the server's own check.
 */
export function resolveDiscount({ value, unit = 'amount', billTotal }) {
  const bill = Math.max(0, roundMoney(billTotal));
  const raw = Math.max(0, Number(value) || 0);
  const requested = unit === 'percent' ? (bill * Math.min(raw, 100)) / 100 : raw;
  const amount = roundMoney(Math.min(requested, bill));
  return { amount, capped: requested > bill };
}

/** Exact amount plus the next round notes a customer is likely to hand over. */
export function quickCashAmounts(total) {
  const exact = roundMoney(total);
  const rounded = [500, 1000, 5000]
    .map((step) => Math.ceil(exact / step) * step)
    .filter((amount) => amount > exact);
  return [exact, ...new Set(rounded)].slice(0, 4);
}

/** Change to give back; null when the cash received does not cover the total. */
export function changeDue(received, total) {
  const paid = roundMoney(received);
  const due = roundMoney(total);
  if (paid < due) return null;
  return roundMoney(paid - due);
}

export function createClientOrderId() {
  return globalThis.crypto?.randomUUID?.()
    || `order-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
