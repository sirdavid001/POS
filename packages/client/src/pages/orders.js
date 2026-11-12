import { api } from '../api.js';
import { renderLayout } from './layout.js';
import { escapeAttribute, escapeHTML, formatCurrency, formatDateTime, toast, downloadCSV } from '../utils.js';
import { refreshOfflineSnapshot } from '../sync.js';

function statusBadgeClass(status) {
  if (status === 'completed') return 'success';
  if (status === 'cancelled' || status === 'refunded') return 'danger';
  return 'warning';
}

let currentOrdersData = [];

export async function renderOrders() {
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  const content = renderLayout('orders');

  if (user.role === 'cashier') {
    content.innerHTML = `
      <div class="empty-state">
        <p>Order history is available to managers and admins only.</p>
        <a href="#/pos" class="btn btn-primary" style="margin-top:1rem;">Open POS Terminal</a>
      </div>
    `;
    return;
  }

  content.innerHTML = `
    <div class="animate-fade-in">
      <div class="page-header"><h1>Orders</h1></div>
      <div class="filter-row" style="display:flex;gap:1rem;margin-bottom:1rem;justify-content:space-between;align-items:center;">
        <select class="input" id="order-status-filter" style="max-width:180px;">
          <option value="">All Statuses</option>
          <option value="completed">Completed</option>
          <option value="pending">Pending</option>
          <option value="cancelled">Cancelled</option>
          <option value="refunded">Refunded</option>
        </select>
        <button class="btn btn-ghost btn-sm" id="export-orders-csv">⬇️ Export CSV</button>
      </div>
      <div class="glass-card table-scroll-wrapper">
        <table class="data-table">
          <thead><tr><th>Order #</th><th>Cashier</th><th>Customer</th><th>Total</th><th>Payment</th><th>Status</th><th>Date</th><th>Actions</th></tr></thead>
          <tbody id="orders-tbody">
            <tr><td colspan="8" style="text-align:center;padding:2rem;"><div class="spinner" style="margin:auto;"></div></td></tr>
          </tbody>
        </table>
      </div>
    </div>
  `;

  async function loadOrders() {
    try {
      const status = document.getElementById('order-status-filter').value;
      let url = '/orders?limit=50';
      if (status) url += `&status=${status}`;
      const data = await api.get(url);
      currentOrdersData = data.orders;
      const tbody = document.getElementById('orders-tbody');

      if (data.orders.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="empty-state">No orders found</td></tr>';
        return;
      }

      tbody.innerHTML = data.orders.map(o => `
        <tr>
          <td style="font-weight:600;">${escapeHTML(o.order_number)}</td>
          <td>${escapeHTML(o.cashier_name || '-')}</td>
          <td>${escapeHTML(o.customer_name || 'Walk-in')}</td>
          <td style="font-weight:600;">${formatCurrency(o.total)}</td>
          <td><span class="badge badge-info">${(o.payment_method || 'cash').toUpperCase()}</span></td>
          <td><span class="badge badge-${statusBadgeClass(o.status)}">${escapeHTML(o.status)}</span></td>
          <td style="font-size:0.8rem;color:var(--color-text-muted);">${formatDateTime(o.created_at)}</td>
          <td><button class="btn btn-ghost btn-sm view-order" data-id="${escapeAttribute(o.id)}">View</button></td>
        </tr>
      `).join('');

      tbody.querySelectorAll('.view-order').forEach(btn => {
        btn.addEventListener('click', async () => {
          try {
            const res = await api.get('/orders/' + btn.dataset.id);
            showOrderDetail(res.order, loadOrders);
          } catch (err) { toast(err.message, 'error'); }
        });
      });
    } catch { toast('Failed to load orders', 'error'); }
  }

  document.getElementById('order-status-filter').addEventListener('change', loadOrders);
  
  document.getElementById('export-orders-csv').addEventListener('click', () => {
    if (!currentOrdersData.length) return toast('No data to export', 'warning');
    const formattedData = currentOrdersData.map(o => ({
      'Order Number': o.order_number,
      'Cashier': o.cashier_name || 'System',
      'Customer': o.customer_name || 'Walk-in',
      'Total Amount': o.total,
      'Payment Method': (o.payment_method || 'cash').toUpperCase(),
      'Status': o.status,
      'Date': new Date(o.created_at).toLocaleString('en-NG')
    }));
    downloadCSV(formattedData, `QuickPOS_Orders_${new Date().toISOString().split('T')[0]}.csv`);
  });

  await loadOrders();
}

function refundDetails(order) {
  const refund = (order.payments || []).find((payment) => payment.status === 'refunded');
  if (!refund) return '';
  let meta = refund.metadata || {};
  if (typeof meta === 'string') {
    try { meta = JSON.parse(meta); } catch { meta = {}; }
  }
  return `
    <div class="refund-note" role="note">
      <strong>Refunded ${formatCurrency(Math.abs(Number(refund.amount)))}</strong>
      <span>${escapeHTML(formatDateTime(meta.refunded_at || refund.created_at))}${meta.restocked === false ? ' · items not returned to stock' : ' · items returned to stock'}</span>
      ${meta.reason ? `<span>Reason: ${escapeHTML(meta.reason)}</span>` : ''}
    </div>
  `;
}

function showOrderDetail(order, onChanged = () => {}) {
  const canRefund = order.status === 'completed';
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="order-modal-title" style="max-width:500px;">
      <h3 id="order-modal-title" style="font-weight:700;margin-bottom:1rem;">Order ${escapeHTML(order.order_number)}</h3>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;font-size:0.85rem;margin-bottom:1rem;">
        <div><span style="color:var(--color-text-muted);">Cashier:</span> ${escapeHTML(order.cashier_name || '-')}</div>
        <div><span style="color:var(--color-text-muted);">Customer:</span> ${escapeHTML(order.customer_name || 'Walk-in')}</div>
        <div><span style="color:var(--color-text-muted);">Payment:</span> ${escapeHTML((order.payment_method || '').toUpperCase())}</div>
        ${order.payments?.[0]?.reference ? `<div><span style="color:var(--color-text-muted);">Reference:</span> ${escapeHTML(order.payments[0].reference)}</div>` : ''}
        <div><span style="color:var(--color-text-muted);">Status:</span> <span class="badge badge-${statusBadgeClass(order.status)}">${escapeHTML(order.status)}</span></div>
        <div style="grid-column:1/-1;"><span style="color:var(--color-text-muted);">Date:</span> ${formatDateTime(order.created_at)}</div>
      </div>
      <table class="data-table" style="margin-bottom:1rem;">
        <thead><tr><th>Item</th><th>Qty</th><th>Price</th><th>Total</th></tr></thead>
        <tbody>
          ${(order.items || []).map(i => `
            <tr>
              <td>${escapeHTML(i.product_name)}</td>
              <td>${i.quantity}</td>
              <td>${formatCurrency(i.unit_price)}</td>
              <td style="font-weight:600;">${formatCurrency(i.total)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      <div style="text-align:right;font-size:0.9rem;">
        <div>Subtotal: ${formatCurrency(order.subtotal)}</div>
        <div>Tax: ${formatCurrency(order.tax_amount)}</div>
        <div>Discount: -${formatCurrency(order.discount_amount)}</div>
        <div style="font-weight:800;font-size:1.1rem;margin-top:0.5rem;">Total: ${formatCurrency(order.total)}</div>
      </div>
      ${refundDetails(order)}
      ${canRefund ? `
        <section class="refund-panel" id="refund-panel" aria-labelledby="refund-title" hidden>
          <h4 id="refund-title">Refund this sale</h4>
          <p>Give the customer back ${formatCurrency(order.total)} the way they paid (${escapeHTML((order.payment_method || 'cash').toLowerCase())}), then confirm. This can’t be undone.</p>
          <label class="label" for="refund-reason">Reason</label>
          <textarea class="input" id="refund-reason" rows="2" maxlength="500" placeholder="For example: customer returned the item unopened"></textarea>
          <label class="refund-restock" for="refund-restock">
            <input type="checkbox" id="refund-restock" checked>
            <span>Return the items to stock</span>
          </label>
          <div class="refund-actions">
            <button class="btn btn-ghost" type="button" id="refund-cancel">Keep sale</button>
            <button class="btn btn-danger" type="button" id="refund-confirm">Refund ${formatCurrency(order.total)}</button>
          </div>
        </section>` : ''}
      <div class="order-detail-actions">
        ${canRefund ? '<button class="btn btn-ghost refund-start" type="button" id="refund-start">Refund sale</button>' : ''}
        <button class="btn btn-ghost" id="close-order-detail" data-dialog-close type="button">Close</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  overlay.querySelector('#close-order-detail').addEventListener('click', () => overlay.remove());

  if (!canRefund) return;
  const panel = overlay.querySelector('#refund-panel');
  const startButton = overlay.querySelector('#refund-start');
  const reasonInput = overlay.querySelector('#refund-reason');
  const confirmButton = overlay.querySelector('#refund-confirm');

  startButton.addEventListener('click', () => {
    panel.hidden = false;
    startButton.hidden = true;
    reasonInput.focus();
  });
  overlay.querySelector('#refund-cancel').addEventListener('click', () => {
    panel.hidden = true;
    startButton.hidden = false;
    startButton.focus();
  });
  confirmButton.addEventListener('click', async () => {
    const reason = reasonInput.value.trim();
    if (reason.length < 3) {
      toast('Give a short reason for the refund', 'warning');
      reasonInput.focus();
      return;
    }
    if (!navigator.onLine) {
      toast('Refunds need an internet connection so every device sees them.', 'warning', 5000);
      return;
    }
    const label = confirmButton.textContent;
    confirmButton.disabled = true;
    confirmButton.textContent = 'Refunding…';
    try {
      await api.post(`/orders/${order.id}/refund`, {
        reason,
        restock: overlay.querySelector('#refund-restock').checked,
      }, { skipOfflineQueue: true });
      toast(`Refunded ${order.order_number}`, 'success');
      overlay.remove();
      refreshOfflineSnapshot({ force: true }).catch(() => {});
      onChanged();
    } catch (err) {
      toast(err.message || 'Refund failed', 'error');
      confirmButton.disabled = false;
      confirmButton.textContent = label;
    }
  });
}
