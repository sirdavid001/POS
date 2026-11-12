import { api } from '../api.js';
import { renderLayout } from './layout.js';
import { downloadCSV, escapeHTML, formatCurrency, toast } from '../utils.js';
import { showStoreStatementModal } from './store-statement.js';

const PRESETS = [
  ['today', 'Today'],
  ['yesterday', 'Yesterday'],
  ['7d', 'Last 7 days'],
  ['30d', 'Last 30 days'],
  ['month', 'This month'],
  ['last-month', 'Last month'],
];

function dayKey(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function presetRange(preset, now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const daysAgo = (n) => new Date(today.getFullYear(), today.getMonth(), today.getDate() - n);
  switch (preset) {
    case 'yesterday': return { start: dayKey(daysAgo(1)), end: dayKey(daysAgo(1)) };
    case '7d': return { start: dayKey(daysAgo(6)), end: dayKey(today) };
    case '30d': return { start: dayKey(daysAgo(29)), end: dayKey(today) };
    case 'month': return { start: dayKey(new Date(today.getFullYear(), today.getMonth(), 1)), end: dayKey(today) };
    case 'last-month': return {
      start: dayKey(new Date(today.getFullYear(), today.getMonth() - 1, 1)),
      end: dayKey(new Date(today.getFullYear(), today.getMonth(), 0)),
    };
    default: return { start: dayKey(today), end: dayKey(today) };
  }
}

function presetFor(start, end) {
  return PRESETS.find(([id]) => {
    const range = presetRange(id);
    return range.start === start && range.end === end;
  })?.[0] || 'custom';
}

const formatDay = (key) => new Date(`${key}T00:00:00`).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
const formatPercent = (value) => `${Number(value).toLocaleString('en-NG', { maximumFractionDigits: 1 })}%`;
const plural = (n, word) => `${Number(n).toLocaleString('en-NG')} ${word}${Number(n) === 1 ? '' : 's'}`;
const titleCase = (value) => String(value || '').replace(/(^|_)(\w)/g, (_, gap, letter) => (gap ? ' ' : '') + letter.toUpperCase());

function changeLine(current, previous, label) {
  if (!previous) return current ? `No sales in the previous ${label}` : `No sales in this or the previous ${label}`;
  const change = ((current - previous) / previous) * 100;
  const direction = change > 0.05 ? 'up' : change < -0.05 ? 'down' : 'flat';
  const arrow = direction === 'up' ? '▲' : direction === 'down' ? '▼' : '■';
  return `<span class="trend trend-${direction}"><span aria-hidden="true">${arrow}</span> ${formatPercent(Math.abs(change))}</span> vs previous ${label} (${formatCurrency(previous)})`;
}

function shareTable(rows, labelKey, labelHeading, total) {
  if (!rows.length) return '<p class="report-empty">No sales in this range.</p>';
  return `
    <table class="data-table report-table">
      <thead><tr><th>${labelHeading}</th><th class="num">Orders</th><th class="num">Revenue</th><th class="num">Share</th></tr></thead>
      <tbody>
        ${rows.map((row) => {
          const share = total ? (row.revenue / total) * 100 : 0;
          return `
            <tr>
              <td>${escapeHTML(labelKey === 'method' ? titleCase(row.method) : row[labelKey])}</td>
              <td class="num">${row.orders.toLocaleString('en-NG')}</td>
              <td class="num">${formatCurrency(row.revenue)}</td>
              <td class="num"><span class="share-bar" aria-hidden="true"><span style="width:${share.toFixed(1)}%"></span></span>${formatPercent(share)}</td>
            </tr>`;
        }).join('')}
      </tbody>
    </table>`;
}

export async function renderReports() {
  const content = renderLayout('reports');
  const hashParams = new URLSearchParams(window.location.hash.split('?')[1] || '');
  let range = hashParams.get('start') && hashParams.get('end')
    ? { start: hashParams.get('start'), end: hashParams.get('end') }
    : presetRange('month');
  let insights = null;

  content.innerHTML = `
    <div class="animate-fade-in">
      <div class="page-header">
        <h1>Reports</h1>
        <div class="report-header-actions">
          <button class="btn btn-ghost btn-sm" type="button" id="export-csv-btn">Export CSV</button>
          <button class="btn btn-primary btn-sm" type="button" id="open-statement-btn">Store statement</button>
        </div>
      </div>

      <section class="report-range glass-card" aria-label="Date range">
        <div class="report-presets" role="group" aria-label="Quick ranges">
          ${PRESETS.map(([id, label]) => `<button type="button" class="category-chip" data-preset="${id}" aria-pressed="false">${label}</button>`).join('')}
        </div>
        <form class="report-custom" id="report-custom">
          <label class="sr-only" for="report-start">Start date</label>
          <input class="input" type="date" id="report-start" required>
          <span aria-hidden="true">to</span>
          <label class="sr-only" for="report-end">End date</label>
          <input class="input" type="date" id="report-end" required>
          <button class="btn btn-ghost btn-sm" type="submit">Apply</button>
        </form>
        <p class="report-range-label" id="report-range-label" aria-live="polite"></p>
      </section>

      <div class="stat-grid" id="report-stats" aria-busy="true">
        <div class="stat-card"><div class="spinner"></div></div>
      </div>

      <div class="responsive-grid-2 report-grid">
        <section class="glass-card report-card" aria-labelledby="pay-heading">
          <h2 id="pay-heading">Sales by payment method</h2>
          <div class="table-scroll-wrapper" id="report-payments"><div class="spinner"></div></div>
        </section>
        <section class="glass-card report-card" aria-labelledby="cashier-heading">
          <h2 id="cashier-heading">Sales by cashier</h2>
          <div class="table-scroll-wrapper" id="report-cashiers"><div class="spinner"></div></div>
        </section>
      </div>

      <section class="glass-card report-card" aria-labelledby="product-heading">
        <div class="report-card-head">
          <h2 id="product-heading">Profit by product</h2>
          <p id="report-profit-note"></p>
        </div>
        <div class="table-scroll-wrapper" id="report-products"><div class="spinner"></div></div>
      </section>

      <section class="glass-card report-card" aria-labelledby="daily-heading">
        <h2 id="daily-heading">Sales by day</h2>
        <div class="table-scroll-wrapper" id="sales-breakdown"><div class="spinner"></div></div>
      </section>
    </div>
  `;

  const startInput = document.getElementById('report-start');
  const endInput = document.getElementById('report-end');

  function syncRangeControls() {
    startInput.value = range.start;
    endInput.value = range.end;
    const preset = presetFor(range.start, range.end);
    document.querySelectorAll('[data-preset]').forEach((chip) => chip.setAttribute('aria-pressed', String(chip.dataset.preset === preset)));
    document.getElementById('report-range-label').textContent = range.start === range.end
      ? formatDay(range.start)
      : `${formatDay(range.start)} – ${formatDay(range.end)}`;
    history.replaceState(null, '', `#/reports?start=${range.start}&end=${range.end}`);
  }

  function renderInsights(data) {
    const { summary, previous, refunds, profit } = data;
    const days = data.range.days;
    const periodLabel = days === 1 ? 'day' : `${days} days`;
    document.getElementById('report-stats').removeAttribute('aria-busy');
    document.getElementById('report-stats').innerHTML = `
      <div class="stat-card">
        <div class="stat-label">Revenue</div>
        <div class="stat-value">${formatCurrency(summary.revenue)}</div>
        <div class="stat-change">${changeLine(summary.revenue, previous.revenue, periodLabel)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Orders</div>
        <div class="stat-value">${summary.orders.toLocaleString('en-NG')}</div>
        <div class="stat-change">${summary.orders ? `Average ${formatCurrency(summary.average_order)} · ${plural(summary.items_sold, 'item')} sold` : 'No completed sales'}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Gross profit (estimate)</div>
        <div class="stat-value">${profit.costed_share > 0 ? formatCurrency(profit.gross_profit) : '—'}</div>
        <div class="stat-change">${profit.costed_share > 0
          ? `${profit.margin !== null ? `${formatPercent(profit.margin)} margin · ` : ''}from ${formatPercent(profit.costed_share)} of sales with a cost price`
          : 'Add cost prices to products to see profit'}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Refunds</div>
        <div class="stat-value">${formatCurrency(refunds.total)}</div>
        <div class="stat-change">${refunds.count ? plural(refunds.count, 'refund') : 'No refunds'} · ${formatCurrency(summary.discounts)} in discounts</div>
      </div>
    `;

    document.getElementById('report-payments').innerHTML = shareTable(data.payment_methods, 'method', 'Method', summary.revenue);
    document.getElementById('report-cashiers').innerHTML = shareTable(data.cashiers, 'cashier', 'Cashier', summary.revenue);

    document.getElementById('report-profit-note').textContent = profit.costed_share < 100 && summary.orders
      ? 'Profit uses each product’s current cost price. Products without a cost price show a dash.'
      : 'Profit uses each product’s current cost price.';
    document.getElementById('report-products').innerHTML = data.products.length ? `
      <table class="data-table report-table">
        <thead><tr><th>Product</th><th class="num">Qty</th><th class="num">Revenue</th><th class="num">Cost</th><th class="num">Profit</th><th class="num">Margin</th></tr></thead>
        <tbody>
          ${data.products.map((row) => `
            <tr>
              <td>${escapeHTML(row.product_name)}</td>
              <td class="num">${row.quantity.toLocaleString('en-NG')}</td>
              <td class="num">${formatCurrency(row.revenue)}</td>
              <td class="num">${row.cost === null ? '—' : formatCurrency(row.cost)}</td>
              <td class="num ${row.profit !== null && row.profit < 0 ? 'negative' : ''}">${row.profit === null ? '—' : formatCurrency(row.profit)}</td>
              <td class="num">${row.profit === null || !row.revenue ? '—' : formatPercent((row.profit / row.revenue) * 100)}</td>
            </tr>`).join('')}
        </tbody>
      </table>` : '<p class="report-empty">No products sold in this range.</p>';
  }

  async function loadDaily() {
    const target = document.getElementById('sales-breakdown');
    try {
      const data = await api.get(`/reports/sales?period=daily&start_date=${range.start}&end_date=${range.end}T23:59:59`);
      const rows = (data.sales || []).filter((row) => row.period >= range.start && row.period <= range.end);
      target.innerHTML = rows.length ? `
        <table class="data-table report-table">
          <thead><tr><th>Day</th><th class="num">Orders</th><th class="num">Revenue</th><th class="num">Discounts</th><th class="num">Avg order</th></tr></thead>
          <tbody>
            ${rows.map((row) => `
              <tr>
                <td>${escapeHTML(formatDay(row.period))}</td>
                <td class="num">${Number(row.total_orders).toLocaleString('en-NG')}</td>
                <td class="num">${formatCurrency(row.revenue)}</td>
                <td class="num">${formatCurrency(row.total_discounts || 0)}</td>
                <td class="num">${formatCurrency(row.avg_order_value)}</td>
              </tr>`).join('')}
          </tbody>
        </table>` : '<p class="report-empty">No sales in this range.</p>';
    } catch {
      target.innerHTML = '<p class="report-empty">Daily sales are not available right now.</p>';
    }
  }

  async function load() {
    syncRangeControls();
    document.getElementById('report-stats').setAttribute('aria-busy', 'true');
    try {
      insights = await api.get(`/reports/insights?start=${range.start}&end=${range.end}`);
      if (!insights?.summary) throw new Error('Reports for this range are not saved on this device yet.');
      renderInsights(insights);
    } catch (err) {
      insights = null;
      document.getElementById('report-stats').innerHTML = `<div class="stat-card report-error" role="alert">${escapeHTML(err.message || 'Could not load reports')}. Check the connection and try again.</div>`;
      ['report-payments', 'report-cashiers', 'report-products'].forEach((id) => { document.getElementById(id).innerHTML = ''; });
    }
    loadDaily();
  }

  document.querySelectorAll('[data-preset]').forEach((chip) => chip.addEventListener('click', () => {
    range = presetRange(chip.dataset.preset);
    load();
  }));
  document.getElementById('report-custom').addEventListener('submit', (event) => {
    event.preventDefault();
    if (!startInput.value || !endInput.value || endInput.value < startInput.value) {
      toast('Choose an end date on or after the start date', 'warning');
      return;
    }
    range = { start: startInput.value, end: endInput.value };
    load();
  });

  document.getElementById('open-statement-btn').addEventListener('click', () => {
    showStoreStatementModal({ start_date: range.start, end_date: range.end });
  });

  document.getElementById('export-csv-btn').addEventListener('click', () => {
    if (!insights?.products?.length) {
      toast('No sales to export for this range', 'warning');
      return;
    }
    downloadCSV(insights.products.map((row) => ({
      Product: row.product_name,
      Quantity: row.quantity,
      Revenue: row.revenue,
      Cost: row.cost ?? '',
      Profit: row.profit ?? '',
    })), `QuickPOS_Report_${range.start}_to_${range.end}.csv`);
  });

  await load();
}
