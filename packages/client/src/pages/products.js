import { api } from '../api.js';
import { renderLayout } from './layout.js';
import { formatCurrency, toast, icons } from '../utils.js';
import { openCameraScanner } from '../scanner.js';

export async function renderProducts() {
  const content = renderLayout('products');

  content.innerHTML = `
    <div class="animate-fade-in">
      <div class="page-header">
        <h2>Products</h2>
        <button class="btn btn-primary" id="add-product-btn">${icons.plus} Add Product</button>
      </div>

      <div style="display:flex;gap:1rem;margin-bottom:1rem;">
        <input class="input" type="text" id="product-search" placeholder="Search products..." style="max-width:320px;">
        <select class="input" id="category-filter" style="max-width:200px;">
          <option value="">All Categories</option>
        </select>
      </div>

      <div class="glass-card" style="overflow:hidden;">
        <table class="data-table" id="products-table">
          <thead>
            <tr><th style="width:50px;"></th><th>Name</th><th>SKU</th><th>Category</th><th>Price</th><th>Stock</th><th>Status</th><th>Actions</th></tr>
          </thead>
          <tbody id="products-tbody">
            <tr><td colspan="8" style="text-align:center;padding:2rem;"><div class="spinner" style="margin:auto;"></div></td></tr>
          </tbody>
        </table>
      </div>
    </div>
  `;

  // Load categories for filter
  try {
    const catData = await api.get('/categories');
    const catSelect = document.getElementById('category-filter');
    catData.categories.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.name;
      catSelect.appendChild(opt);
    });
  } catch {}

  async function loadProducts() {
    try {
      const search = document.getElementById('product-search').value;
      const category = document.getElementById('category-filter').value;
      let url = '/products?limit=100';
      if (search) url += `&search=${encodeURIComponent(search)}`;
      if (category) url += `&category_id=${category}`;

      const data = await api.get(url);
      const tbody = document.getElementById('products-tbody');

      if (data.products.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="empty-state">No products found</td></tr>';
        return;
      }

      tbody.innerHTML = data.products.map(p => `
        <tr>
          <td style="width:50px;padding:0.35rem;">
            ${p.image_url
              ? `<img src="${p.image_url}" alt="${p.name}" style="width:40px;height:40px;object-fit:contain;border-radius:0.375rem;background:rgba(255,255,255,0.05);">`
              : `<div style="width:40px;height:40px;display:flex;align-items:center;justify-content:center;border-radius:0.375rem;background:rgba(255,255,255,0.05);font-size:1.2rem;">📦</div>`
            }
          </td>
          <td style="font-weight:600;">${p.name}</td>
          <td style="font-size:0.8rem;color:var(--color-text-muted);">${p.sku || '-'}</td>
          <td>${p.category_name || '-'}</td>
          <td>${formatCurrency(p.price)}</td>
          <td>
            <span class="${p.stock_quantity <= p.low_stock_threshold ? 'badge badge-danger' : ''}" style="font-weight:600;">
              ${p.stock_quantity}
            </span>
          </td>
          <td><span class="badge ${p.is_active ? 'badge-success' : 'badge-warning'}">${p.is_active ? 'Active' : 'Inactive'}</span></td>
          <td>
            <button class="btn btn-ghost btn-sm edit-product" data-id="${p.id}">Edit</button>
            <button class="btn btn-ghost btn-sm delete-product" data-id="${p.id}" style="color:var(--color-danger);">Delete</button>
          </td>
        </tr>
      `).join('');

      // Delete handlers
      tbody.querySelectorAll('.delete-product').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm('Delete this product?')) return;
          try {
            await api.delete('/products/' + btn.dataset.id);
            toast('Product deleted', 'success');
            loadProducts();
          } catch (err) { toast(err.message, 'error'); }
        });
      });

      // Edit handlers
      tbody.querySelectorAll('.edit-product').forEach(btn => {
        btn.addEventListener('click', async () => {
          try {
            const res = await api.get('/products/' + btn.dataset.id);
            showProductModal(res.product, loadProducts);
          } catch (err) { toast(err.message, 'error'); }
        });
      });
    } catch (err) {
      toast('Failed to load products', 'error');
    }
  }

  // Search & filter
  document.getElementById('product-search').addEventListener('input', () => setTimeout(loadProducts, 300));
  document.getElementById('category-filter').addEventListener('change', loadProducts);

  // Add product button
  document.getElementById('add-product-btn').addEventListener('click', () => {
    showProductModal(null, loadProducts);
  });

  await loadProducts();
}

function showProductModal(product, onSave) {
  const isEdit = !!product;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" style="max-width:520px;">
      <h3 style="font-weight:700;margin-bottom:1.25rem;">${isEdit ? 'Edit Product' : 'New Product'}</h3>
      <form id="product-form">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
          <div class="form-group" style="grid-column:1/-1;">
            <label class="label">Product Image</label>
            <div style="display:flex;gap:0.75rem;align-items:start;">
              <div id="image-preview" style="width:80px;height:80px;border-radius:0.5rem;border:1px dashed var(--color-border);display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0;background:rgba(255,255,255,0.05);">
                ${product?.image_url
                  ? `<img src="${product.image_url}" style="width:100%;height:100%;object-fit:contain;">`
                  : `<span style="font-size:2rem;">📷</span>`
                }
              </div>
              <div style="flex:1;">
                <input class="input" name="image_url" id="image-url-input" value="${product?.image_url || ''}" placeholder="Image URL (auto-filled from barcode lookup)" style="margin-bottom:0.35rem;font-size:0.8rem;">
                <label class="btn btn-ghost btn-sm" style="cursor:pointer;font-size:0.75rem;" id="image-upload-label">
                  📁 Upload Image
                  <input type="file" accept="image/*" id="image-upload-input" style="display:none;">
                </label>
              </div>
            </div>
          </div>
          <div class="form-group" style="grid-column:1/-1;">
            <label class="label">Product Name *</label>
            <input class="input" name="name" value="${product?.name || ''}" required>
          </div>
          <div class="form-group">
            <label class="label">SKU</label>
            <input class="input" name="sku" value="${product?.sku || ''}">
          </div>
          <div class="form-group">
            <label class="label">Barcode</label>
            <div style="display:flex;gap:0.5rem;">
              <input class="input" name="barcode" id="barcode-input" value="${product?.barcode || ''}" placeholder="Scan or type barcode" style="flex:1;">
              <button type="button" class="btn btn-ghost btn-sm" id="scan-barcode-btn" title="Scan barcode with camera" style="padding:0.5rem;">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><line x1="7" y1="12" x2="17" y2="12"/><line x1="7" y1="8" x2="13" y2="8"/><line x1="7" y1="16" x2="15" y2="16"/></svg>
              </button>
              <button type="button" class="btn btn-primary btn-sm" id="lookup-barcode-btn" title="Look up product info online" style="padding:0.5rem 0.75rem;font-size:0.75rem;">
                🔍 Lookup
              </button>
            </div>
          </div>
          <div id="lookup-status" style="grid-column:1/-1;display:none;"></div>
          <div class="form-group">
            <label class="label">Price (₦) *</label>
            <input class="input" type="number" step="0.01" name="price" value="${product?.price || ''}" required>
          </div>
          <div class="form-group">
            <label class="label">Cost Price (₦)</label>
            <input class="input" type="number" step="0.01" name="cost_price" value="${product?.cost_price || ''}">
          </div>
          <div class="form-group">
            <label class="label">Stock Quantity</label>
            <input class="input" type="number" name="stock_quantity" value="${product?.stock_quantity ?? 0}">
          </div>
          <div class="form-group">
            <label class="label">Low Stock Alert</label>
            <input class="input" type="number" name="low_stock_threshold" value="${product?.low_stock_threshold ?? 10}">
          </div>
          <div class="form-group" style="grid-column:1/-1;">
            <label class="label">Category</label>
            <select class="input" name="category_id" id="modal-category-select">
              <option value="">No Category</option>
            </select>
          </div>
          <div class="form-group" style="grid-column:1/-1;">
            <label class="label">Description</label>
            <textarea class="input" name="description" rows="2" style="resize:vertical;">${product?.description || ''}</textarea>
          </div>
        </div>
        <div style="display:flex;gap:0.5rem;margin-top:1.25rem;">
          <button type="button" class="btn btn-ghost" id="cancel-product" style="flex:1;">Cancel</button>
          <button type="submit" class="btn btn-primary" style="flex:2;">${isEdit ? 'Save Changes' : 'Create Product'}</button>
        </div>
      </form>
    </div>
  `;

  document.body.appendChild(overlay);

  // Load categories into modal
  api.get('/categories').then(data => {
    const select = document.getElementById('modal-category-select');
    data.categories.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.name;
      if (product?.category_id == c.id) opt.selected = true;
      select.appendChild(opt);
    });
  }).catch(() => {});

  document.getElementById('cancel-product').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  // Barcode lookup function — queries online databases
  async function lookupBarcode(barcode) {
    if (!barcode || barcode.length < 4) {
      toast('Enter a valid barcode first', 'error');
      return;
    }

    const statusDiv = document.getElementById('lookup-status');
    statusDiv.style.display = 'block';
    statusDiv.innerHTML = `
      <div style="display:flex;align-items:center;gap:0.75rem;padding:0.75rem;border-radius:0.5rem;background:rgba(99,102,241,0.1);border:1px solid rgba(99,102,241,0.2);">
        <div class="spinner" style="width:18px;height:18px;border-width:2px;"></div>
        <span style="font-size:0.8rem;">Looking up barcode <strong>${barcode}</strong> online...</span>
      </div>
    `;

    try {
      const result = await api.get(`/products/lookup/${barcode}`);

      if (result.found && result.product) {
        const p = result.product;
        const form = document.getElementById('product-form');

        // Auto-fill form fields
        if (p.name) form.querySelector('[name="name"]').value = p.name + (p.brand ? ` (${p.brand})` : '');
        if (p.description) form.querySelector('[name="description"]').value = p.description;

        // Auto-fill image
        if (p.image_url) {
          const imgInput = document.getElementById('image-url-input');
          const imgPreview = document.getElementById('image-preview');
          if (imgInput) imgInput.value = p.image_url;
          if (imgPreview) imgPreview.innerHTML = `<img src="${p.image_url}" style="width:100%;height:100%;object-fit:contain;">`;
        }

        // Try to match category
        if (p.category) {
          const catSelect = document.getElementById('modal-category-select');
          const catOptions = catSelect.querySelectorAll('option');
          for (const opt of catOptions) {
            if (opt.textContent.toLowerCase().includes(p.category.toLowerCase().split(':').pop().trim().substring(0, 5))) {
              catSelect.value = opt.value;
              break;
            }
          }
        }

        statusDiv.innerHTML = `
          <div style="display:flex;align-items:center;gap:0.75rem;padding:0.75rem;border-radius:0.5rem;background:rgba(34,197,94,0.1);border:1px solid rgba(34,197,94,0.3);">
            ${p.image_url ? `<img src="${p.image_url}" style="width:48px;height:48px;object-fit:contain;border-radius:0.375rem;background:#fff;">` : ''}
            <div style="flex:1;min-width:0;">
              <div style="font-size:0.85rem;font-weight:600;color:var(--color-success);">✓ Product found!</div>
              <div style="font-size:0.75rem;color:var(--color-text-muted);">Source: ${result.source}${p.brand ? ` · Brand: ${p.brand}` : ''}${p.quantity_info ? ` · ${p.quantity_info}` : ''}</div>
            </div>
          </div>
        `;

        toast(`Product found: ${p.name}`, 'success');

        // Focus price field since that's likely what needs manual entry
        setTimeout(() => form.querySelector('[name="price"]').focus(), 100);
      } else {
        statusDiv.innerHTML = `
          <div style="padding:0.75rem;border-radius:0.5rem;background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.3);font-size:0.8rem;color:var(--color-warning);">
            ⚠ Product not found in online databases for barcode: ${barcode}. Enter details manually.
          </div>
        `;
        toast('Product not found online — fill in details manually', 'info');
      }
    } catch (err) {
      statusDiv.innerHTML = `
        <div style="padding:0.75rem;border-radius:0.5rem;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);font-size:0.8rem;color:var(--color-danger);">
          ✕ Lookup failed: ${err.message || 'Network error'}. Enter details manually.
        </div>
      `;
    }
  }

  // Scan barcode button — opens camera, then looks up online
  document.getElementById('scan-barcode-btn').addEventListener('click', () => {
    openCameraScanner((barcode) => {
      const input = document.getElementById('barcode-input');
      if (input) {
        input.value = barcode;
        lookupBarcode(barcode);
      }
    }, { title: 'Scan Product Barcode' });
  });

  // Lookup button — looks up whatever barcode is typed in
  document.getElementById('lookup-barcode-btn').addEventListener('click', () => {
    const barcode = document.getElementById('barcode-input').value.trim();
    lookupBarcode(barcode);
  });

  // Image upload handler
  document.getElementById('image-upload-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target.result;
      document.getElementById('image-url-input').value = dataUrl;
      document.getElementById('image-preview').innerHTML = `<img src="${dataUrl}" style="width:100%;height:100%;object-fit:contain;">`;
      toast('Image uploaded', 'success');
    };
    reader.readAsDataURL(file);
  });

  // Image URL preview on manual input
  document.getElementById('image-url-input').addEventListener('change', (e) => {
    const url = e.target.value.trim();
    if (url) {
      document.getElementById('image-preview').innerHTML = `<img src="${url}" style="width:100%;height:100%;object-fit:contain;" onerror="this.parentElement.innerHTML='<span style=font-size:2rem>📷</span>'">`;
    }
  });

  document.getElementById('product-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const data = {
      name: form.get('name'),
      sku: form.get('sku') || undefined,
      barcode: form.get('barcode') || undefined,
      image_url: form.get('image_url') || undefined,
      price: parseFloat(form.get('price')),
      cost_price: parseFloat(form.get('cost_price')) || 0,
      stock_quantity: parseInt(form.get('stock_quantity')) || 0,
      low_stock_threshold: parseInt(form.get('low_stock_threshold')) || 10,
      category_id: form.get('category_id') ? parseInt(form.get('category_id')) : null,
      description: form.get('description') || undefined,
    };

    try {
      if (isEdit) {
        await api.patch('/products/' + product.id, data);
        toast('Product updated', 'success');
      } else {
        await api.post('/products', data);
        toast('Product created', 'success');
      }
      overlay.remove();
      onSave();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}
