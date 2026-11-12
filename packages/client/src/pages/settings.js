import { api } from '../api.js';
import { renderLayout } from './layout.js';
import { SUPPORTED_CURRENCIES, escapeAttribute, escapeHTML, formatCurrency, icons, setStoreCurrency, toast } from '../utils.js';

// Shrinks an uploaded logo to at most 240px so it stays small enough to store and print.
async function resizeLogo(file) {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('Choose a PNG, JPG or WebP image');
  if (file.size > 5 * 1024 * 1024) throw new Error('Choose an image under 5 MB');
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('That image could not be read'));
      img.src = url;
    });
    const scale = Math.min(1, 240 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    let dataUrl = canvas.toDataURL('image/webp', 0.9);
    if (!dataUrl.startsWith('data:image/webp')) dataUrl = canvas.toDataURL('image/png');
    if (dataUrl.length > 240000) throw new Error('That logo is too detailed. Try a simpler or smaller image.');
    return dataUrl;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function renderSettings() {
  const content = renderLayout('settings');
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  const isAdmin = user.role === 'admin';
  const isManager = user.role === 'manager';

  const tabs = [
    ...(isAdmin ? [['store', 'Store'], ['receipt', 'Receipt']] : []),
    ['staff', 'Staff'],
    ['permissions', 'Permissions'],
    ['legal', 'Legal & privacy'],
  ];
  const requestedTab = new URLSearchParams(window.location.hash.split('?')[1] || '').get('tab');
  let activeTab = tabs.some(([id]) => id === requestedTab) ? requestedTab : tabs[0][0];
  const yes = 'Yes';
  const no = '<span class="muted-cell">No</span>';

  content.innerHTML = `
    <div class="animate-fade-in">
      <div class="page-header"><h1>Settings</h1></div>

      <div class="settings-tabs" role="tablist" aria-label="Settings sections">
        ${tabs.map(([id, label]) => `<button type="button" role="tab" id="tab-${id}" data-tab="${id}" aria-controls="panel-${id}" aria-selected="${id === activeTab}" tabindex="${id === activeTab ? 0 : -1}">${label}</button>`).join('')}
      </div>

      ${isAdmin ? `
      <form id="store-form" class="settings-form" novalidate>
        <section class="glass-card settings-panel" role="tabpanel" id="panel-store" aria-labelledby="tab-store" tabindex="0">
          <h2>Store details</h2>
          <p class="settings-help">These details appear on receipts and owner statements.</p>
          <div class="form-group">
            <span class="label" id="logo-label">Logo</span>
            <div class="logo-row">
              <div class="logo-preview" id="logo-preview" aria-labelledby="logo-label"></div>
              <div class="logo-actions">
                <label class="btn btn-ghost btn-sm" for="logo-file">Upload logo</label>
                <input class="sr-only" type="file" id="logo-file" accept="image/png,image/jpeg,image/webp">
                <button type="button" class="btn btn-ghost btn-sm" id="logo-remove">Remove</button>
                <p class="field-help">PNG, JPG or WebP. It is resized to fit receipts.</p>
              </div>
            </div>
          </div>
          <div class="form-group"><label class="label" for="s-name">Store name</label><input class="input" name="name" id="s-name" autocomplete="organization" required></div>
          <div class="form-group"><label class="label" for="s-address">Address</label><input class="input" name="address" id="s-address" autocomplete="street-address"></div>
          <div class="form-grid-2">
            <div class="form-group"><label class="label" for="s-phone">Phone</label><input class="input" type="tel" inputmode="tel" name="phone" id="s-phone" autocomplete="tel"></div>
            <div class="form-group"><label class="label" for="s-email">Email</label><input class="input" type="email" name="email" id="s-email" autocomplete="email" spellcheck="false"></div>
          </div>
          <div class="form-grid-2">
            <div class="form-group"><label class="label" for="s-tax">Tax rate (%)</label><input class="input" type="number" inputmode="decimal" min="0" max="100" step="0.01" name="tax_rate" id="s-tax"></div>
            <div class="form-group">
              <label class="label" for="s-currency">Currency</label>
              <select class="input" name="currency" id="s-currency">
                ${SUPPORTED_CURRENCIES.map(([code, label]) => `<option value="${code}">${escapeHTML(label)}</option>`).join('')}
              </select>
            </div>
          </div>
          <button type="submit" class="btn btn-primary">Save store details</button>
        </section>

        <section class="glass-card settings-panel" role="tabpanel" id="panel-receipt" aria-labelledby="tab-receipt" tabindex="0">
          <h2>Receipt</h2>
          <p class="settings-help">Add a greeting at the top and your returns policy or social handles at the bottom. The preview updates as you type.</p>
          <div class="receipt-editor">
            <div>
              <div class="form-group"><label class="label" for="s-rh">Top message</label><textarea class="input" name="receipt_header" id="s-rh" rows="3" maxlength="500" placeholder="For example: Thank you for shopping with us" style="resize:vertical;"></textarea></div>
              <div class="form-group"><label class="label" for="s-rf">Bottom message</label><textarea class="input" name="receipt_footer" id="s-rf" rows="3" maxlength="500" placeholder="For example: Goods bought in good condition can be returned within 7 days" style="resize:vertical;"></textarea></div>
              <button type="submit" class="btn btn-primary">Save receipt</button>
            </div>
            <div class="receipt-preview" id="receipt-preview" aria-label="Receipt preview"></div>
          </div>
        </section>
      </form>
      ` : ''}

      <section class="glass-card settings-panel" role="tabpanel" id="panel-staff" aria-labelledby="tab-staff" tabindex="0">
        <div class="report-card-head">
          <h2>Staff</h2>
          <button class="btn btn-primary btn-sm" id="add-staff-btn" type="button">${icons.plus} Add staff</button>
        </div>
        <p class="settings-help">${isAdmin
          ? 'You can create admins, managers and cashiers, and change their access.'
          : 'As a manager you can create and manage cashier accounts.'}</p>
        <div id="staff-list"><div class="spinner" style="margin:1rem auto;"></div></div>
      </section>

      <section class="glass-card settings-panel" role="tabpanel" id="panel-permissions" aria-labelledby="tab-permissions" tabindex="0">
        <h2>What each role can do</h2>
        <div class="table-scroll-wrapper">
          <table class="data-table permissions-table">
            <thead>
              <tr><th>Area</th>${isAdmin ? '<th>Admin</th>' : ''}<th>Manager</th><th>Cashier</th></tr>
            </thead>
            <tbody>
              <tr><td>Dashboard</td>${isAdmin ? `<td>${yes}</td>` : ''}<td>${yes}</td><td>${yes}</td></tr>
              <tr><td>POS terminal</td>${isAdmin ? `<td>${yes}</td>` : ''}<td>${yes}</td><td>${yes}</td></tr>
              <tr><td>Products</td>${isAdmin ? `<td>${yes}</td>` : ''}<td>${yes}</td><td>${no}</td></tr>
              <tr><td>Inventory</td>${isAdmin ? `<td>${yes}</td>` : ''}<td>${yes}</td><td>${no}</td></tr>
              <tr><td>Customers</td>${isAdmin ? `<td>${yes}</td>` : ''}<td>Yes, except delete</td><td>View and add</td></tr>
              <tr><td>Orders and refunds</td>${isAdmin ? `<td>${yes}</td>` : ''}<td>${yes}</td><td>Own receipts only</td></tr>
              <tr><td>Reports and exports</td>${isAdmin ? `<td>${yes}</td>` : ''}<td>${yes}</td><td>${no}</td></tr>
              <tr><td>Store settings</td>${isAdmin ? `<td>${yes}</td>` : ''}<td>${no}</td><td>${no}</td></tr>
              <tr><td>Staff</td>${isAdmin ? '<td>All roles</td>' : ''}<td>Cashiers only</td><td>${no}</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="glass-card settings-legal-card settings-panel" role="tabpanel" id="panel-legal" aria-labelledby="tab-legal" tabindex="0">
        <div class="settings-legal-copy">
          <span class="settings-legal-kicker">Legal &amp; Privacy</span>
          <h3>Know the terms behind your store account</h3>
          <p>Review the current legal documents, refund rules, and how to exercise data protection rights. The current document versions took effect on June 11, 2026.</p>
        </div>
        <div class="settings-legal-links">
          <a href="https://quickpos.com.ng/terms" target="_blank" rel="noopener noreferrer">
            <strong>Terms of Service</strong>
            <span>Accounts, billing, use, and liability</span>
          </a>
          <a href="https://quickpos.com.ng/privacy" target="_blank" rel="noopener noreferrer">
            <strong>Privacy Policy</strong>
            <span>Processing, retention, and your rights</span>
          </a>
          <a href="https://quickpos.com.ng/refund" target="_blank" rel="noopener noreferrer">
            <strong>Refund Policy</strong>
            <span>Cancellation and payment reviews</span>
          </a>
        </div>
        <div class="settings-legal-footer">
          <span>Legal or data request?</span>
          <a href="mailto:support@quickpos.com.ng">support@quickpos.com.ng</a>
        </div>
      </section>
    </div>
  `;

  // Tabs: one panel at a time, arrow keys move between tabs, the URL remembers the tab.
  const tabButtons = [...content.querySelectorAll('[role="tab"]')];
  function showTab(id, { focus = false } = {}) {
    activeTab = id;
    tabButtons.forEach((button) => {
      const selected = button.dataset.tab === id;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
      if (selected && focus) button.focus();
    });
    content.querySelectorAll('.settings-panel').forEach((panel) => { panel.hidden = panel.id !== `panel-${id}`; });
    history.replaceState(null, '', `#/settings?tab=${id}`);
  }
  tabButtons.forEach((button, index) => {
    button.addEventListener('click', () => showTab(button.dataset.tab));
    button.addEventListener('keydown', (event) => {
      const moves = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: tabButtons.length - 1 };
      if (!(event.key in moves)) return;
      event.preventDefault();
      const next = tabButtons[(moves[event.key] + tabButtons.length) % tabButtons.length];
      showTab(next.dataset.tab, { focus: true });
    });
  });
  showTab(activeTab);

  // Store details, logo and receipt (admin only)
  if (isAdmin) {
    const form = document.getElementById('store-form');
    let logoUrl = '';

    function renderLogo() {
      const preview = document.getElementById('logo-preview');
      preview.innerHTML = logoUrl
        ? `<img src="${escapeAttribute(logoUrl)}" alt="Store logo" width="64" height="64">`
        : '<span>No logo</span>';
      document.getElementById('logo-remove').hidden = !logoUrl;
    }

    function renderReceiptPreview() {
      const value = (name) => form.elements[name].value.trim();
      const rate = Number(value('tax_rate')) || 0;
      const subtotal = 3500;
      const tax = Math.round(subtotal * rate) / 100;
      document.getElementById('receipt-preview').innerHTML = `
        <div class="receipt-sample">
          ${logoUrl ? `<img src="${escapeAttribute(logoUrl)}" alt="" width="48" height="48">` : ''}
          <strong>${escapeHTML(value('name') || 'Your store')}</strong>
          ${value('address') ? `<span>${escapeHTML(value('address'))}</span>` : ''}
          ${value('phone') ? `<span>${escapeHTML(value('phone'))}</span>` : ''}
          ${value('receipt_header') ? `<p>${escapeHTML(value('receipt_header'))}</p>` : ''}
          <div class="receipt-sample-line"><span>Sample item × 1</span><span>${formatCurrency(subtotal)}</span></div>
          ${rate ? `<div class="receipt-sample-line"><span>Tax (${rate}%)</span><span>${formatCurrency(tax)}</span></div>` : ''}
          <div class="receipt-sample-line receipt-sample-total"><span>TOTAL</span><span>${formatCurrency(subtotal + tax)}</span></div>
          ${value('receipt_footer') ? `<p>${escapeHTML(value('receipt_footer'))}</p>` : ''}
        </div>`;
    }

    try {
      const { store } = await api.get('/settings/store');
      document.getElementById('s-name').value = store.name || '';
      document.getElementById('s-address').value = store.address || '';
      document.getElementById('s-phone').value = store.phone || '';
      document.getElementById('s-email').value = store.email || '';
      document.getElementById('s-tax').value = store.tax_rate ?? '';
      const currency = String(store.currency || 'NGN').toUpperCase();
      const currencySelect = document.getElementById('s-currency');
      if (![...currencySelect.options].some((option) => option.value === currency)) {
        currencySelect.add(new Option(currency, currency));
      }
      currencySelect.value = currency;
      document.getElementById('s-rh').value = store.receipt_header || '';
      document.getElementById('s-rf').value = store.receipt_footer || '';
      logoUrl = store.logo_url || '';
    } catch { toast('Failed to load settings', 'error'); }
    renderLogo();
    renderReceiptPreview();
    form.addEventListener('input', renderReceiptPreview);

    document.getElementById('logo-file').addEventListener('change', async (event) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;
      try {
        logoUrl = await resizeLogo(file);
        renderLogo();
        renderReceiptPreview();
        toast('Logo ready. Save store details to keep it.', 'info');
      } catch (err) { toast(err.message, 'error'); }
    });
    document.getElementById('logo-remove').addEventListener('click', () => {
      logoUrl = '';
      renderLogo();
      renderReceiptPreview();
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = new FormData(form);
      if (!String(data.get('name') || '').trim()) {
        showTab('store');
        toast('Enter the store name', 'warning');
        document.getElementById('s-name').focus();
        return;
      }
      const taxRate = data.get('tax_rate') === '' ? 0 : parseFloat(data.get('tax_rate'));
      if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) {
        showTab('store');
        toast('Tax rate must be between 0 and 100', 'warning');
        document.getElementById('s-tax').focus();
        return;
      }
      try {
        await api.patch('/settings/store', {
          name: data.get('name'), address: data.get('address'),
          phone: data.get('phone'), email: data.get('email'),
          tax_rate: taxRate, currency: data.get('currency'),
          logo_url: logoUrl,
          receipt_header: data.get('receipt_header'), receipt_footer: data.get('receipt_footer'),
        });
        setStoreCurrency(data.get('currency'));
        toast('Settings saved', 'success');
      } catch (err) { toast(err.message, 'error'); }
    });
  }

  // Staff list
  async function loadStaff() {
    try {
      const staffResponse = await api.get('/settings/users');
      const staff = staffResponse.users;
      const offlineMode = Boolean(staffResponse.offline);
      const staffList = document.getElementById('staff-list');

      if (staff.length === 0) {
        staffList.innerHTML = '<div class="empty-state" style="padding:1rem;">No staff members found</div>';
        return;
      }

      staffList.innerHTML = `${offlineMode ? `
        <div class="offline-security-note">
          Staff accounts are available to review offline. Connect to the internet to change login access or passwords securely.
        </div>
      ` : ''}${staff.map(u => {
        const isSelf = u.id === user.id;
        const roleBadge = u.role === 'admin' ? 'badge-info' : u.role === 'manager' ? 'badge-warning' : 'badge-success';
        const initial = escapeHTML(String(u.name || u.email || '?').trim().charAt(0).toUpperCase());
        const canModify = isAdmin || (isManager && u.role === 'cashier');
        const canEdit = canModify && !isSelf;
        const canChangeRole = isAdmin && !isSelf;
        const canDelete = canModify && !isSelf;
        const canToggle = canModify && !isSelf;

        return `
          <div style="display:flex;align-items:center;justify-content:space-between;padding:0.75rem 0;border-bottom:1px solid var(--color-border);">
            <div style="display:flex;align-items:center;gap:0.75rem;">
              <div style="width:36px;height:36px;border-radius:50%;background:var(--color-surface-3);display:flex;align-items:center;justify-content:center;font-size:0.9rem;font-weight:700;" aria-hidden="true">${initial}</div>
              <div>
                <div style="font-weight:600;font-size:0.9rem;">${escapeHTML(u.name)} ${isSelf ? '<span style="font-size:0.7rem;color:var(--color-primary);">(You)</span>' : ''}</div>
                <div style="font-size:0.75rem;color:var(--color-text-muted);">${escapeHTML(u.email)}</div>
                ${u.created_by ? `<div style="font-size:0.7rem;color:var(--color-text-muted);margin-top:0.15rem;">Created by ${escapeHTML(u.created_by)}</div>` : ''}
              </div>
            </div>
            <div style="display:flex;align-items:center;gap:0.5rem;">
              ${canChangeRole ? `
                <select class="input" style="width:auto;padding:0.3rem 0.5rem;font-size:0.75rem;" data-user-id="${escapeAttribute(u.id)}" data-action="change-role">
                  <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option>
                  <option value="manager" ${u.role === 'manager' ? 'selected' : ''}>Manager</option>
                  <option value="cashier" ${u.role === 'cashier' ? 'selected' : ''}>Cashier</option>
                </select>
              ` : `
                <span class="badge ${roleBadge}">${escapeHTML(u.role)}</span>
              `}
              <button type="button" class="badge ${u.is_active ? 'badge-success' : 'badge-danger'} staff-status" style="cursor:${canToggle ? 'pointer' : 'default'};" ${canToggle ? `data-user-id="${escapeAttribute(u.id)}" data-action="toggle-active" data-active="${u.is_active}"` : 'disabled'}>${u.is_active ? 'Active' : 'Inactive'}</button>
              ${canEdit ? `<button class="btn btn-ghost btn-sm" data-user-id="${escapeAttribute(u.id)}" data-user-name="${escapeAttribute(u.name)}" data-user-email="${escapeAttribute(u.email)}" data-action="edit-staff" style="padding:0.25rem 0.5rem;font-size:0.75rem;" aria-label="Edit ${escapeAttribute(u.name)} credentials">Edit</button>` : ''}
              ${canDelete ? `<button class="btn btn-ghost btn-sm" data-user-id="${escapeAttribute(u.id)}" data-action="delete" style="color:var(--color-danger);padding:0.25rem 0.5rem;font-size:0.75rem;" aria-label="Remove ${escapeAttribute(u.name)}">Remove</button>` : ''}
            </div>
          </div>
        `;
      }).join('')}`;

      if (offlineMode) {
        document.getElementById('add-staff-btn').disabled = true;
        staffList.querySelectorAll('button, select').forEach((control) => { control.disabled = true; });
        return;
      }

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

    } catch { toast('Failed to load staff', 'error'); }
  }

  // Edit staff credentials modal
  function showEditStaffModal(userId, currentName, currentEmail) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="edit-staff-title" style="max-width:420px;">
        <h3 id="edit-staff-title" style="font-weight:700;margin-bottom:0.5rem;">Edit Staff Credentials</h3>
        <p style="font-size:0.8rem;color:var(--color-text-muted);margin-bottom:1.25rem;">Update login details for <strong>${escapeHTML(currentName)}</strong></p>
        <form id="edit-staff-form">
          <div class="form-group">
            <label class="label" for="settings-name">Full Name</label>
            <input id="settings-name" class="input" name="name" value="${escapeAttribute(currentName)}" placeholder="Full name">
          </div>
          <div class="form-group">
            <label class="label" for="settings-email">Email</label>
            <input id="settings-email" class="input" type="email" name="email" value="${escapeAttribute(currentEmail)}" placeholder="Email address">
          </div>
          <div class="form-group">
            <label class="label" for="settings-password">New Password</label>
            <input id="settings-password" class="input" type="password" name="password" placeholder="Leave blank to keep current password" minlength="8">
            <p style="font-size:0.7rem;color:var(--color-text-muted);margin-top:0.25rem;">Only fill this if you want to change the password</p>
          </div>
          <div style="display:flex;gap:0.5rem;margin-top:1.25rem;">
            <button type="button" class="btn btn-ghost" id="cancel-edit" data-dialog-close style="flex:1;">Cancel</button>
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
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="add-staff-title" style="max-width:420px;">
        <h3 id="add-staff-title" style="font-weight:700;margin-bottom:1.25rem;">Add Staff Member</h3>
        <form id="staff-form">
          <div class="form-group">
            <label class="label" for="settings-name-2">Full Name *</label>
            <input id="settings-name-2" class="input" name="name" placeholder="Enter full name" required>
          </div>
          <div class="form-group">
            <label class="label" for="settings-email-2">Email *</label>
            <input id="settings-email-2" class="input" type="email" name="email" placeholder="Enter email address" required>
          </div>
          <div class="form-group">
            <label class="label" for="settings-password-2">Password *</label>
            <input id="settings-password-2" class="input" type="password" name="password" placeholder="Set initial password" minlength="8" required>
          </div>
          <div class="form-group">
            <label class="label" for="settings-role">Role *</label>
            <select id="settings-role" class="input" name="role" required>
              ${allowedRoles.map(r => `<option value="${r}">${r === 'admin' ? '👑 Admin' : r === 'manager' ? '🏢 Manager' : '💳 Cashier'}</option>`).join('')}
            </select>
            <p style="font-size:0.7rem;color:var(--color-text-muted);margin-top:0.35rem;">
              ${isAdmin ? 'You can assign any role.' : 'As a manager, you can only create cashier accounts.'}
            </p>
          </div>
          <div style="display:flex;gap:0.5rem;margin-top:1.25rem;">
            <button type="button" class="btn btn-ghost" id="cancel-staff" data-dialog-close style="flex:1;">Cancel</button>
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
