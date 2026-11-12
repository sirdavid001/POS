import { api } from '../api.js';
import { renderLayout } from './layout.js';
import { debounce, escapeAttribute, escapeHTML, formatCurrency, formatDate, formatDateTime, toast, icons } from '../utils.js';

function fallbackStats(orders = []) {
  const completed = orders.filter((order) => order.status === 'completed');
  return {
    order_count: completed.length,
    total_spent: completed.reduce((sum, order) => sum + Number(order.total || 0), 0),
    last_visit: completed[0]?.created_at || null,
    first_visit: completed[completed.length - 1]?.created_at || null,
    partial: true,
  };
}

export async function renderCustomers() {
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  const canEdit = ['admin', 'manager'].includes(user.role);
  const canDelete = user.role === 'admin';
  const content = renderLayout('customers');

  content.innerHTML = `
    <div class="animate-fade-in">
      <div class="page-header">
        <h1>Customers</h1>
        <button class="btn btn-primary" id="add-customer-btn" type="button">${icons.plus} Add Customer</button>
      </div>
      <div class="list-toolbar">
        <label class="sr-only" for="customer-search">Search customers</label>
        <input class="input" type="search" id="customer-search" placeholder="Search name, phone or email…" autocomplete="off" spellcheck="false">
        <label class="sr-only" for="customer-sort">Sort customers</label>
        <select class="input" id="customer-sort">
          <option value="name">Name A–Z</option>
          <option value="spent">Top spenders</option>
          <option value="recent">Most recent visit</option>
        </select>
      </div>
      <div class="glass-card table-scroll-wrapper">
        <table class="data-table">
          <thead><tr><th>Name</th><th>Phone</th><th class="num">Orders</th><th class="num">Total spent</th><th>Last visit</th><th>Actions</th></tr></thead>
          <tbody id="customers-tbody">
            <tr><td colspan="6" style="text-align:center;padding:2rem;"><div class="spinner" style="margin:auto;"></div></td></tr>
          </tbody>
        </table>
      </div>
    </div>
  `;

  async function loadCustomers() {
    try {
      const params = new URLSearchParams({ limit: '100', sort: document.getElementById('customer-sort').value });
      const search = document.getElementById('customer-search').value.trim();
      if (search) params.set('search', search);
      const data = await api.get(`/customers?${params}`);
      const tbody = document.getElementById('customers-tbody');

      if (data.customers.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="empty-state">${search ? 'No customer matches that search' : 'No customers yet. Add one here or at checkout.'}</td></tr>`;
        return;
      }

      tbody.innerHTML = data.customers.map((c) => {
        const name = escapeAttribute(c.name);
        const hasStats = c.order_count !== undefined;
        return `
        <tr>
          <td><button type="button" class="link-button view-customer" data-id="${escapeAttribute(c.id)}">${escapeHTML(c.name)}</button></td>
          <td class="num-text">${escapeHTML(c.phone || '—')}</td>
          <td class="num">${hasStats ? Number(c.order_count).toLocaleString('en-NG') : '—'}</td>
          <td class="num">${hasStats ? formatCurrency(c.total_spent) : '—'}</td>
          <td class="muted-cell">${c.last_visit ? formatDate(c.last_visit) : '—'}</td>
          <td class="row-actions">
            ${canEdit ? `<button class="btn btn-ghost btn-sm edit-customer" type="button" data-id="${escapeAttribute(c.id)}" aria-label="Edit ${name}">Edit</button>` : ''}
            ${canDelete ? `<button class="btn btn-ghost btn-sm delete-customer" type="button" data-id="${escapeAttribute(c.id)}" aria-label="Delete ${name}" style="color:var(--color-danger);">Delete</button>` : ''}
          </td>
        </tr>`;
      }).join('');

      tbody.querySelectorAll('.view-customer').forEach((btn) => {
        btn.addEventListener('click', () => showCustomerProfile(btn.dataset.id));
      });
      tbody.querySelectorAll('.delete-customer').forEach((btn) => {
        btn.addEventListener('click', async () => {
          if (!confirm('Delete this customer? Their past sales stay in your records.')) return;
          try {
            await api.delete('/customers/' + btn.dataset.id);
            toast('Customer deleted', 'success');
            loadCustomers();
          } catch (err) { toast(err.message, 'error'); }
        });
      });
      tbody.querySelectorAll('.edit-customer').forEach((btn) => {
        btn.addEventListener('click', async () => {
          try {
            const { customer } = await api.get('/customers/' + btn.dataset.id);
            showCustomerModal(customer);
          } catch (err) { toast(err.message || 'Could not load customer', 'error'); }
        });
      });
    } catch { toast('Failed to load customers', 'error'); }
  }

  async function showCustomerProfile(id) {
    let data;
    try {
      data = await api.get('/customers/' + id);
    } catch (err) {
      toast(err.message || 'Could not load customer', 'error');
      return;
    }
    const { customer, orders = [] } = data;
    const stats = data.stats || fallbackStats(orders);
    const orderCount = Number(stats.order_count || 0);
    const totalSpent = Number(stats.total_spent || 0);
    const favourites = data.favourite_products || [];

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal customer-profile" role="dialog" aria-modal="true" aria-labelledby="customer-profile-title" style="max-width:560px;">
        <header class="customer-profile-head">
          <div>
            <h3 id="customer-profile-title">${escapeHTML(customer.name)}</h3>
            <p>${[customer.phone, customer.email].filter(Boolean).map(escapeHTML).join(' · ') || 'No contact details'}</p>
            ${customer.address ? `<p>${escapeHTML(customer.address)}</p>` : ''}
          </div>
          ${canEdit ? '<button class="btn btn-ghost btn-sm" type="button" id="profile-edit">Edit</button>' : ''}
        </header>
        <div class="profile-stats">
          <div><span>Total spent</span><strong>${formatCurrency(totalSpent)}</strong></div>
          <div><span>Orders</span><strong>${orderCount.toLocaleString('en-NG')}</strong></div>
          <div><span>Average order</span><strong>${orderCount ? formatCurrency(totalSpent / orderCount) : '—'}</strong></div>
          <div><span>Last visit</span><strong>${stats.last_visit ? formatDate(stats.last_visit) : '—'}</strong></div>
        </div>
        ${stats.partial ? '<p class="field-help">Totals cover the sales saved on this device. Connect to see the full history.</p>' : ''}
        ${customer.notes ? `<section class="profile-section"><h4>Notes</h4><p class="profile-notes">${escapeHTML(customer.notes)}</p></section>` : ''}
        ${favourites.length ? `
          <section class="profile-section">
            <h4>Buys most often</h4>
            <ul class="profile-list">
              ${favourites.map((item) => `<li><span>${escapeHTML(item.product_name)}</span><span>${Number(item.quantity).toLocaleString('en-NG')} bought</span></li>`).join('')}
            </ul>
          </section>` : ''}
        <section class="profile-section">
          <h4>Recent orders</h4>
          ${orders.length ? `
            <ul class="profile-list">
              ${orders.slice(0, 10).map((order) => `
                <li>
                  <span>${escapeHTML(order.order_number)}<small>${escapeHTML(formatDateTime(order.created_at))}</small></span>
                  <span>${formatCurrency(order.total)}${order.status !== 'completed' ? ` <span class="badge badge-danger">${escapeHTML(order.status)}</span>` : ''}</span>
                </li>`).join('')}
            </ul>` : '<p class="report-empty">No orders yet. Select this customer at checkout to build their history.</p>'}
        </section>
        <button class="btn btn-ghost" type="button" id="close-customer-profile" data-dialog-close style="width:100%;margin-top:1rem;">Close</button>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    overlay.querySelector('#close-customer-profile').addEventListener('click', () => overlay.remove());
    overlay.querySelector('#profile-edit')?.addEventListener('click', () => {
      overlay.remove();
      showCustomerModal(customer);
    });
  }

  function showCustomerModal(customer = null) {
    const isEdit = Boolean(customer);
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="customer-modal-title">
        <h3 id="customer-modal-title" style="font-weight:700;margin-bottom:1.25rem;">${isEdit ? 'Edit Customer' : 'Add Customer'}</h3>
        <form id="customer-form">
          <div class="form-group"><label class="label" for="customer-name">Name *</label><input class="input" id="customer-name" name="name" autocomplete="off" value="${escapeAttribute(customer?.name || '')}" required></div>
          <div class="form-group"><label class="label" for="customer-phone">Phone</label><input class="input" id="customer-phone" type="tel" inputmode="tel" name="phone" autocomplete="off" value="${escapeAttribute(customer?.phone || '')}"></div>
          <div class="form-group"><label class="label" for="customer-email">Email</label><input class="input" id="customer-email" type="email" name="email" autocomplete="off" spellcheck="false" value="${escapeAttribute(customer?.email || '')}"></div>
          <div class="form-group"><label class="label" for="customer-address">Address</label><input class="input" id="customer-address" name="address" autocomplete="off" value="${escapeAttribute(customer?.address || '')}"></div>
          <div class="form-group"><label class="label" for="customer-notes">Notes</label><textarea class="input" id="customer-notes" name="notes" rows="2" placeholder="For example: prefers size M, pays by transfer" style="resize:vertical;">${escapeHTML(customer?.notes || '')}</textarea></div>
          <div style="display:flex;gap:0.5rem;margin-top:1.25rem;">
            <button type="button" class="btn btn-ghost" id="cancel-customer" data-dialog-close style="flex:1;">Cancel</button>
            <button type="submit" class="btn btn-primary" style="flex:2;">${isEdit ? 'Save Changes' : 'Add Customer'}</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    document.getElementById('cancel-customer').addEventListener('click', () => overlay.remove());
    document.getElementById('customer-name').focus();

    document.getElementById('customer-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = new FormData(e.target);
      try {
        const payload = {
          name: form.get('name'),
          email: form.get('email') || undefined,
          phone: form.get('phone') || undefined,
          address: form.get('address') || undefined,
          notes: form.get('notes') || undefined,
        };
        if (isEdit) await api.patch('/customers/' + customer.id, payload);
        else await api.post('/customers', payload);
        toast(isEdit ? 'Customer updated' : 'Customer added', 'success');
        overlay.remove();
        loadCustomers();
      } catch (err) { toast(err.message, 'error'); }
    });
  }

  document.getElementById('add-customer-btn').addEventListener('click', () => showCustomerModal());
  document.getElementById('customer-search').addEventListener('input', debounce(loadCustomers, 250));
  document.getElementById('customer-sort').addEventListener('change', loadCustomers);

  await loadCustomers();
}
