import { api } from '../api.js';
import { renderLayout } from './layout.js';
import { toast } from '../utils.js';

export async function renderSettings() {
  const content = renderLayout('settings');
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  const isAdmin = user.role === 'admin';
  const isManager = user.role === 'manager';

  content.innerHTML = `
    <div class="animate-fade-in">
      <div class="page-header"><h2>Settings</h2></div>

      <div class="responsive-grid-2 settings-grid-responsive">
        ${isAdmin ? `
        <div class="glass-card" style="padding:1.5rem;">
          <h3 style="font-size:1rem;font-weight:700;margin-bottom:1.25rem;">🏪 Store Information</h3>
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
        ` : ''}

        ${isAdmin || isManager ? `
        <div class="glass-card" style="padding:1.5rem;align-self:start;">
          <h3 style="font-size:1rem;font-weight:700;margin-bottom:1.25rem;">🛡️ Security Settings</h3>
          <form id="security-form">
            <div class="form-group">
              <label class="label">Checkout Override PIN</label>
              <input class="input" type="password" id="s-manager-pin" placeholder="Enter 4-digit PIN" maxlength="4" style="letter-spacing:0.5rem;font-size:1.2rem;max-width:180px;">
              <p style="font-size:0.75rem;color:var(--color-text-muted);margin-top:0.4rem;line-height:1.4;">This PIN is required to authorize voided carts or high-risk actions by cashiers. It is saved locally to this specific terminal.</p>
            </div>
            <button type="submit" class="btn btn-primary" style="width:100%;margin-top:1rem;">Save Security PIN</button>
          </form>
        </div>
        ` : ''}

        <div class="glass-card" style="padding:1.5rem;grid-column:1/-1;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.25rem;">
            <h3 style="font-size:1rem;font-weight:700;">👥 Staff Management</h3>
            <button class="btn btn-primary btn-sm" id="add-staff-btn">+ Add Staff</button>
          </div>

          <!-- Permission info -->
          <div style="padding:0.5rem 0.75rem;border-radius:0.5rem;background:rgba(99,102,241,0.08);border:1px solid rgba(99,102,241,0.15);margin-bottom:1rem;font-size:0.75rem;color:var(--color-text-muted);">
            ${isAdmin
              ? '🔑 <strong>Admin:</strong> You can create admins, managers, and cashiers. Full control over all staff.'
              : '🔑 <strong>Manager:</strong> You can create and manage cashier accounts only.'
            }
          </div>

          <div id="staff-list"><div class="spinner" style="margin:1rem auto;"></div></div>
        </div>
      </div>

      <!-- Role Permissions Reference -->
      <div class="glass-card" style="padding:1.5rem;margin-top:1.5rem;">
        <h3 style="font-size:1rem;font-weight:700;margin-bottom:1rem;">📋 Role Permissions</h3>
        <div style="overflow-x:auto;">
          <table class="data-table" style="font-size:0.8rem;">
            <thead>
              <tr>
                <th>Feature</th>
                <th style="text-align:center;">👑 Admin</th>
                <th style="text-align:center;">🏢 Manager</th>
                <th style="text-align:center;">💳 Cashier</th>
              </tr>
            </thead>
            <tbody>
              <tr><td>Dashboard</td><td style="text-align:center;">✅</td><td style="text-align:center;">✅</td><td style="text-align:center;">✅</td></tr>
              <tr><td>POS Terminal</td><td style="text-align:center;">✅</td><td style="text-align:center;">✅</td><td style="text-align:center;">✅</td></tr>
              <tr><td>Products (CRUD)</td><td style="text-align:center;">✅</td><td style="text-align:center;">✅</td><td style="text-align:center;">View only</td></tr>
              <tr><td>Inventory</td><td style="text-align:center;">✅</td><td style="text-align:center;">✅</td><td style="text-align:center;">❌</td></tr>
              <tr><td>Customers</td><td style="text-align:center;">✅ Full</td><td style="text-align:center;">✅ No delete</td><td style="text-align:center;">View + Add</td></tr>
              <tr><td>Orders</td><td style="text-align:center;">✅ + Refund</td><td style="text-align:center;">✅ All orders</td><td style="text-align:center;">Own only</td></tr>
              <tr><td>Reports</td><td style="text-align:center;">✅ + Export</td><td style="text-align:center;">✅ View only</td><td style="text-align:center;">❌</td></tr>
              <tr><td>Store Settings</td><td style="text-align:center;">✅</td><td style="text-align:center;">❌</td><td style="text-align:center;">❌</td></tr>
              <tr><td>Staff Management</td><td style="text-align:center;">✅ All roles</td><td style="text-align:center;">Cashiers only</td><td style="text-align:center;">❌</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  // Load store settings (admin only)
  if (isAdmin) {
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

    document.getElementById('store-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = new FormData(e.target);
      try {
        await api.patch('/settings/store', {
          name: form.get('name'), address: form.get('address'),
          phone: form.get('phone'), email: form.get('email'),
          tax_rate: parseFloat(form.get('tax_rate')), currency: form.get('currency'),
          receipt_header: form.get('receipt_header'), receipt_footer: form.get('receipt_footer'),
        });
        toast('Settings saved', 'success');
      } catch (err) { toast(err.message, 'error'); }
    });
  }

  if (isAdmin || isManager) {
    const savedPin = localStorage.getItem('quickpos_manager_pin') || '';
    const pinInput = document.getElementById('s-manager-pin');
    if (pinInput && savedPin) pinInput.value = savedPin;

    const secForm = document.getElementById('security-form');
    if (secForm) {
      secForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const pin = document.getElementById('s-manager-pin').value.trim();
        if (pin.length < 4) return toast('PIN should be at least 4 characters', 'error');
        localStorage.setItem('quickpos_manager_pin', pin);
        toast('Security PIN saved securely to this terminal', 'success');
      });
    }
  }

  // Staff list
  async function loadStaff() {
    try {
      const { users: staff } = await api.get('/settings/users');
      const staffList = document.getElementById('staff-list');

      if (staff.length === 0) {
        staffList.innerHTML = '<div class="empty-state" style="padding:1rem;">No staff members found</div>';
        return;
      }

      staffList.innerHTML = staff.map(u => {
        const isSelf = u.id === user.id;
        const roleBadge = u.role === 'admin' ? 'badge-info' : u.role === 'manager' ? 'badge-warning' : 'badge-success';
        const roleIcon = u.role === 'admin' ? '👑' : u.role === 'manager' ? '🏢' : '💳';
        const canModify = isAdmin || (isManager && u.role === 'cashier');
        const canEdit = canModify && !isSelf;
        const canChangeRole = isAdmin && !isSelf;
        const canDelete = canModify && !isSelf;
        const canToggle = canModify && !isSelf;

        return `
          <div style="display:flex;align-items:center;justify-content:space-between;padding:0.75rem 0;border-bottom:1px solid var(--color-border);">
            <div style="display:flex;align-items:center;gap:0.75rem;">
              <div style="width:36px;height:36px;border-radius:50%;background:var(--color-surface-3);display:flex;align-items:center;justify-content:center;font-size:1rem;">${roleIcon}</div>
              <div>
                <div style="font-weight:600;font-size:0.9rem;">${u.name} ${isSelf ? '<span style="font-size:0.7rem;color:var(--color-primary);">(You)</span>' : ''}</div>
                <div style="font-size:0.75rem;color:var(--color-text-muted);">${u.email}</div>
                ${u.created_by ? `<div style="font-size:0.7rem;color:var(--color-text-muted);margin-top:0.15rem;">Created by ${u.created_by}</div>` : ''}
              </div>
            </div>
            <div style="display:flex;align-items:center;gap:0.5rem;">
              ${canChangeRole ? `
                <select class="input" style="width:auto;padding:0.3rem 0.5rem;font-size:0.75rem;" data-user-id="${u.id}" data-action="change-role">
                  <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option>
                  <option value="manager" ${u.role === 'manager' ? 'selected' : ''}>Manager</option>
                  <option value="cashier" ${u.role === 'cashier' ? 'selected' : ''}>Cashier</option>
                </select>
              ` : `
                <span class="badge ${roleBadge}">${u.role}</span>
              `}
              <span class="badge ${u.is_active ? 'badge-success' : 'badge-danger'}" style="cursor:${canToggle ? 'pointer' : 'default'};" ${canToggle ? `data-user-id="${u.id}" data-action="toggle-active" data-active="${u.is_active}"` : ''}>${u.is_active ? 'Active' : 'Inactive'}</span>
              ${canEdit ? `<button class="btn btn-ghost btn-sm" data-user-id="${u.id}" data-user-name="${u.name}" data-user-email="${u.email}" data-action="edit-staff" style="padding:0.25rem 0.5rem;font-size:0.75rem;" title="Edit credentials">✏️</button>` : ''}
              ${canDelete ? `<button class="btn btn-ghost btn-sm" data-user-id="${u.id}" data-action="delete" style="color:var(--color-danger);padding:0.25rem 0.5rem;font-size:0.75rem;">×</button>` : ''}
            </div>
          </div>
        `;
      }).join('');

      // Event delegation for staff actions
      staffList.querySelectorAll('[data-action="change-role"]').forEach(el => {
        el.addEventListener('change', async (e) => {
          const uid = e.target.dataset.userId;
          try {
            await api.patch(`/settings/users/${uid}`, { role: e.target.value });
            toast('Role updated', 'success');
            loadStaff();
          } catch (err) { toast(err.message, 'error'); loadStaff(); }
        });
      });

      staffList.querySelectorAll('[data-action="toggle-active"]').forEach(el => {
        el.addEventListener('click', async () => {
          const uid = el.dataset.userId;
          const newState = el.dataset.active === 'true' ? false : true;
          try {
            await api.patch(`/settings/users/${uid}`, { is_active: newState });
            toast(`User ${newState ? 'activated' : 'deactivated'}`, 'success');
            loadStaff();
          } catch (err) { toast(err.message, 'error'); }
        });
      });

      staffList.querySelectorAll('[data-action="delete"]').forEach(el => {
        el.addEventListener('click', async () => {
          const uid = el.dataset.userId;
          if (!confirm('Are you sure you want to delete this staff member?')) return;
          try {
            await api.delete(`/settings/users/${uid}`);
            toast('Staff member deleted', 'success');
            loadStaff();
          } catch (err) { toast(err.message, 'error'); }
        });
      });

      // Edit staff credentials
      staffList.querySelectorAll('[data-action="edit-staff"]').forEach(el => {
        el.addEventListener('click', () => {
          const uid = el.dataset.userId;
          const uName = el.dataset.userName;
          const uEmail = el.dataset.userEmail;
          showEditStaffModal(uid, uName, uEmail);
        });
      });

    } catch (err) { toast('Failed to load staff', 'error'); }
  }

  // Edit staff credentials modal
  function showEditStaffModal(userId, currentName, currentEmail) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal" style="max-width:420px;">
        <h3 style="font-weight:700;margin-bottom:0.5rem;">Edit Staff Credentials</h3>
        <p style="font-size:0.8rem;color:var(--color-text-muted);margin-bottom:1.25rem;">Update login details for <strong>${currentName}</strong></p>
        <form id="edit-staff-form">
          <div class="form-group">
            <label class="label">Full Name</label>
            <input class="input" name="name" value="${currentName}" placeholder="Full name">
          </div>
          <div class="form-group">
            <label class="label">Email</label>
            <input class="input" type="email" name="email" value="${currentEmail}" placeholder="Email address">
          </div>
          <div class="form-group">
            <label class="label">New Password</label>
            <input class="input" type="password" name="password" placeholder="Leave blank to keep current password" minlength="4">
            <p style="font-size:0.7rem;color:var(--color-text-muted);margin-top:0.25rem;">Only fill this if you want to change the password</p>
          </div>
          <div style="display:flex;gap:0.5rem;margin-top:1.25rem;">
            <button type="button" class="btn btn-ghost" id="cancel-edit" style="flex:1;">Cancel</button>
            <button type="submit" class="btn btn-primary" style="flex:2;">Save Changes</button>
          </div>
        </form>
      </div>
    `;

    document.body.appendChild(overlay);
    document.getElementById('cancel-edit').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    document.getElementById('edit-staff-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = new FormData(e.target);
      const updates = {};
      const newName = form.get('name').trim();
      const newEmail = form.get('email').trim();
      const newPassword = form.get('password');

      if (newName && newName !== currentName) updates.name = newName;
      if (newEmail && newEmail !== currentEmail) updates.email = newEmail;
      if (newPassword) updates.password = newPassword;

      if (Object.keys(updates).length === 0) {
        toast('No changes made', 'info');
        overlay.remove();
        return;
      }

      try {
        await api.patch(`/settings/users/${userId}`, updates);
        toast('Credentials updated successfully', 'success');
        overlay.remove();
        loadStaff();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }

  loadStaff();

  // Add staff modal
  document.getElementById('add-staff-btn').addEventListener('click', () => {
    const allowedRoles = isAdmin ? ['admin', 'manager', 'cashier'] : ['cashier'];

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal" style="max-width:420px;">
        <h3 style="font-weight:700;margin-bottom:1.25rem;">Add Staff Member</h3>
        <form id="staff-form">
          <div class="form-group">
            <label class="label">Full Name *</label>
            <input class="input" name="name" placeholder="Enter full name" required>
          </div>
          <div class="form-group">
            <label class="label">Email *</label>
            <input class="input" type="email" name="email" placeholder="Enter email address" required>
          </div>
          <div class="form-group">
            <label class="label">Password *</label>
            <input class="input" type="password" name="password" placeholder="Set initial password" minlength="4" required>
          </div>
          <div class="form-group">
            <label class="label">Role *</label>
            <select class="input" name="role" required>
              ${allowedRoles.map(r => `<option value="${r}">${r === 'admin' ? '👑 Admin' : r === 'manager' ? '🏢 Manager' : '💳 Cashier'}</option>`).join('')}
            </select>
            <p style="font-size:0.7rem;color:var(--color-text-muted);margin-top:0.35rem;">
              ${isAdmin ? 'You can assign any role.' : 'As a manager, you can only create cashier accounts.'}
            </p>
          </div>
          <div style="display:flex;gap:0.5rem;margin-top:1.25rem;">
            <button type="button" class="btn btn-ghost" id="cancel-staff" style="flex:1;">Cancel</button>
            <button type="submit" class="btn btn-primary" style="flex:2;">Create Staff</button>
          </div>
        </form>
      </div>
    `;

    document.body.appendChild(overlay);
    document.getElementById('cancel-staff').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    document.getElementById('staff-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = new FormData(e.target);
      try {
        await api.post('/settings/users', {
          name: form.get('name'),
          email: form.get('email'),
          password: form.get('password'),
          role: form.get('role'),
        });
        toast('Staff member created!', 'success');
        overlay.remove();
        loadStaff();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  });
}
