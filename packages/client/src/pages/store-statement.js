import { api } from '../api.js';
import { formatCurrency, formatDate, toast } from '../utils.js';

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

export function showStoreStatementModal(initialFilters = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal statement-printable" style="max-width:980px;">
      <div class="no-print">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:1rem;margin-bottom:1rem;">
          <div>
            <h3 style="font-weight:700;">Store Sales Statement</h3>
            <p style="font-size:0.8rem;color:var(--color-text-muted);">Complete sales statement for the store owner.</p>
          </div>
          <button class="btn btn-ghost btn-sm" id="close-statement">Close</button>
        </div>

        <div style="display:flex;gap:0.75rem;align-items:end;flex-wrap:wrap;margin-bottom:1rem;">
          <div>
            <label class="label" for="statement-start">Start Date</label>
            <input class="input" type="date" id="statement-start" value="${escapeHtml(initialFilters.start_date || '')}">
          </div>
          <div>
            <label class="label" for="statement-end">End Date</label>
            <input class="input" type="date" id="statement-end" value="${escapeHtml(initialFilters.end_date || '')}">
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
            <label class="label" for="statement-email">Owner Email</label>
            <input class="input" type="email" id="statement-email" placeholder="owner@example.com">
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
  const emailInput = overlay.querySelector('#statement-email');

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
            <h3 style="font-size:1.1rem;font-weight:800;">Store Sales Statement</h3>
            <div style="font-size:0.75rem;color:var(--color-text-muted);">${escapeHtml(statement.period.label)}</div>
            <div style="font-size:0.7rem;color:var(--color-text-muted);">Generated ${new Date(statement.generated_at).toLocaleString('en-NG')}</div>
          </div>
        </div>

        <div class="statement-summary-grid">
          <div class="statement-summary-card"><span>Total Orders</span><strong>${statement.summary.total_orders}</strong></div>
          <div class="statement-summary-card"><span>Completed Orders</span><strong>${statement.summary.completed_orders}</strong></div>
          <div class="statement-summary-card"><span>Items Sold</span><strong>${statement.summary.total_items}</strong></div>
          <div class="statement-summary-card"><span>Total Sales</span><strong>${formatStatementMoney(statement.summary.total_sales, currency)}</strong></div>
          <div class="statement-summary-card"><span>Average Sale</span><strong>${formatStatementMoney(statement.summary.average_sale, currency)}</strong></div>
          <div class="statement-summary-card"><span>Total Tax</span><strong>${formatStatementMoney(statement.summary.total_tax, currency)}</strong></div>
          <div class="statement-summary-card"><span>Total Discounts</span><strong>${formatStatementMoney(statement.summary.total_discount, currency)}</strong></div>
        </div>

        <div class="table-scroll-wrapper">
          <table class="data-table statement-table">
            <thead><tr><th>Date</th><th>Order</th><th>Cashier</th><th>Items</th><th>Payment</th><th>Status</th><th>Amount</th><th>Cumulative Revenue</th></tr></thead>
            <tbody>
              ${transactions.length ? transactions.map(transaction => `
                <tr>
                  <td>${formatDate(transaction.created_at)}</td>
                  <td style="font-weight:600;">${escapeHtml(transaction.order_number)}</td>
                  <td>${escapeHtml(transaction.cashier_name)}</td>
                  <td>${transaction.item_count}</td>
                  <td>${escapeHtml(transaction.payment_method.toUpperCase())}</td>
                  <td><span class="badge badge-${transaction.status === 'completed' ? 'success' : transaction.status === 'cancelled' || transaction.status === 'refunded' ? 'danger' : 'warning'}">${escapeHtml(transaction.status)}</span></td>
                  <td style="font-weight:600;">${formatStatementMoney(transaction.total, currency)}</td>
                  <td>${formatStatementMoney(transaction.cumulative_total, currency)}</td>
                </tr>
              `).join('') : '<tr><td colspan="8" style="text-align:center;padding:2rem;color:var(--color-text-muted);">No transactions found for this period.</td></tr>'}
            </tbody>
          </table>
        </div>
        <p style="font-size:0.7rem;color:var(--color-text-muted);margin-top:0.75rem;">Cumulative revenue includes completed sales only.</p>
      </div>
    `;
  }

  async function loadStatement() {
    if (!validateDates()) return;
    documentEl.innerHTML = '<div style="display:flex;justify-content:center;padding:3rem;"><div class="spinner spinner-lg"></div></div>';

    try {
      const data = await api.get(`/reports/statement${getQuery()}`);
      currentStatement = data.statement;
      if (!emailInput.value && currentStatement.store.email) {
        emailInput.value = currentStatement.store.email;
      }
      renderStatement(currentStatement);
    } catch (err) {
      currentStatement = null;
      documentEl.innerHTML = `<div class="empty-state"><p>${escapeHtml(err.message || 'Failed to load statement')}</p></div>`;
    }
  }

  async function downloadStatement(format) {
    if (!validateDates()) return;
    try {
      const result = await api.download(`/reports/statement/export${getQuery({ format })}`);
      triggerDownload(result.blob, result.filename || `sales-statement.${format === 'pdf' ? 'pdf' : 'xlsx'}`);
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
    const email = emailInput.value.trim();
    const format = overlay.querySelector('#statement-email-format').value;

    if (!email) return toast('Enter the owner email address', 'error');

    button.disabled = true;
    button.textContent = 'Sending...';
    try {
      await api.post('/reports/statement/email', {
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
