// Owner insights shared by the API (SQL aggregates) and the app (offline, from saved orders),
// so both report the same numbers for the same sales.

const DAY_MS = 86400000;

function toDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(date.getTime()) ? null : date;
}

function toKey(date) {
  return date.toISOString().slice(0, 10);
}

/** Inclusive date range plus the equally long period just before it, as YYYY-MM-DD strings. */
export function insightsRange(start, end) {
  const from = toDate(start);
  const to = toDate(end);
  if (!from || !to || to < from) return null;
  const days = Math.round((to - from) / DAY_MS) + 1;
  const previousEnd = new Date(from.getTime() - DAY_MS);
  const previousStart = new Date(previousEnd.getTime() - (days - 1) * DAY_MS);
  return { start: toKey(from), end: toKey(to), days, previous_start: toKey(previousStart), previous_end: toKey(previousEnd) };
}

const money = (value) => Math.round((Number(value) || 0) * 100) / 100;
const count = (value) => Math.round(Number(value) || 0);

/**
 * Shapes raw totals into the insights response.
 * Order-level discounts cannot be traced to single items, so they are shared across items in
 * proportion to their value. Profit covers only items whose product has a cost price, and
 * `costed_share` says how much of the sales that is.
 */
export function finalizeInsights({ range, summary, previous, refunds, items, paymentMethods = [], cashiers = [], products = [] }) {
  const revenue = money(summary.revenue);
  const orders = count(summary.orders);
  const discounts = money(summary.discounts);
  const itemRevenue = money(items.revenue);
  const costedRevenue = money(items.costed_revenue);
  const cost = money(items.cost);
  const keepRate = itemRevenue > 0 ? Math.max(0, 1 - discounts / itemRevenue) : 1;
  const costedNet = costedRevenue * keepRate;
  const grossProfit = money(costedNet - cost);

  return {
    range,
    summary: {
      revenue,
      orders,
      average_order: orders ? money(revenue / orders) : 0,
      discounts,
      tax: money(summary.tax),
      items_sold: count(items.quantity),
    },
    previous: { revenue: money(previous.revenue), orders: count(previous.orders) },
    refunds: { count: count(refunds.count), total: money(refunds.total) },
    profit: {
      net_sales: money(itemRevenue - discounts),
      cost,
      gross_profit: grossProfit,
      margin: costedNet > 0 ? Math.round((grossProfit / costedNet) * 1000) / 10 : null,
      costed_share: itemRevenue > 0 ? Math.round((costedRevenue / itemRevenue) * 1000) / 10 : 0,
    },
    payment_methods: paymentMethods.map((row) => ({ method: row.method || 'cash', orders: count(row.orders), revenue: money(row.revenue) })),
    cashiers: cashiers.map((row) => ({ cashier: row.cashier || 'Unknown', orders: count(row.orders), revenue: money(row.revenue) })),
    products: products.map((row) => {
      const hasCost = row.cost !== null && row.cost !== undefined && Number(row.costed_revenue) > 0;
      return {
        product_name: row.product_name,
        quantity: count(row.quantity),
        revenue: money(row.revenue),
        cost: hasCost ? money(row.cost) : null,
        profit: hasCost ? money(Number(row.costed_revenue) * keepRate - Number(row.cost)) : null,
      };
    }),
  };
}

function inRange(createdAt, start, end) {
  const day = String(createdAt || '').slice(0, 10);
  return day >= start && day <= end;
}

function addTo(map, key, revenue) {
  const row = map.get(key) || { orders: 0, revenue: 0 };
  row.orders += 1;
  row.revenue += Number(revenue) || 0;
  map.set(key, row);
}

/** Same insights computed from orders saved on the device (used offline). */
export function computeInsightsFromOrders({ orders = [], products = [], start, end, productLimit = 25 }) {
  const range = insightsRange(start, end);
  if (!range) return null;
  const costById = new Map(products.map((product) => [String(product.id), Number(product.cost_price) || 0]));

  const summary = { revenue: 0, orders: 0, discounts: 0, tax: 0 };
  const previous = { revenue: 0, orders: 0 };
  const refunds = { count: 0, total: 0 };
  const items = { revenue: 0, quantity: 0, cost: 0, costed_revenue: 0 };
  const payments = new Map();
  const cashiers = new Map();
  const byProduct = new Map();

  for (const order of orders) {
    if (order.status === 'refunded' && inRange(order.updated_at || order.created_at, range.start, range.end)) {
      refunds.count += 1;
      refunds.total += Number(order.total) || 0;
    }
    if (order.status !== 'completed') continue;
    if (inRange(order.created_at, range.previous_start, range.previous_end)) {
      previous.revenue += Number(order.total) || 0;
      previous.orders += 1;
    }
    if (!inRange(order.created_at, range.start, range.end)) continue;

    summary.revenue += Number(order.total) || 0;
    summary.orders += 1;
    summary.discounts += Number(order.discount_amount) || 0;
    summary.tax += Number(order.tax_amount) || 0;
    addTo(payments, order.payment_method || 'cash', order.total);
    addTo(cashiers, order.cashier_name || order.cashier || 'Unknown', order.total);

    for (const item of order.items || []) {
      const quantity = Number(item.quantity) || 0;
      const lineTotal = Number(item.total) || 0;
      const unitCost = costById.get(String(item.product_id)) || 0;
      items.revenue += lineTotal;
      items.quantity += quantity;
      const row = byProduct.get(item.product_name) || { product_name: item.product_name, quantity: 0, revenue: 0, cost: null, costed_revenue: 0 };
      row.quantity += quantity;
      row.revenue += lineTotal;
      if (unitCost > 0) {
        items.cost += unitCost * quantity;
        items.costed_revenue += lineTotal;
        row.cost = (row.cost || 0) + unitCost * quantity;
        row.costed_revenue += lineTotal;
      }
      byProduct.set(item.product_name, row);
    }
  }

  const sortByRevenue = (a, b) => b.revenue - a.revenue;
  return finalizeInsights({
    range,
    summary,
    previous,
    refunds,
    items,
    paymentMethods: [...payments].map(([method, row]) => ({ method, ...row })).sort(sortByRevenue),
    cashiers: [...cashiers].map(([cashier, row]) => ({ cashier, ...row })).sort(sortByRevenue),
    products: [...byProduct.values()].sort(sortByRevenue).slice(0, productLimit),
  });
}
