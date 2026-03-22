import { api } from '../api.js';
import { renderLayout } from './layout.js';
import { formatCurrency, toast } from '../utils.js';

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
