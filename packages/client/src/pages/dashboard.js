import { api } from '../api.js';
import { renderLayout } from './layout.js';
import { formatCurrency, formatDateTime, icons } from '../utils.js';
import Chart from 'chart.js/auto';

export async function renderDashboard() {
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  if (user.role === 'cashier') {
    return renderCashierDashboard();
  }

  return renderManagerDashboard();
}

async function renderManagerDashboard() {
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

      <div class="glass-card" style="padding:1.25rem;margin-bottom:1.5rem;">
        <h3 style="font-size:1rem;font-weight:700;margin-bottom:1rem;">Revenue Trend</h3>
        <div style="height:300px;position:relative;width:100%;">
          <canvas id="revenueChart"></canvas>
        </div>
      </div>

      <div class="responsive-grid-2" style="margin-bottom:1.5rem;">
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
    const [revenue, salesData, recentOrders, topProducts, lowStock] = await Promise.all([
      api.get('/reports/revenue'),
      api.get('/reports/sales?period=daily'),
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

    // Render Chart
    const ctx = document.getElementById('revenueChart');
    if (ctx && salesData.sales) {
      // Backend returns dates descending (newest first). Reverse it for chronologic left-to-right.
      const chronological = salesData.sales.slice().reverse();
      const labels = chronological.map(s => {
        const d = new Date(s.period);
        return d.toLocaleDateString('en-NG', { month: 'short', day: 'numeric' });
      });
      const data = chronological.map(s => parseFloat(s.revenue));

      new Chart(ctx, {
        type: 'line',
        data: {
          labels,
          datasets: [{
            label: 'Daily Revenue',
            data,
            borderColor: '#6366f1',
            backgroundColor: 'rgba(99, 102, 241, 0.1)',
            borderWidth: 3,
            fill: true,
            tension: 0.4,
            pointBackgroundColor: '#6366f1',
            pointBorderColor: '#ffffff',
            pointBorderWidth: 2,
            pointRadius: 4,
            pointHoverRadius: 6
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: (context) => formatCurrency(context.parsed.y)
              }
            }
          },
          scales: {
            y: {
              beginAtZero: true,
              grid: { color: 'rgba(128, 128, 128, 0.1)' },
              ticks: { callback: (val) => '₦' + val.toLocaleString() }
            },
            x: {
              grid: { display: false }
            }
          }
        }
      });
    }

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

async function renderCashierDashboard() {
  const content = renderLayout('dashboard');

  content.innerHTML = `
    <div class="animate-fade-in">
      <div class="page-header">
        <h2>Dashboard</h2>
        <span style="font-size:0.85rem;color:var(--color-text-muted);">Cashier overview</span>
      </div>

      <div class="stat-grid" id="stats-grid">
        <div class="stat-card"><div class="spinner"></div></div>
        <div class="stat-card"><div class="spinner"></div></div>
        <div class="stat-card"><div class="spinner"></div></div>
        <div class="stat-card"><div class="spinner"></div></div>
      </div>

      <div class="responsive-grid-2" style="margin-bottom:1.5rem;">
        <div class="glass-card" style="padding:1.25rem;">
          <h3 style="font-size:1rem;font-weight:700;margin-bottom:1rem;">Recent Orders</h3>
          <div id="recent-orders"><div class="spinner"></div></div>
        </div>
        <div class="glass-card" style="padding:1.25rem;">
          <h3 style="font-size:1rem;font-weight:700;margin-bottom:1rem;">Quick Actions</h3>
          <div id="quick-actions"><div class="spinner"></div></div>
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

  try {
    const [orders, customers, products, lowStock] = await Promise.all([
      api.get('/orders?limit=10'),
      api.get('/customers?limit=1'),
      api.get('/products?limit=1'),
      api.get('/products/low-stock'),
    ]);

    document.getElementById('stats-grid').innerHTML = `
      <div class="stat-card">
        <div class="stat-label">Total Orders</div>
        <div class="stat-value">${orders.total ?? orders.orders.length}</div>
        <div class="stat-change" style="color:var(--color-text-muted);">Completed sales in your store</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Customers</div>
        <div class="stat-value">${customers.total ?? customers.customers.length}</div>
        <div class="stat-change" style="color:var(--color-text-muted);">Active customer records</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Products</div>
        <div class="stat-value">${products.total ?? products.products.length}</div>
        <div class="stat-change" style="color:var(--color-text-muted);">Items available to sell</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Low Stock</div>
        <div class="stat-value" style="color:${lowStock.products.length ? 'var(--color-warning)' : 'var(--color-success)'};">${lowStock.products.length}</div>
        <div class="stat-change" style="color:var(--color-text-muted);">${lowStock.products.length ? 'Needs attention' : 'All clear'}</div>
      </div>
    `;

    if (orders.orders.length === 0) {
      document.getElementById('recent-orders').innerHTML = '<p style="color:var(--color-text-muted);font-size:0.85rem;">No orders yet. Start a new sale from the POS terminal.</p>';
    } else {
      document.getElementById('recent-orders').innerHTML = `
        <table class="data-table">
          <thead><tr><th>Order #</th><th>Total</th><th>Payment</th><th>Time</th></tr></thead>
          <tbody>
            ${orders.orders.slice(0, 5).map(o => `
              <tr>
                <td style="font-weight:600;">${o.order_number}</td>
                <td>${formatCurrency(o.total)}</td>
                <td>${(o.payment_method || 'cash').toUpperCase()}</td>
                <td style="font-size:0.8rem;color:var(--color-text-muted);">${formatDateTime(o.created_at)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    }

    document.getElementById('quick-actions').innerHTML = `
      <div style="display:grid;gap:0.75rem;">
        <a href="#/pos" class="btn btn-primary">Open POS Terminal</a>
        <a href="#/orders" class="btn btn-secondary">View Order History</a>
        <a href="#/customers" class="btn btn-ghost">Manage Customers</a>
      </div>
    `;

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
