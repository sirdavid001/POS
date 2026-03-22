import { api } from '../api.js';
import { renderLayout } from './layout.js';
import { formatCurrency, formatDateTime, icons } from '../utils.js';

export async function renderDashboard() {
  const content = renderLayout('dashboard');

  content.innerHTML = `
    <div class="animate-fade-in">
      <div class="page-header">
        <h2>Dashboard</h2>
        <span style="font-size:0.85rem;color:var(--color-text-muted);">${new Date().toLocaleDateString('en-NG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</span>
      </div>

      <div class="stat-grid" id="stats-grid">
        <div class="stat-card"><div class="spinner"></div></div>
        <div class="stat-card"><div class="spinner"></div></div>
        <div class="stat-card"><div class="spinner"></div></div>
        <div class="stat-card"><div class="spinner"></div></div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1.5rem;margin-bottom:1.5rem;">
        <div class="glass-card" style="padding:1.25rem;">
          <h3 style="font-size:1rem;font-weight:700;margin-bottom:1rem;">Recent Orders</h3>
          <div id="recent-orders"><div class="spinner"></div></div>
        </div>
        <div class="glass-card" style="padding:1.25rem;">
          <h3 style="font-size:1rem;font-weight:700;margin-bottom:1rem;">Top Selling Products</h3>
          <div id="top-products"><div class="spinner"></div></div>
        </div>
      </div>

      <div class="glass-card" style="padding:1.25rem;">
        <h3 style="font-size:1rem;font-weight:700;margin-bottom:1rem;">
          ${icons.alert}
          <span style="margin-left:0.5rem;">Low Stock Alerts</span>
        </h3>
        <div id="low-stock"><div class="spinner"></div></div>
      </div>
    </div>
  `;

  // Load data in parallel
  try {
    const [revenue, recentOrders, topProducts, lowStock] = await Promise.all([
      api.get('/reports/revenue'),
      api.get('/reports/recent-orders'),
      api.get('/reports/top-products?limit=5'),
      api.get('/products/low-stock'),
    ]);

    // Stat cards
    document.getElementById('stats-grid').innerHTML = `
      <div class="stat-card">
        <div class="stat-label">Today's Revenue</div>
        <div class="stat-value" style="color:var(--color-accent);">${formatCurrency(revenue.today.revenue)}</div>
        <div class="stat-change" style="color:var(--color-text-muted);">${revenue.today.orders} orders</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">This Week</div>
        <div class="stat-value">${formatCurrency(revenue.thisWeek.revenue)}</div>
        <div class="stat-change" style="color:var(--color-text-muted);">${revenue.thisWeek.orders} orders</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">This Month</div>
        <div class="stat-value">${formatCurrency(revenue.thisMonth.revenue)}</div>
        <div class="stat-change" style="color:var(--color-text-muted);">${revenue.thisMonth.orders} orders</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">All Time</div>
        <div class="stat-value">${formatCurrency(revenue.allTime.revenue)}</div>
        <div class="stat-change" style="color:var(--color-text-muted);">${revenue.allTime.orders} orders</div>
      </div>
    `;

    // Recent orders
    if (recentOrders.orders.length === 0) {
      document.getElementById('recent-orders').innerHTML = '<p style="color:var(--color-text-muted);font-size:0.85rem;">No orders yet. Start selling!</p>';
    } else {
      document.getElementById('recent-orders').innerHTML = `
        <table class="data-table">
          <thead><tr><th>Order #</th><th>Total</th><th>Cashier</th><th>Time</th></tr></thead>
          <tbody>
            ${recentOrders.orders.map(o => `
              <tr>
                <td style="font-weight:600;">${o.order_number}</td>
                <td>${formatCurrency(o.total)}</td>
                <td>${o.cashier || '-'}</td>
                <td style="font-size:0.8rem;color:var(--color-text-muted);">${formatDateTime(o.created_at)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    }

    // Top products
    if (topProducts.products.length === 0) {
      document.getElementById('top-products').innerHTML = '<p style="color:var(--color-text-muted);font-size:0.85rem;">No sales data yet.</p>';
    } else {
      document.getElementById('top-products').innerHTML = `
        <table class="data-table">
          <thead><tr><th>Product</th><th>Sold</th><th>Revenue</th></tr></thead>
          <tbody>
            ${topProducts.products.map((p, i) => `
              <tr>
                <td><span class="badge badge-info" style="margin-right:0.5rem;">#${i + 1}</span> ${p.product_name}</td>
                <td>${p.total_quantity}</td>
                <td>${formatCurrency(p.total_revenue)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    }

    // Low stock
    if (lowStock.products.length === 0) {
      document.getElementById('low-stock').innerHTML = '<p style="color:var(--color-success);font-size:0.85rem;">✓ All products are well stocked</p>';
    } else {
      document.getElementById('low-stock').innerHTML = `
        <table class="data-table">
          <thead><tr><th>Product</th><th>Current Stock</th><th>Threshold</th><th>Status</th></tr></thead>
          <tbody>
            ${lowStock.products.map(p => `
              <tr>
                <td>${p.name}</td>
                <td style="font-weight:700;color:var(--color-danger);">${p.stock_quantity}</td>
                <td>${p.low_stock_threshold}</td>
                <td><span class="badge ${p.stock_quantity === 0 ? 'badge-danger' : 'badge-warning'}">${p.stock_quantity === 0 ? 'Out of Stock' : 'Low'}</span></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    }
  } catch (err) {
    content.innerHTML = `<div class="empty-state"><p>Failed to load dashboard: ${err.message}</p></div>`;
  }
}
