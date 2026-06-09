import { api } from '../api.js';
import { renderLayout } from './layout.js';
import { formatCurrency, toast } from '../utils.js';
import { showStatementModal } from './customers.js';

export async function renderReports() {
  const content = renderLayout('reports');

  content.innerHTML = `
    <div class="animate-fade-in">
      <div class="page-header">
        <h2>Reports</h2>
        <button class="btn btn-ghost" id="export-csv-btn">📥 Export CSV</button>
      </div>

      <div style="display:flex;gap:1rem;margin-bottom:1.5rem;flex-wrap:wrap;">
        <select class="input" id="report-period" style="max-width:160px;">
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
        </select>
        <input class="input" type="date" id="report-start" style="max-width:180px;">
        <input class="input" type="date" id="report-end" style="max-width:180px;">
        <button class="btn btn-primary" id="load-report-btn">Generate</button>
      </div>

      <div class="glass-card" style="padding:1.25rem;margin-bottom:1.5rem;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap;">
          <div>
            <h3 style="font-size:1rem;font-weight:700;">Customer Account Statements</h3>
            <p style="font-size:0.8rem;color:var(--color-text-muted);margin-top:0.25rem;">
              Print, download as PDF or Excel, or send a customer's purchase statement by email.
            </p>
          </div>
          <div style="display:flex;gap:0.5rem;align-items:end;flex-wrap:wrap;">
            <div>
              <label class="label" for="statement-customer-select">Customer</label>
              <select class="input" id="statement-customer-select" style="min-width:240px;">
                <option value="">Loading customers...</option>
              </select>
            </div>
            <button class="btn btn-primary" id="open-statement-btn" disabled>Open Statement</button>
          </div>
        </div>
      </div>

      <div class="stat-grid" id="report-stats">
        <div class="stat-card"><div class="spinner"></div></div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1.5rem;">
        <div class="glass-card" style="padding:1.25rem;">
          <h3 style="font-size:1rem;font-weight:700;margin-bottom:1rem;">Sales Breakdown</h3>
          <div id="sales-breakdown"><div class="spinner"></div></div>
        </div>
        <div class="glass-card" style="padding:1.25rem;">
          <h3 style="font-size:1rem;font-weight:700;margin-bottom:1rem;">Top Products</h3>
          <div id="report-top-products"><div class="spinner"></div></div>
        </div>
      </div>
    </div>
  `;

  let statementCustomers = [];
  const statementSelect = document.getElementById('statement-customer-select');
  const openStatementButton = document.getElementById('open-statement-btn');

  async function loadStatementCustomers() {
    try {
      const data = await api.get('/customers?limit=500');
      statementCustomers = data.customers;
      statementSelect.innerHTML = '<option value="">Select a customer</option>';

      statementCustomers.forEach(customer => {
        const option = document.createElement('option');
        option.value = customer.id;
        option.textContent = customer.email
          ? `${customer.name} (${customer.email})`
          : customer.name;
        statementSelect.appendChild(option);
      });

      if (statementCustomers.length === 0) {
        statementSelect.innerHTML = '<option value="">No customers available</option>';
      }
    } catch {
      statementSelect.innerHTML = '<option value="">Failed to load customers</option>';
      toast('Failed to load customers for statements', 'error');
    }
  }

  statementSelect.addEventListener('change', () => {
    openStatementButton.disabled = !statementSelect.value;
  });

  openStatementButton.addEventListener('click', () => {
    const customer = statementCustomers.find(item => String(item.id) === statementSelect.value);
    if (!customer) return toast('Select a customer first', 'warning');
    showStatementModal(customer);
  });

  loadStatementCustomers();

  async function loadReport() {
    try {
      const period = document.getElementById('report-period').value;
      const startDate = document.getElementById('report-start').value;
      const endDate = document.getElementById('report-end').value;

      let url = `/reports/sales?period=${period}`;
      if (startDate) url += `&start_date=${startDate}`;
      if (endDate) url += `&end_date=${endDate}`;

      const [salesData, revenue, topProducts] = await Promise.all([
        api.get(url),
        api.get('/reports/revenue'),
        api.get('/reports/top-products?limit=10'),
      ]);

      // Stats
      document.getElementById('report-stats').innerHTML = `
        <div class="stat-card">
          <div class="stat-label">Today</div>
          <div class="stat-value" style="color:var(--color-accent);">${formatCurrency(revenue.today.revenue)}</div>
          <div class="stat-change" style="color:var(--color-text-muted);">${revenue.today.orders} orders</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">This Month</div>
          <div class="stat-value">${formatCurrency(revenue.thisMonth.revenue)}</div>
          <div class="stat-change" style="color:var(--color-text-muted);">${revenue.thisMonth.orders} orders</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">All Time Revenue</div>
          <div class="stat-value">${formatCurrency(revenue.allTime.revenue)}</div>
        </div>
      `;

      // Sales breakdown table
      if (salesData.sales.length === 0) {
        document.getElementById('sales-breakdown').innerHTML = '<p style="color:var(--color-text-muted);">No data for selected period.</p>';
      } else {
        document.getElementById('sales-breakdown').innerHTML = `
          <table class="data-table">
            <thead><tr><th>Period</th><th>Orders</th><th>Revenue</th><th>Avg Order</th></tr></thead>
            <tbody>
              ${salesData.sales.map(s => `
                <tr>
                  <td style="font-weight:600;">${s.period}</td>
                  <td>${s.total_orders}</td>
                  <td style="color:var(--color-accent);">${formatCurrency(s.revenue)}</td>
                  <td>${formatCurrency(s.avg_order_value)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `;
      }

      // Top products
      if (topProducts.products.length === 0) {
        document.getElementById('report-top-products').innerHTML = '<p style="color:var(--color-text-muted);">No sales data.</p>';
      } else {
        document.getElementById('report-top-products').innerHTML = topProducts.products.map((p, i) => `
          <div style="display:flex;align-items:center;gap:0.75rem;padding:0.6rem 0;border-bottom:1px solid var(--color-border);">
            <span class="badge badge-info" style="min-width:30px;justify-content:center;">#${i + 1}</span>
            <span style="flex:1;font-size:0.85rem;">${p.product_name}</span>
            <span style="font-size:0.8rem;color:var(--color-text-muted);">${p.total_quantity} sold</span>
            <span style="font-weight:700;font-size:0.85rem;">${formatCurrency(p.total_revenue)}</span>
          </div>
        `).join('');
      }
    } catch (err) { toast('Failed to load report', 'error'); }
  }

  document.getElementById('load-report-btn').addEventListener('click', loadReport);

  // CSV export
  document.getElementById('export-csv-btn').addEventListener('click', async () => {
    try {
      const period = document.getElementById('report-period').value;
      const data = await api.get(`/reports/sales?period=${period}`);

      let csv = 'Period,Orders,Revenue,Discounts,Tax,Avg Order Value\n';
      data.sales.forEach(s => {
        csv += `${s.period},${s.total_orders},${s.revenue},${s.total_discounts},${s.total_tax},${s.avg_order_value}\n`;
      });

      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `pos-report-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast('Report exported', 'success');
    } catch (err) { toast('Export failed', 'error'); }
  });

  await loadReport();
}
