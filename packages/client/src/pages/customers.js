import { api } from '../api.js';
import { renderLayout } from './layout.js';
import { escapeAttribute, escapeHTML, formatDate, toast, icons } from '../utils.js';

export async function renderCustomers() {
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  const canEdit = ['admin', 'manager'].includes(user.role);
  const canDelete = user.role === 'admin';
  const content = renderLayout('customers');

  content.innerHTML = `
    <div class="animate-fade-in">
      <div class="page-header">
        <h2>Customers</h2>
        <button class="btn btn-primary" id="add-customer-btn">${icons.plus} Add Customer</button>
      </div>
      <input class="input" type="text" id="customer-search" placeholder="Search customers..." style="max-width:320px;margin-bottom:1rem;">
      <div class="glass-card table-scroll-wrapper">
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
          <td style="font-weight:600;">${escapeHTML(c.name)}</td>
          <td style="font-size:0.85rem;color:var(--color-text-muted);">${escapeHTML(c.email || '-')}</td>
          <td>${escapeHTML(c.phone || '-')}</td>
          <td><span class="badge badge-info">${c.loyalty_points} pts</span></td>
          <td style="font-size:0.8rem;color:var(--color-text-muted);">${formatDate(c.created_at)}</td>
          <td>
            ${canEdit ? `<button class="btn btn-ghost btn-sm edit-customer" data-id="${escapeAttribute(c.id)}">Edit</button>` : ''}
            ${canDelete ? `<button class="btn btn-ghost btn-sm delete-customer" data-id="${escapeAttribute(c.id)}" style="color:var(--color-danger);">Delete</button>` : ''}
          </td>
        </tr>
      `).join('');

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

      tbody.querySelectorAll('.edit-customer').forEach(btn => {
        btn.addEventListener('click', async () => {
          try {
            const { customer } = await api.get('/customers/' + btn.dataset.id);
            showCustomerModal(customer);
          } catch (err) { toast(err.message || 'Could not load customer', 'error'); }
        });
      });
    } catch { toast('Failed to load customers', 'error'); }
  }

  document.getElementById('customer-search').addEventListener('input', () => setTimeout(loadCustomers, 300));

  function showCustomerModal(customer = null) {
    const isEdit = Boolean(customer);
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="customer-modal-title">
        <h3 id="customer-modal-title" style="font-weight:700;margin-bottom:1.25rem;">${isEdit ? 'Edit Customer' : 'Add Customer'}</h3>
        <form id="customer-form">
          <div class="form-group"><label class="label" for="customer-name">Name *</label><input class="input" id="customer-name" name="name" value="${escapeAttribute(customer?.name || '')}" required></div>
          <div class="form-group"><label class="label" for="customer-email">Email</label><input class="input" id="customer-email" type="email" name="email" value="${escapeAttribute(customer?.email || '')}"></div>
          <div class="form-group"><label class="label" for="customer-phone">Phone</label><input class="input" id="customer-phone" name="phone" value="${escapeAttribute(customer?.phone || '')}"></div>
          <div class="form-group"><label class="label" for="customer-address">Address</label><input class="input" id="customer-address" name="address" value="${escapeAttribute(customer?.address || '')}"></div>
          <div style="display:flex;gap:0.5rem;margin-top:1.25rem;">
            <button type="button" class="btn btn-ghost" id="cancel-customer" style="flex:1;">Cancel</button>
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

  await loadCustomers();
}
