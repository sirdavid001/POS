import { api } from '../api.js';
import { renderLayout } from './layout.js';
import { formatCurrency, formatDateTime, toast, icons } from '../utils.js';

export async function renderInventory() {
  const content = renderLayout('inventory');

  content.innerHTML = `
    <div class="animate-fade-in">
      <div class="page-header">
        <h2>Inventory</h2>
        <button class="btn btn-primary" id="adjust-stock-btn">${icons.plus} Adjust Stock</button>
      </div>

      <div class="responsive-grid-2">
        <div class="glass-card" style="padding:1.25rem;">
          <h3 style="font-size:1rem;font-weight:700;margin-bottom:1rem;">Recent Inventory Changes</h3>
          <div id="inventory-logs"><div class="spinner"></div></div>
        </div>
        <div class="glass-card" style="padding:1.25rem;">
          <h3 style="font-size:1rem;font-weight:700;margin-bottom:1rem;">Suppliers</h3>
          <button class="btn btn-ghost btn-sm" id="add-supplier-btn" style="margin-bottom:1rem;">${icons.plus} Add Supplier</button>
          <div id="suppliers-list"><div class="spinner"></div></div>
        </div>
      </div>
    </div>
  `;

  // Load inventory logs
  try {
    const logsData = await api.get('/inventory/logs?limit=20');
    const logsDiv = document.getElementById('inventory-logs');

    if (logsData.logs.length === 0) {
      logsDiv.innerHTML = '<p style="color:var(--color-text-muted);font-size:0.85rem;">No inventory changes yet.</p>';
    } else {
      logsDiv.innerHTML = `
        <table class="data-table">
          <thead><tr><th>Product</th><th>Type</th><th>Qty</th><th>By</th><th>Date</th></tr></thead>
          <tbody>
            ${logsData.logs.map(l => `
              <tr>
                <td>${l.product_name}</td>
                <td><span class="badge badge-${l.type === 'in' ? 'success' : l.type === 'out' ? 'danger' : 'warning'}">${l.type}</span></td>
                <td style="font-weight:600;">${l.quantity}</td>
                <td style="font-size:0.8rem;">${l.user_name || '-'}</td>
                <td style="font-size:0.8rem;color:var(--color-text-muted);">${formatDateTime(l.created_at)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    }
  } catch (err) { document.getElementById('inventory-logs').innerHTML = '<p style="color:var(--color-danger);">Failed to load</p>'; }

  // Load suppliers
  try {
    const suppData = await api.get('/inventory/suppliers');
    const suppDiv = document.getElementById('suppliers-list');

    if (suppData.suppliers.length === 0) {
      suppDiv.innerHTML = '<p style="color:var(--color-text-muted);font-size:0.85rem;">No suppliers added yet.</p>';
    } else {
      suppDiv.innerHTML = suppData.suppliers.map(s => `
        <div style="padding:0.75rem;border-bottom:1px solid var(--color-border);font-size:0.85rem;">
          <div style="font-weight:600;">${s.name}</div>
          <div style="color:var(--color-text-muted);font-size:0.8rem;">${s.contact_name || ''} · ${s.phone || ''}</div>
        </div>
      `).join('');
    }
  } catch {}

  // Stock adjustment modal
  document.getElementById('adjust-stock-btn').addEventListener('click', () => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <h3 style="font-weight:700;margin-bottom:1.25rem;">Adjust Stock</h3>
        <form id="adjust-form">
          <div class="form-group">
            <label class="label">Product</label>
            <select class="input" name="product_id" required id="adj-product-select">
              <option value="">Select product</option>
            </select>
          </div>
          <div class="form-group">
            <label class="label">Type</label>
            <select class="input" name="type" required>
              <option value="in">Stock In</option>
              <option value="out">Stock Out</option>
              <option value="adjustment">Adjustment</option>
            </select>
          </div>
          <div class="form-group">
            <label class="label">Quantity</label>
            <input class="input" type="number" name="quantity" min="1" required>
          </div>
          <div class="form-group">
            <label class="label">Reason</label>
            <input class="input" name="reason" placeholder="e.g. Restock from supplier">
          </div>
          <div style="display:flex;gap:0.5rem;margin-top:1.25rem;">
            <button type="button" class="btn btn-ghost" style="flex:1;" onclick="this.closest('.modal-overlay').remove()">Cancel</button>
            <button type="submit" class="btn btn-primary" style="flex:2;">Adjust Stock</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    // Load products into select
    api.get('/products?limit=200').then(data => {
      const select = document.getElementById('adj-product-select');
      data.products.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = `${p.name} (Current: ${p.stock_quantity})`;
        select.appendChild(opt);
      });
    });

    document.getElementById('adjust-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = new FormData(e.target);
      try {
        await api.post('/inventory/adjust', {
          product_id: parseInt(form.get('product_id')),
          type: form.get('type'),
          quantity: parseInt(form.get('quantity')),
          reason: form.get('reason') || undefined,
        });
        toast('Stock adjusted', 'success');
        overlay.remove();
        renderInventory(); // reload page
      } catch (err) { toast(err.message, 'error'); }
    });
  });

  // Add supplier modal
  document.getElementById('add-supplier-btn').addEventListener('click', () => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <h3 style="font-weight:700;margin-bottom:1.25rem;">Add Supplier</h3>
        <form id="supplier-form">
          <div class="form-group"><label class="label">Company Name *</label><input class="input" name="name" required></div>
          <div class="form-group"><label class="label">Contact Person</label><input class="input" name="contact_name"></div>
          <div class="form-group"><label class="label">Phone</label><input class="input" name="phone"></div>
          <div class="form-group"><label class="label">Email</label><input class="input" type="email" name="email"></div>
          <div style="display:flex;gap:0.5rem;margin-top:1.25rem;">
            <button type="button" class="btn btn-ghost" style="flex:1;" onclick="this.closest('.modal-overlay').remove()">Cancel</button>
            <button type="submit" class="btn btn-primary" style="flex:2;">Add Supplier</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    document.getElementById('supplier-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = new FormData(e.target);
      try {
        await api.post('/inventory/suppliers', {
          name: form.get('name'),
          contact_name: form.get('contact_name') || undefined,
          phone: form.get('phone') || undefined,
          email: form.get('email') || undefined,
        });
        toast('Supplier added', 'success');
        overlay.remove();
        renderInventory();
      } catch (err) { toast(err.message, 'error'); }
    });
  });
}
