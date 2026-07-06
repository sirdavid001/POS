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

export function createClientOrderId() {
  return globalThis.crypto?.randomUUID?.()
    || `order-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
