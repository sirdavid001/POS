import { api } from '../api.js';
import { renderLayout } from './layout.js';
import { formatCurrency, formatDate, toast, icons } from '../utils.js';

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
            <button class="btn btn-ghost btn-sm edit-customer" data-id="${c.id}">Edit</button>
            <button class="btn btn-ghost btn-sm delete-customer" data-id="${c.id}" style="color:var(--color-danger);">Delete</button>
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
