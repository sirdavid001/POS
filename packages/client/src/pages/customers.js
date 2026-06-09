import { api } from '../api.js';
import { renderLayout } from './layout.js';
import { formatCurrency, formatDate, toast, icons } from '../utils.js';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatStatementMoney(value, currency = 'NGN') {
  try {
    return new Intl.NumberFormat('en-NG', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
    }).format(Number(value) || 0);
  } catch {
    return formatCurrency(value);
  }
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export async function renderCustomers() {
  const content = renderLayout('customers');

  content.innerHTML = `
    <div class="animate-fade-in">
      <div class="page-header">
        <h2>Customers</h2>
        <button class="btn btn-primary" id="add-customer-btn">${icons.plus} Add Customer</button>
      </div>
      <input class="input" type="text" id="customer-search" placeholder="Search customers..." style="max-width:320px;margin-bottom:1rem;">
      <div class="glass-card" style="overflow:hidden;">
        <table class="data-table">
          <thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Loyalty Points</th><th>Since</th><th>Actions</th></tr></thead>
          <tbody id="customers-tbody">
            <tr><td colspan="6" style="text-align:center;padding:2rem;"><div class="spinner" style="margin:auto;"></div></td></tr>
          </tbody>
        </table>
      </div>
    </div>
  `;

  async function loadCustomers() {
    try {
      const search = document.getElementById('customer-search').value;
      let url = '/customers?limit=100';
      if (search) url += `&search=${encodeURIComponent(search)}`;

      const data = await api.get(url);
      const tbody = document.getElementById('customers-tbody');

      if (data.customers.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No customers found</td></tr>';
        return;
      }

      tbody.innerHTML = data.customers.map(c => `
        <tr>
          <td style="font-weight:600;">${c.name}</td>
          <td style="font-size:0.85rem;color:var(--color-text-muted);">${c.email || '-'}</td>
          <td>${c.phone || '-'}</td>
          <td><span class="badge badge-info">${c.loyalty_points} pts</span></td>
          <td style="font-size:0.8rem;color:var(--color-text-muted);">${formatDate(c.created_at)}</td>
          <td>
            <button class="btn btn-ghost btn-sm statement-customer" data-id="${c.id}">Statement</button>
            <button class="btn btn-ghost btn-sm edit-customer" data-id="${c.id}">Edit</button>
            <button class="btn btn-ghost btn-sm delete-customer" data-id="${c.id}" style="color:var(--color-danger);">Delete</button>
          </td>
        </tr>
      `).join('');

      tbody.querySelectorAll('.statement-customer').forEach(btn => {
        btn.addEventListener('click', () => {
          const customer = data.customers.find(item => String(item.id) === btn.dataset.id);
          if (customer) showStatementModal(customer);
        });
      });

      tbody.querySelectorAll('.delete-customer').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm('Delete this customer?')) return;
          try {
            await api.delete('/customers/' + btn.dataset.id);
            toast('Customer deleted', 'success');
            loadCustomers();
          } catch (err) { toast(err.message, 'error'); }
        });
      });
    } catch (err) { toast('Failed to load customers', 'error'); }
  }

  document.getElementById('customer-search').addEventListener('input', () => setTimeout(loadCustomers, 300));

  document.getElementById('add-customer-btn').addEventListener('click', () => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <h3 style="font-weight:700;margin-bottom:1.25rem;">Add Customer</h3>
        <form id="customer-form">
          <div class="form-group"><label class="label">Name *</label><input class="input" name="name" required></div>
          <div class="form-group"><label class="label">Email</label><input class="input" type="email" name="email"></div>
          <div class="form-group"><label class="label">Phone</label><input class="input" name="phone"></div>
          <div class="form-group"><label class="label">Address</label><input class="input" name="address"></div>
          <div style="display:flex;gap:0.5rem;margin-top:1.25rem;">
            <button type="button" class="btn btn-ghost" style="flex:1;" onclick="this.closest('.modal-overlay').remove()">Cancel</button>
            <button type="submit" class="btn btn-primary" style="flex:2;">Add Customer</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    document.getElementById('customer-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = new FormData(e.target);
      try {
        await api.post('/customers', {
          name: form.get('name'),
          email: form.get('email') || undefined,
          phone: form.get('phone') || undefined,
          address: form.get('address') || undefined,
        });
        toast('Customer added', 'success');
        overlay.remove();
        loadCustomers();
      } catch (err) { toast(err.message, 'error'); }
    });
  });

  await loadCustomers();
}

export function showStatementModal(customer) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal statement-printable" style="max-width:920px;">
      <div class="no-print">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:1rem;margin-bottom:1rem;">
          <div>
            <h3 style="font-weight:700;">Customer Account Statement</h3>
            <p style="font-size:0.8rem;color:var(--color-text-muted);">${escapeHtml(customer.name)}</p>
          </div>
          <button class="btn btn-ghost btn-sm" id="close-statement">Close</button>
        </div>

        <div style="display:flex;gap:0.75rem;align-items:end;flex-wrap:wrap;margin-bottom:1rem;">
          <div>
            <label class="label" for="statement-start">Start Date</label>
            <input class="input" type="date" id="statement-start">
          </div>
          <div>
            <label class="label" for="statement-end">End Date</label>
            <input class="input" type="date" id="statement-end">
          </div>
          <button class="btn btn-primary" id="generate-statement">Generate</button>
        </div>
      </div>

      <div id="statement-document">
        <div style="display:flex;justify-content:center;padding:3rem;"><div class="spinner spinner-lg"></div></div>
      </div>

      <div class="no-print" style="border-top:1px solid var(--color-border);margin-top:1rem;padding-top:1rem;">
        <div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-bottom:1rem;">
          <button class="btn btn-ghost" id="print-statement">Print</button>
          <button class="btn btn-ghost" id="download-statement-pdf">Download PDF</button>
          <button class="btn btn-ghost" id="download-statement-excel">Download Excel</button>
        </div>
        <div class="statement-email-controls">
          <div>
            <label class="label" for="statement-email">Recipient Email</label>
            <input class="input" type="email" id="statement-email" value="${escapeHtml(customer.email || '')}" placeholder="customer@example.com">
          </div>
          <div>
            <label class="label" for="statement-email-format">Attachment</label>
            <select class="input" id="statement-email-format">
              <option value="pdf">PDF</option>
              <option value="xlsx">Excel</option>
            </select>
          </div>
          <button class="btn btn-primary" id="email-statement">Send Email</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  let currentStatement = null;
  const documentEl = overlay.querySelector('#statement-document');
  const startInput = overlay.querySelector('#statement-start');
  const endInput = overlay.querySelector('#statement-end');

  function getQuery(extra = {}) {
    const params = new URLSearchParams(extra);
    if (startInput.value) params.set('start_date', startInput.value);
    if (endInput.value) params.set('end_date', endInput.value);
    const query = params.toString();
    return query ? `?${query}` : '';
  }

  function validateDates() {
    if (startInput.value && endInput.value && startInput.value > endInput.value) {
      toast('Start date cannot be after end date', 'error');
      return false;
    }
    return true;
  }

  function renderStatement(statement) {
    const currency = statement.store.currency || 'NGN';
    const transactions = statement.transactions || [];

    documentEl.innerHTML = `
      <div class="statement-document">
        <div style="display:flex;justify-content:space-between;gap:1rem;border-bottom:2px solid var(--color-border);padding-bottom:1rem;margin-bottom:1rem;">
          <div>
            <h2 style="font-size:1.35rem;font-weight:800;">${escapeHtml(statement.store.name || 'QuickPOS Store')}</h2>
            <div style="font-size:0.75rem;color:var(--color-text-muted);">${escapeHtml(statement.store.address || '')}</div>
            <div style="font-size:0.75rem;color:var(--color-text-muted);">${escapeHtml([statement.store.phone, statement.store.email].filter(Boolean).join(' | '))}</div>
          </div>
          <div style="text-align:right;">
            <h3 style="font-size:1.1rem;font-weight:800;">Account Statement</h3>
            <div style="font-size:0.75rem;color:var(--color-text-muted);">${escapeHtml(statement.period.label)}</div>
            <div style="font-size:0.7rem;color:var(--color-text-muted);">Generated ${new Date(statement.generated_at).toLocaleString('en-NG')}</div>
          </div>
        </div>

        <div style="margin-bottom:1rem;">
          <div style="font-size:1rem;font-weight:700;">${escapeHtml(statement.customer.name)}</div>
          <div style="font-size:0.75rem;color:var(--color-text-muted);">${escapeHtml([statement.customer.email, statement.customer.phone, statement.customer.address].filter(Boolean).join(' | '))}</div>
        </div>

        <div class="statement-summary-grid">
          <div class="statement-summary-card"><span>Total Orders</span><strong>${statement.summary.total_orders}</strong></div>
          <div class="statement-summary-card"><span>Completed Orders</span><strong>${statement.summary.completed_orders}</strong></div>
          <div class="statement-summary-card"><span>Total Spent</span><strong>${formatStatementMoney(statement.summary.total_spent, currency)}</strong></div>
          <div class="statement-summary-card"><span>Average Order</span><strong>${formatStatementMoney(statement.summary.average_order_value, currency)}</strong></div>
        </div>

        <div class="table-scroll-wrapper">
          <table class="data-table statement-table">
            <thead><tr><th>Date</th><th>Order</th><th>Items</th><th>Payment</th><th>Status</th><th>Amount</th><th>Cumulative Spend</th></tr></thead>
            <tbody>
              ${transactions.length ? transactions.map(transaction => `
                <tr>
                  <td>${formatDate(transaction.created_at)}</td>
                  <td style="font-weight:600;">${escapeHtml(transaction.order_number)}</td>
                  <td>${transaction.item_count}</td>
                  <td>${escapeHtml(transaction.payment_method.toUpperCase())}</td>
                  <td><span class="badge badge-${transaction.status === 'completed' ? 'success' : transaction.status === 'cancelled' || transaction.status === 'refunded' ? 'danger' : 'warning'}">${escapeHtml(transaction.status)}</span></td>
                  <td style="font-weight:600;">${formatStatementMoney(transaction.total, currency)}</td>
                  <td>${formatStatementMoney(transaction.cumulative_total, currency)}</td>
                </tr>
              `).join('') : '<tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--color-text-muted);">No transactions found for this period.</td></tr>'}
            </tbody>
          </table>
        </div>
        <p style="font-size:0.7rem;color:var(--color-text-muted);margin-top:0.75rem;">Cumulative spend includes completed sales only.</p>
      </div>
    `;
  }

  async function loadStatement() {
    if (!validateDates()) return;
    documentEl.innerHTML = '<div style="display:flex;justify-content:center;padding:3rem;"><div class="spinner spinner-lg"></div></div>';

    try {
      const data = await api.get(`/customers/${customer.id}/statement${getQuery()}`);
      currentStatement = data.statement;
      renderStatement(currentStatement);
    } catch (err) {
      currentStatement = null;
      documentEl.innerHTML = `<div class="empty-state"><p>${escapeHtml(err.message || 'Failed to load statement')}</p></div>`;
    }
  }

  async function downloadStatement(format) {
    if (!validateDates()) return;
    try {
      const result = await api.download(
        `/customers/${customer.id}/statement/export${getQuery({ format })}`
      );
      const safeName = customer.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'customer';
      triggerDownload(result.blob, result.filename || `statement-${safeName}.${format === 'pdf' ? 'pdf' : 'xlsx'}`);
      toast(`${format === 'pdf' ? 'PDF' : 'Excel'} statement downloaded`, 'success');
    } catch (err) {
      toast(err.message || 'Download failed', 'error');
    }
  }

  overlay.querySelector('#close-statement').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) overlay.remove();
  });
  overlay.querySelector('#generate-statement').addEventListener('click', loadStatement);
  overlay.querySelector('#print-statement').addEventListener('click', () => {
    if (!currentStatement) return toast('Generate the statement before printing', 'warning');
    window.print();
  });
  overlay.querySelector('#download-statement-pdf').addEventListener('click', () => downloadStatement('pdf'));
  overlay.querySelector('#download-statement-excel').addEventListener('click', () => downloadStatement('xlsx'));

  overlay.querySelector('#email-statement').addEventListener('click', async () => {
    if (!validateDates()) return;
    const button = overlay.querySelector('#email-statement');
    const email = overlay.querySelector('#statement-email').value.trim();
    const format = overlay.querySelector('#statement-email-format').value;

    if (!email) return toast('Enter a recipient email address', 'error');

    button.disabled = true;
    button.textContent = 'Sending...';
    try {
      await api.post(`/customers/${customer.id}/statement/email`, {
        email,
        format,
        start_date: startInput.value || undefined,
        end_date: endInput.value || undefined,
      });
      toast('Statement emailed successfully', 'success');
    } catch (err) {
      toast(err.message || 'Email delivery failed', 'error');
    } finally {
      button.disabled = false;
      button.textContent = 'Send Email';
    }
  });

  loadStatement();
}
