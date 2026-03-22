import { api } from '../api.js';
import { renderLayout } from './layout.js';
import { toast } from '../utils.js';

export async function renderSettings() {
  const content = renderLayout('settings');

  content.innerHTML = `
    <div class="animate-fade-in">
      <div class="page-header"><h2>Settings</h2></div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1.5rem;">
        <div class="glass-card" style="padding:1.5rem;">
          <h3 style="font-size:1rem;font-weight:700;margin-bottom:1.25rem;">Store Information</h3>
          <form id="store-form">
            <div class="form-group"><label class="label">Store Name</label><input class="input" name="name" id="s-name"></div>
            <div class="form-group"><label class="label">Address</label><input class="input" name="address" id="s-address"></div>
            <div class="form-group"><label class="label">Phone</label><input class="input" name="phone" id="s-phone"></div>
            <div class="form-group"><label class="label">Email</label><input class="input" type="email" name="email" id="s-email"></div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
              <div class="form-group"><label class="label">Tax Rate (%)</label><input class="input" type="number" step="0.01" name="tax_rate" id="s-tax"></div>
              <div class="form-group"><label class="label">Currency</label><input class="input" name="currency" id="s-currency"></div>
            </div>
            <div class="form-group"><label class="label">Receipt Header</label><textarea class="input" name="receipt_header" id="s-rh" rows="2" style="resize:vertical;"></textarea></div>
            <div class="form-group"><label class="label">Receipt Footer</label><textarea class="input" name="receipt_footer" id="s-rf" rows="2" style="resize:vertical;"></textarea></div>
            <button type="submit" class="btn btn-primary" style="width:100%;">Save Settings</button>
          </form>
        </div>

        <div class="glass-card" style="padding:1.5rem;">
          <h3 style="font-size:1rem;font-weight:700;margin-bottom:1.25rem;">Staff Management</h3>
          <div id="staff-list"><div class="spinner"></div></div>
        </div>
      </div>
    </div>
  `;

  // Load store settings
  try {
    const { store } = await api.get('/settings/store');
    document.getElementById('s-name').value = store.name || '';
    document.getElementById('s-address').value = store.address || '';
    document.getElementById('s-phone').value = store.phone || '';
    document.getElementById('s-email').value = store.email || '';
    document.getElementById('s-tax').value = store.tax_rate || '';
    document.getElementById('s-currency').value = store.currency || 'NGN';
    document.getElementById('s-rh').value = store.receipt_header || '';
    document.getElementById('s-rf').value = store.receipt_footer || '';
  } catch (err) { toast('Failed to load settings', 'error'); }

  // Save store settings
  document.getElementById('store-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    try {
      await api.patch('/settings/store', {
        name: form.get('name'),
        address: form.get('address'),
        phone: form.get('phone'),
        email: form.get('email'),
        tax_rate: parseFloat(form.get('tax_rate')),
        currency: form.get('currency'),
        receipt_header: form.get('receipt_header'),
        receipt_footer: form.get('receipt_footer'),
      });
      toast('Settings saved', 'success');
    } catch (err) { toast(err.message, 'error'); }
  });

  // Load staff
  try {
    const { users } = await api.get('/settings/users');
    document.getElementById('staff-list').innerHTML = users.map(u => `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:0.75rem 0;border-bottom:1px solid var(--color-border);">
        <div>
          <div style="font-weight:600;font-size:0.9rem;">${u.name}</div>
          <div style="font-size:0.8rem;color:var(--color-text-muted);">${u.email}</div>
        </div>
        <div style="display:flex;align-items:center;gap:0.75rem;">
          <select class="input" style="width:auto;padding:0.375rem 0.5rem;font-size:0.8rem;" data-user-id="${u.id}" onchange="window._changeRole(${u.id}, this.value)">
            <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option>
            <option value="manager" ${u.role === 'manager' ? 'selected' : ''}>Manager</option>
            <option value="cashier" ${u.role === 'cashier' ? 'selected' : ''}>Cashier</option>
          </select>
          <span class="badge ${u.is_active ? 'badge-success' : 'badge-danger'}">${u.is_active ? 'Active' : 'Inactive'}</span>
        </div>
      </div>
    `).join('');
  } catch {}

  window._changeRole = async (userId, role) => {
    try {
      await api.patch(`/settings/users/${userId}`, { role });
      toast('Role updated', 'success');
    } catch (err) { toast(err.message, 'error'); }
  };
}
