import { api } from '../api.js';
import { renderLayout } from './layout.js';
import { formatCurrency, formatDateTime, toast, downloadCSV } from '../utils.js';

let currentOrdersData = [];

export async function renderOrders() {
  const content = renderLayout('orders');

  content.innerHTML = `
    <div class="animate-fade-in">
      <div class="page-header"><h2>Orders</h2></div>
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
      <div class="glass-card table-scroll-wrapper" style="overflow:hidden;">
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
          <td style="font-weight:600;">${o.order_number}</td>
          <td>${o.cashier_name || '-'}</td>
          <td>${o.customer_name || 'Walk-in'}</td>
          <td style="font-weight:600;">${formatCurrency(o.total)}</td>
          <td><span class="badge badge-info">${(o.payment_method || 'cash').toUpperCase()}</span></td>
          <td><span class="badge badge-${o.status === 'completed' ? 'success' : o.status === 'cancelled' ? 'danger' : 'warning'}">${o.status}</span></td>
          <td style="font-size:0.8rem;color:var(--color-text-muted);">${formatDateTime(o.created_at)}</td>
          <td><button class="btn btn-ghost btn-sm view-order" data-id="${o.id}">View</button></td>
        </tr>
      `).join('');

      tbody.querySelectorAll('.view-order').forEach(btn => {
        btn.addEventListener('click', async () => {
          try {
            const res = await api.get('/orders/' + btn.dataset.id);
            showOrderDetail(res.order);
          } catch (err) { toast(err.message, 'error'); }
        });
      });
    } catch (err) { toast('Failed to load orders', 'error'); }
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
      'Date': new Date(o.created_at).toLocaleString()
    }));
    downloadCSV(formattedData, `QuickPOS_Orders_${new Date().toISOString().split('T')[0]}.csv`);
  });

  await loadOrders();
}

function showOrderDetail(order) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" style="max-width:500px;">
      <h3 style="font-weight:700;margin-bottom:1rem;">Order ${order.order_number}</h3>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;font-size:0.85rem;margin-bottom:1rem;">
        <div><span style="color:var(--color-text-muted);">Cashier:</span> ${order.cashier_name || '-'}</div>
        <div><span style="color:var(--color-text-muted);">Customer:</span> ${order.customer_name || 'Walk-in'}</div>
        <div><span style="color:var(--color-text-muted);">Payment:</span> ${(order.payment_method || '').toUpperCase()}</div>
        <div><span style="color:var(--color-text-muted);">Status:</span> <span class="badge badge-${order.status === 'completed' ? 'success' : 'warning'}">${order.status}</span></div>
        <div style="grid-column:1/-1;"><span style="color:var(--color-text-muted);">Date:</span> ${formatDateTime(order.created_at)}</div>
      </div>
      <table class="data-table" style="margin-bottom:1rem;">
        <thead><tr><th>Item</th><th>Qty</th><th>Price</th><th>Total</th></tr></thead>
        <tbody>
          ${(order.items || []).map(i => `
            <tr>
              <td>${i.product_name}</td>
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
      <button class="btn btn-ghost" style="width:100%;margin-top:1rem;" onclick="this.closest('.modal-overlay').remove()">Close</button>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
}
