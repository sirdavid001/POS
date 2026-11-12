import { api } from '../api.js';
import { renderLayout } from './layout.js';
import { debounce, downloadCSV, escapeAttribute, escapeHTML, formatCurrency, formatDateTime, toast, icons } from '../utils.js';

const TYPE_LABELS = { in: 'Stock in', out: 'Stock out', adjustment: 'Correction' };

function stockStatus(product) {
  const qty = Number(product.stock_quantity || 0);
  if (qty <= 0) return { id: 'out', label: 'Out of stock', badge: 'danger' };
  if (qty <= Number(product.low_stock_threshold || 0)) return { id: 'low', label: 'Low', badge: 'warning' };
  return { id: 'ok', label: 'In stock', badge: 'success' };
}

export async function renderInventory() {
  const content = renderLayout('inventory');
  let products = [];
  let suppliers = [];
  let logs = [];

  content.innerHTML = `
    <div class="animate-fade-in">
      <div class="page-header">
        <h1>Inventory</h1>
        <button class="btn btn-primary" id="adjust-stock-btn" type="button">${icons.plus} Record stock change</button>
      </div>

      <div class="stat-grid" id="stock-summary"><div class="stat-card"><div class="spinner"></div></div></div>

      <section class="glass-card report-card" aria-labelledby="stock-heading">
        <div class="report-card-head">
          <h2 id="stock-heading">Current stock</h2>
          <button class="btn btn-ghost btn-sm" type="button" id="export-stock-csv">Export CSV</button>
        </div>
        <div class="list-toolbar">
          <label class="sr-only" for="stock-search">Search stock</label>
          <input class="input" type="search" id="stock-search" placeholder="Search product, SKU or barcode…" autocomplete="off" spellcheck="false">
          <label class="sr-only" for="stock-filter">Show</label>
          <select class="input" id="stock-filter">
            <option value="all">All products</option>
            <option value="attention">Low and out of stock</option>
            <option value="out">Out of stock only</option>
          </select>
          <label class="sr-only" for="stock-sort">Sort</label>
          <select class="input" id="stock-sort">
            <option value="status">Needs attention first</option>
            <option value="name">Name A–Z</option>
            <option value="value">Highest stock value</option>
            <option value="qty">Lowest quantity</option>
          </select>
        </div>
        <div class="table-scroll-wrapper" id="stock-table"><div class="spinner"></div></div>
      </section>

      <div class="responsive-grid-2 report-grid">
        <section class="glass-card report-card" aria-labelledby="history-heading">
          <div class="report-card-head">
            <h2 id="history-heading">Stock history</h2>
            <button class="btn btn-ghost btn-sm" type="button" id="export-inventory-csv">Export CSV</button>
          </div>
          <div class="list-toolbar">
            <label class="sr-only" for="history-type">Change type</label>
            <select class="input" id="history-type">
              <option value="">All changes</option>
              <option value="in">Stock in</option>
              <option value="out">Stock out</option>
              <option value="adjustment">Corrections</option>
            </select>
          </div>
          <div class="table-scroll-wrapper" id="inventory-logs"><div class="spinner"></div></div>
        </section>
        <section class="glass-card report-card" aria-labelledby="suppliers-heading">
          <div class="report-card-head">
            <h2 id="suppliers-heading">Suppliers</h2>
            <button class="btn btn-ghost btn-sm" id="add-supplier-btn" type="button">${icons.plus} Add supplier</button>
          </div>
          <div id="suppliers-list"><div class="spinner"></div></div>
        </section>
      </div>
    </div>
  `;

  function renderSummary() {
    const active = products.filter((p) => p.is_active !== false);
    const costValue = active.reduce((sum, p) => sum + Number(p.stock_quantity || 0) * Number(p.cost_price || 0), 0);
    const retailValue = active.reduce((sum, p) => sum + Number(p.stock_quantity || 0) * Number(p.price || 0), 0);
    const missingCost = active.filter((p) => !(Number(p.cost_price) > 0) && Number(p.stock_quantity) > 0).length;
    const low = active.filter((p) => stockStatus(p).id === 'low').length;
    const out = active.filter((p) => stockStatus(p).id === 'out').length;
    const units = active.reduce((sum, p) => sum + Math.max(0, Number(p.stock_quantity || 0)), 0);
    document.getElementById('stock-summary').innerHTML = `
      <div class="stat-card"><div class="stat-label">Units in stock</div><div class="stat-value">${units.toLocaleString('en-NG')}</div><div class="stat-change">${active.length.toLocaleString('en-NG')} products</div></div>
      <div class="stat-card"><div class="stat-label">Stock value at cost</div><div class="stat-value">${formatCurrency(costValue)}</div><div class="stat-change">${missingCost ? `${missingCost} product${missingCost === 1 ? '' : 's'} have no cost price` : 'Every stocked product has a cost price'}</div></div>
      <div class="stat-card"><div class="stat-label">Stock value at selling price</div><div class="stat-value">${formatCurrency(retailValue)}</div><div class="stat-change">${costValue > 0 ? `${formatCurrency(retailValue - costValue)} potential gross profit` : 'Add cost prices to see potential profit'}</div></div>
      <div class="stat-card"><div class="stat-label">Needs restocking</div><div class="stat-value">${(low + out).toLocaleString('en-NG')}</div><div class="stat-change">${out} out of stock · ${low} low</div></div>
    `;
  }

  function filteredStock() {
    const search = document.getElementById('stock-search').value.trim().toLowerCase();
    const filter = document.getElementById('stock-filter').value;
    const sort = document.getElementById('stock-sort').value;
    const rank = { out: 0, low: 1, ok: 2 };
    return products
      .filter((p) => p.is_active !== false)
      .filter((p) => !search || [p.name, p.sku, p.barcode].some((value) => String(value || '').toLowerCase().includes(search)))
      .filter((p) => {
        const status = stockStatus(p).id;
        if (filter === 'attention') return status !== 'ok';
        if (filter === 'out') return status === 'out';
        return true;
      })
      .sort((a, b) => {
        if (sort === 'name') return String(a.name).localeCompare(String(b.name));
        if (sort === 'value') return Number(b.stock_quantity) * Number(b.cost_price || 0) - Number(a.stock_quantity) * Number(a.cost_price || 0);
        if (sort === 'qty') return Number(a.stock_quantity) - Number(b.stock_quantity);
        return rank[stockStatus(a).id] - rank[stockStatus(b).id] || String(a.name).localeCompare(String(b.name));
      });
  }

  function renderStock() {
    const rows = filteredStock();
    const target = document.getElementById('stock-table');
    if (!rows.length) {
      target.innerHTML = '<p class="report-empty">No products match.</p>';
      return;
    }
    target.innerHTML = `
      <table class="data-table">
        <thead><tr><th>Product</th><th>Category</th><th class="num">In stock</th><th class="num">Alert at</th><th>Status</th><th class="num">Value at cost</th><th><span class="sr-only">Actions</span></th></tr></thead>
        <tbody>
          ${rows.map((p) => {
            const status = stockStatus(p);
            const value = Number(p.stock_quantity || 0) * Number(p.cost_price || 0);
            return `
              <tr>
                <td><strong>${escapeHTML(p.name)}</strong>${p.sku ? `<small class="cell-sub">${escapeHTML(p.sku)}</small>` : ''}</td>
                <td class="muted-cell">${escapeHTML(p.category_name || '—')}</td>
                <td class="num">${Number(p.stock_quantity || 0).toLocaleString('en-NG')}</td>
                <td class="num muted-cell">${Number(p.low_stock_threshold || 0).toLocaleString('en-NG')}</td>
                <td><span class="badge badge-${status.badge}">${status.label}</span></td>
                <td class="num">${Number(p.cost_price) > 0 ? formatCurrency(value) : '—'}</td>
                <td class="row-actions"><button class="btn btn-ghost btn-sm adjust-row" type="button" data-id="${escapeAttribute(p.id)}" aria-label="Record stock change for ${escapeAttribute(p.name)}">Adjust</button></td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>`;
    target.querySelectorAll('.adjust-row').forEach((button) => {
      button.addEventListener('click', () => showAdjustModal(button.dataset.id));
    });
  }

  function renderLogs() {
    const type = document.getElementById('history-type').value;
    const rows = logs.filter((log) => !type || log.type === type);
    const target = document.getElementById('inventory-logs');
    if (!rows.length) {
      target.innerHTML = `<p class="report-empty">${logs.length ? 'No changes of this type.' : 'No stock changes yet.'}</p>`;
      return;
    }
    target.innerHTML = `
      <table class="data-table">
        <thead><tr><th>Product</th><th>Change</th><th class="num">Qty</th><th>Reason</th><th>When</th></tr></thead>
        <tbody>
          ${rows.map((log) => `
            <tr>
              <td>${escapeHTML(log.product_name)}<small class="cell-sub">${escapeHTML(log.user_name || 'System')}</small></td>
              <td><span class="badge badge-${log.type === 'in' ? 'success' : log.type === 'out' ? 'danger' : 'warning'}">${TYPE_LABELS[log.type] || escapeHTML(log.type)}</span></td>
              <td class="num">${log.type === 'out' ? '−' : '+'}${Number(log.quantity).toLocaleString('en-NG')}</td>
              <td class="muted-cell wrap-cell">${escapeHTML([log.reason, log.supplier_name].filter(Boolean).join(' · ') || '—')}</td>
              <td class="muted-cell">${escapeHTML(formatDateTime(log.created_at))}</td>
            </tr>`).join('')}
        </tbody>
      </table>`;
  }

  function renderSuppliers() {
    const target = document.getElementById('suppliers-list');
    if (!suppliers.length) {
      target.innerHTML = '<p class="report-empty">No suppliers yet. Add them to link stock you receive.</p>';
      return;
    }
    target.innerHTML = `<ul class="profile-list">${suppliers.map((s) => `
      <li>
        <span><strong>${escapeHTML(s.name)}</strong><small>${escapeHTML([s.contact_name, s.phone, s.email].filter(Boolean).join(' · ') || 'No contact details')}</small></span>
        <span class="row-actions">
          <button class="btn btn-ghost btn-sm edit-supplier" type="button" data-id="${escapeAttribute(s.id)}" aria-label="Edit ${escapeAttribute(s.name)}">Edit</button>
          <button class="btn btn-ghost btn-sm delete-supplier" type="button" data-id="${escapeAttribute(s.id)}" aria-label="Delete ${escapeAttribute(s.name)}" style="color:var(--color-danger);">Delete</button>
        </span>
      </li>`).join('')}</ul>`;
    target.querySelectorAll('.edit-supplier').forEach((button) => {
      button.addEventListener('click', () => showSupplierModal(suppliers.find((s) => String(s.id) === button.dataset.id)));
    });
    target.querySelectorAll('.delete-supplier').forEach((button) => {
      button.addEventListener('click', async () => {
        if (!confirm('Delete this supplier? Past stock records keep their history.')) return;
        try {
          await api.delete(`/inventory/suppliers/${button.dataset.id}`);
          toast('Supplier deleted', 'success');
          await loadSuppliers();
        } catch (err) { toast(err.message, 'error'); }
      });
    });
  }

  // The API returns at most 200 products per page; stock totals need every product.
  async function fetchAllProducts() {
    const all = [];
    for (let page = 1; page <= 50; page += 1) {
      const data = await api.get(`/products?limit=200&page=${page}`);
      const batch = data.products || [];
      all.push(...batch);
      const total = Number(data.total);
      if (batch.length < 200 || (Number.isFinite(total) && all.length >= total)) break;
    }
    return all;
  }

  async function loadProducts() {
    try {
      products = await fetchAllProducts();
      renderSummary();
      renderStock();
    } catch {
      document.getElementById('stock-table').innerHTML = '<p class="report-empty" role="alert">Could not load stock. Check the connection and try again.</p>';
    }
  }

  async function loadLogs() {
    try {
      const data = await api.get('/inventory/logs?limit=100');
      logs = data.logs || [];
      renderLogs();
    } catch {
      document.getElementById('inventory-logs').innerHTML = '<p class="report-empty" role="alert">Could not load stock history.</p>';
    }
  }

  async function loadSuppliers() {
    try {
      const data = await api.get('/inventory/suppliers');
      suppliers = data.suppliers || [];
      renderSuppliers();
    } catch {
      document.getElementById('suppliers-list').innerHTML = '<p class="report-empty" role="alert">Could not load suppliers.</p>';
    }
  }

  function showAdjustModal(productId = '') {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    const options = products
      .filter((p) => p.is_active !== false)
      .sort((a, b) => String(a.name).localeCompare(String(b.name)))
      .map((p) => `<option value="${escapeAttribute(p.id)}" ${String(p.id) === String(productId) ? 'selected' : ''}>${escapeHTML(p.name)} (in stock: ${Number(p.stock_quantity || 0)})</option>`)
      .join('');
    overlay.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="adjust-stock-title">
        <h3 id="adjust-stock-title" style="font-weight:700;margin-bottom:1.25rem;">Record stock change</h3>
        <form id="adjust-form">
          <div class="form-group">
            <label class="label" for="adj-product-select">Product</label>
            <select class="input" name="product_id" required id="adj-product-select">
              <option value="">Select product</option>
              ${options}
            </select>
          </div>
          <div class="form-group">
            <label class="label" for="inventory-type">What happened?</label>
            <select id="inventory-type" class="input" name="type" required>
              <option value="in">Stock in: received from a supplier</option>
              <option value="out">Stock out: damaged, expired, lost or used</option>
              <option value="adjustment">Correction: add units after a count</option>
            </select>
          </div>
          <div class="form-group">
            <label class="label" for="inventory-quantity">Quantity</label>
            <input id="inventory-quantity" class="input" type="number" inputmode="numeric" name="quantity" min="1" step="1" required>
          </div>
          <div class="form-group" id="supplier-group">
            <label class="label" for="inventory-supplier">Supplier (optional)</label>
            <select id="inventory-supplier" class="input" name="supplier_id">
              <option value="">No supplier</option>
              ${suppliers.map((s) => `<option value="${escapeAttribute(s.id)}">${escapeHTML(s.name)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="label" for="inventory-reason">Reason</label>
            <input id="inventory-reason" class="input" name="reason" autocomplete="off" placeholder="For example: delivery invoice 1042">
          </div>
          <div style="display:flex;gap:0.5rem;margin-top:1.25rem;">
            <button type="button" class="btn btn-ghost cancel-inventory-modal" data-dialog-close style="flex:1;">Cancel</button>
            <button type="submit" class="btn btn-primary" style="flex:2;">Save change</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    overlay.querySelector('.cancel-inventory-modal').addEventListener('click', () => overlay.remove());
    const typeSelect = overlay.querySelector('#inventory-type');
    typeSelect.addEventListener('change', () => {
      overlay.querySelector('#supplier-group').hidden = typeSelect.value !== 'in';
    });
    (productId ? overlay.querySelector('#inventory-quantity') : overlay.querySelector('#adj-product-select')).focus();

    overlay.querySelector('#adjust-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = new FormData(e.target);
      const supplierId = form.get('type') === 'in' && form.get('supplier_id') ? Number(form.get('supplier_id')) : undefined;
      try {
        await api.post('/inventory/adjust', {
          product_id: /^\d+$/.test(form.get('product_id')) ? Number(form.get('product_id')) : form.get('product_id'),
          type: form.get('type'),
          quantity: parseInt(form.get('quantity'), 10),
          reason: form.get('reason') || undefined,
          supplier_id: supplierId,
        });
        toast('Stock updated', 'success');
        overlay.remove();
        await Promise.all([loadProducts(), loadLogs()]);
      } catch (err) { toast(err.message, 'error'); }
    });
  }

  function showSupplierModal(supplier = null) {
    const isEdit = Boolean(supplier);
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="add-supplier-title">
        <h3 id="add-supplier-title" style="font-weight:700;margin-bottom:1.25rem;">${isEdit ? 'Edit supplier' : 'Add supplier'}</h3>
        <form id="supplier-form">
          <div class="form-group"><label class="label" for="inventory-name">Company name *</label><input id="inventory-name" class="input" name="name" autocomplete="off" value="${escapeAttribute(supplier?.name || '')}" required></div>
          <div class="form-group"><label class="label" for="inventory-contact-name">Contact person</label><input id="inventory-contact-name" class="input" name="contact_name" autocomplete="off" value="${escapeAttribute(supplier?.contact_name || '')}"></div>
          <div class="form-group"><label class="label" for="inventory-phone">Phone</label><input id="inventory-phone" class="input" type="tel" inputmode="tel" name="phone" autocomplete="off" value="${escapeAttribute(supplier?.phone || '')}"></div>
          <div class="form-group"><label class="label" for="inventory-email">Email</label><input id="inventory-email" class="input" type="email" name="email" autocomplete="off" spellcheck="false" value="${escapeAttribute(supplier?.email || '')}"></div>
          <div style="display:flex;gap:0.5rem;margin-top:1.25rem;">
            <button type="button" class="btn btn-ghost cancel-inventory-modal" data-dialog-close style="flex:1;">Cancel</button>
            <button type="submit" class="btn btn-primary" style="flex:2;">${isEdit ? 'Save changes' : 'Add supplier'}</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    overlay.querySelector('.cancel-inventory-modal').addEventListener('click', () => overlay.remove());
    overlay.querySelector('#inventory-name').focus();

    overlay.querySelector('#supplier-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = new FormData(e.target);
      const payload = {
        name: form.get('name'),
        contact_name: form.get('contact_name') || undefined,
        phone: form.get('phone') || undefined,
        email: form.get('email') || undefined,
      };
      try {
        if (isEdit) await api.patch(`/inventory/suppliers/${supplier.id}`, payload);
        else await api.post('/inventory/suppliers', payload);
        toast(isEdit ? 'Supplier updated' : 'Supplier added', 'success');
        overlay.remove();
        await loadSuppliers();
      } catch (err) { toast(err.message, 'error'); }
    });
  }

  document.getElementById('adjust-stock-btn').addEventListener('click', () => showAdjustModal());
  document.getElementById('add-supplier-btn').addEventListener('click', () => showSupplierModal());
  document.getElementById('stock-search').addEventListener('input', debounce(renderStock, 150));
  document.getElementById('stock-filter').addEventListener('change', renderStock);
  document.getElementById('stock-sort').addEventListener('change', renderStock);
  document.getElementById('history-type').addEventListener('change', renderLogs);

  document.getElementById('export-stock-csv').addEventListener('click', () => {
    const rows = filteredStock();
    if (!rows.length) return toast('No data to export', 'warning');
    downloadCSV(rows.map((p) => ({
      Product: p.name,
      SKU: p.sku || '',
      Category: p.category_name || '',
      'In stock': p.stock_quantity,
      'Alert at': p.low_stock_threshold,
      Status: stockStatus(p).label,
      'Cost price': p.cost_price || '',
      'Value at cost': Number(p.cost_price) > 0 ? Number(p.stock_quantity || 0) * Number(p.cost_price) : '',
    })), `QuickPOS_Stock_${new Date().toISOString().split('T')[0]}.csv`);
  });

  document.getElementById('export-inventory-csv').addEventListener('click', () => {
    if (!logs.length) return toast('No data to export', 'warning');
    downloadCSV(logs.map((l) => ({
      Product: l.product_name,
      Change: TYPE_LABELS[l.type] || l.type,
      Quantity: l.quantity,
      User: l.user_name || 'System',
      Reason: l.reason || '',
      Supplier: l.supplier_name || '',
      Date: new Date(l.created_at).toLocaleString('en-NG'),
    })), `QuickPOS_Stock_History_${new Date().toISOString().split('T')[0]}.csv`);
  });

  await Promise.all([loadProducts(), loadLogs(), loadSuppliers()]);
}
