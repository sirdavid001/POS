import { api } from '../api.js';
import { renderLayout } from './layout.js';
import { currencySymbol, debounce, downloadCSV, escapeAttribute, escapeHTML, formatCurrency, toast, icons } from '../utils.js';
import { openCameraScanner } from '../scanner.js';
import { parseCSV, PRODUCT_CSV_HEADERS, productTemplateRows, rowsToProducts } from '../product-import.js';

const PAGE_SIZE = 100;
const SORTS = {
  name: { sort: 'name', order: 'asc' },
  'price-desc': { sort: 'price', order: 'desc' },
  'stock-asc': { sort: 'stock_quantity', order: 'asc' },
  newest: { sort: 'created_at', order: 'desc' },
};

function stockBadge(p) {
  const qty = Number(p.stock_quantity || 0);
  if (qty <= 0) return '<span class="badge badge-danger">Out</span>';
  if (qty <= Number(p.low_stock_threshold || 0)) return '<span class="badge badge-warning">Low</span>';
  return '';
}

function marginText(p) {
  const price = Number(p.price || 0);
  const cost = Number(p.cost_price || 0);
  if (!(cost > 0) || !(price > 0)) return '—';
  return `${(((price - cost) / price) * 100).toLocaleString('en-NG', { maximumFractionDigits: 1 })}%`;
}

export async function renderProducts() {
  const content = renderLayout('products');
  let categories = [];
  let shown = [];
  let total = 0;
  let page = 1;

  content.innerHTML = `
    <div class="animate-fade-in">
      <div class="page-header">
        <h1>Products</h1>
        <div class="report-header-actions">
          <button class="btn btn-ghost btn-sm" id="import-products-btn" type="button">Import CSV</button>
          <button class="btn btn-ghost btn-sm" id="export-products-btn" type="button">Export CSV</button>
          <button class="btn btn-primary" id="add-product-btn" type="button">${icons.plus} Add Product</button>
        </div>
      </div>

      <div class="list-toolbar">
        <label class="sr-only" for="product-search">Search products</label>
        <input class="input" type="search" id="product-search" placeholder="Search name, SKU or barcode…" autocomplete="off" spellcheck="false">
        <label class="sr-only" for="category-filter">Category</label>
        <select class="input" id="category-filter">
          <option value="">All categories</option>
        </select>
        <label class="sr-only" for="product-sort">Sort</label>
        <select class="input" id="product-sort">
          <option value="name">Name A–Z</option>
          <option value="price-desc">Highest price</option>
          <option value="stock-asc">Lowest stock</option>
          <option value="newest">Newest first</option>
        </select>
      </div>

      <div class="glass-card table-scroll-wrapper">
        <table class="data-table" id="products-table">
          <thead>
            <tr><th style="width:50px;"><span class="sr-only">Image</span></th><th>Name</th><th>Category</th><th class="num">Price</th><th class="num">Cost</th><th class="num">Margin</th><th class="num">Stock</th><th>Status</th><th><span class="sr-only">Actions</span></th></tr>
          </thead>
          <tbody id="products-tbody">
            <tr><td colspan="9" style="text-align:center;padding:2rem;"><div class="spinner" style="margin:auto;"></div></td></tr>
          </tbody>
        </table>
      </div>
      <div class="list-footer">
        <p id="products-count" aria-live="polite"></p>
        <button class="btn btn-ghost btn-sm" id="products-more" type="button" hidden>Show more</button>
      </div>
    </div>
  `;

  try {
    const catData = await api.get('/categories');
    categories = catData.categories || [];
    const catSelect = document.getElementById('category-filter');
    categories.forEach((c) => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.name;
      catSelect.appendChild(opt);
    });
  } catch {}

  function queryString(pageNumber) {
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), page: String(pageNumber), ...SORTS[document.getElementById('product-sort').value] });
    const search = document.getElementById('product-search').value.trim();
    const category = document.getElementById('category-filter').value;
    if (search) params.set('search', search);
    if (category) params.set('category_id', category);
    return params.toString();
  }

  function rowHTML(p) {
    const name = escapeAttribute(p.name);
    return `
      <tr>
        <td style="width:50px;padding:0.35rem;">
          ${p.image_url
            ? `<img src="${escapeAttribute(p.image_url)}" alt="" width="40" height="40" loading="lazy" style="width:40px;height:40px;object-fit:contain;border-radius:0.375rem;background:rgba(255,255,255,0.05);">`
            : '<div class="product-thumb-empty" aria-hidden="true"></div>'}
        </td>
        <td><strong>${escapeHTML(p.name)}</strong>${p.sku ? `<small class="cell-sub">${escapeHTML(p.sku)}</small>` : ''}</td>
        <td class="muted-cell">${escapeHTML(p.category_name || '—')}</td>
        <td class="num">${formatCurrency(p.price)}</td>
        <td class="num">${Number(p.cost_price) > 0 ? formatCurrency(p.cost_price) : '—'}</td>
        <td class="num">${marginText(p)}</td>
        <td class="num">${Number(p.stock_quantity || 0).toLocaleString('en-NG')} ${stockBadge(p)}</td>
        <td><span class="badge ${p.is_active ? 'badge-success' : 'badge-warning'}">${p.is_active ? 'Active' : 'Inactive'}</span></td>
        <td class="row-actions">
          <button class="btn btn-ghost btn-sm edit-product" type="button" data-id="${escapeAttribute(p.id)}" aria-label="Edit ${name}">Edit</button>
          <button class="btn btn-ghost btn-sm delete-product" type="button" data-id="${escapeAttribute(p.id)}" aria-label="Delete ${name}" style="color:var(--color-danger);">Delete</button>
        </td>
      </tr>`;
  }

  function renderRows() {
    const tbody = document.getElementById('products-tbody');
    if (!shown.length) {
      const filtered = document.getElementById('product-search').value.trim() || document.getElementById('category-filter').value;
      tbody.innerHTML = `<tr><td colspan="9" class="empty-state">${filtered ? 'No products match.' : 'No products yet. Add one, or import a CSV from your spreadsheet.'}</td></tr>`;
    } else {
      tbody.innerHTML = shown.map(rowHTML).join('');
    }
    document.getElementById('products-count').textContent = shown.length
      ? `Showing ${shown.length.toLocaleString('en-NG')} of ${Math.max(total, shown.length).toLocaleString('en-NG')} products`
      : '';
    document.getElementById('products-more').hidden = shown.length >= total;

    tbody.querySelectorAll('.delete-product').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this product? Past sales keep their records.')) return;
        try {
          await api.delete('/products/' + btn.dataset.id);
          toast('Product deleted', 'success');
          loadProducts();
        } catch (err) { toast(err.message, 'error'); }
      });
    });
    tbody.querySelectorAll('.edit-product').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          const res = await api.get('/products/' + btn.dataset.id);
          showProductModal(res.product, loadProducts);
        } catch (err) { toast(err.message, 'error'); }
      });
    });
  }

  async function loadProducts() {
    page = 1;
    try {
      const data = await api.get(`/products?${queryString(page)}`);
      shown = data.products || [];
      total = Number(data.total) || shown.length;
      renderRows();
    } catch {
      toast('Failed to load products', 'error');
    }
  }

  async function loadMore() {
    try {
      const data = await api.get(`/products?${queryString(page + 1)}`);
      page += 1;
      shown = shown.concat(data.products || []);
      total = Number(data.total) || shown.length;
      renderRows();
    } catch (err) { toast(err.message || 'Could not load more products', 'error'); }
  }

  async function fetchAllProducts() {
    const all = [];
    for (let p = 1; p <= 50; p += 1) {
      const data = await api.get(`/products?limit=200&page=${p}`);
      const batch = data.products || [];
      all.push(...batch);
      if (batch.length < 200 || all.length >= Number(data.total || 0)) break;
    }
    return all;
  }

  document.getElementById('product-search').addEventListener('input', debounce(loadProducts, 250));
  document.getElementById('category-filter').addEventListener('change', loadProducts);
  document.getElementById('product-sort').addEventListener('change', loadProducts);
  document.getElementById('products-more').addEventListener('click', loadMore);
  document.getElementById('add-product-btn').addEventListener('click', () => showProductModal(null, loadProducts));

  document.getElementById('export-products-btn').addEventListener('click', async () => {
    try {
      const all = await fetchAllProducts();
      if (!all.length) return toast('No products to export', 'warning');
      downloadCSV(all.map((p) => ({
        name: p.name,
        sku: p.sku || '',
        barcode: p.barcode || '',
        category: p.category_name || '',
        price: p.price,
        cost_price: p.cost_price ?? '',
        stock_quantity: p.stock_quantity,
        low_stock_threshold: p.low_stock_threshold,
        description: p.description || '',
      })), `QuickPOS_Products_${new Date().toISOString().split('T')[0]}.csv`);
    } catch (err) { toast(err.message || 'Export failed', 'error'); }
  });

  document.getElementById('import-products-btn').addEventListener('click', () => {
    showImportModal({ categories, fetchAllProducts, onDone: loadProducts });
  });

  await loadProducts();
}

function showImportModal({ categories, fetchAllProducts, onDone }) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="import-title" style="max-width:560px;">
      <h3 id="import-title" style="font-weight:700;margin-bottom:0.5rem;">Import products from CSV</h3>
      <p class="import-help">Export your product sheet from Excel or Google Sheets as CSV. Required columns: <strong>name</strong> and <strong>price</strong>. Optional: ${PRODUCT_CSV_HEADERS.filter((h) => !['name', 'price'].includes(h)).join(', ')}. Rows whose SKU or barcode already exists are skipped.</p>
      <div class="import-actions">
        <button class="btn btn-ghost btn-sm" type="button" id="import-template">Download template</button>
        <label class="btn btn-primary btn-sm import-file-label" for="import-file">Choose CSV file</label>
        <input class="sr-only" type="file" id="import-file" accept=".csv,text/csv">
      </div>
      <div id="import-preview" aria-live="polite"></div>
      <div style="display:flex;gap:0.5rem;margin-top:1.25rem;">
        <button type="button" class="btn btn-ghost" id="import-cancel" data-dialog-close style="flex:1;">Close</button>
        <button type="button" class="btn btn-primary" id="import-run" style="flex:2;" disabled>Import products</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => { if (e.target === overlay && !running) overlay.remove(); });
  overlay.querySelector('#import-cancel').addEventListener('click', () => { if (!running) overlay.remove(); });

  const preview = overlay.querySelector('#import-preview');
  const runButton = overlay.querySelector('#import-run');
  let parsed = null;
  let running = false;

  overlay.querySelector('#import-template').addEventListener('click', () => {
    downloadCSV(productTemplateRows(), 'QuickPOS_Product_Template.csv');
  });

  overlay.querySelector('#import-file').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      preview.innerHTML = '<p class="import-error">That file is larger than 2 MB. Split it into smaller files.</p>';
      return;
    }
    preview.innerHTML = '<p class="import-help">Checking the file…</p>';
    try {
      const [text, existing] = await Promise.all([file.text(), fetchAllProducts()]);
      parsed = rowsToProducts(parseCSV(text), { existingProducts: existing });
    } catch (err) {
      preview.innerHTML = `<p class="import-error">Could not read the file: ${escapeHTML(err.message)}</p>`;
      return;
    }
    const newCategories = [...new Set(parsed.products.map((p) => p.category).filter(Boolean))]
      .filter((name) => !categories.some((c) => c.name.toLowerCase() === name.toLowerCase()));
    preview.innerHTML = `
      <div class="import-summary">
        <p><strong>${parsed.products.length.toLocaleString('en-NG')}</strong> product${parsed.products.length === 1 ? '' : 's'} ready to import${newCategories.length ? `, with ${newCategories.length} new categor${newCategories.length === 1 ? 'y' : 'ies'} (${newCategories.slice(0, 5).map(escapeHTML).join(', ')}${newCategories.length > 5 ? '…' : ''})` : ''}.</p>
        ${parsed.errors.length ? `
          <p class="import-error">${parsed.errors.length} row${parsed.errors.length === 1 ? '' : 's'} will be skipped:</p>
          <ul class="import-errors">${parsed.errors.slice(0, 8).map((e) => `<li>Line ${e.line}: ${escapeHTML(e.message)}</li>`).join('')}${parsed.errors.length > 8 ? `<li>…and ${parsed.errors.length - 8} more</li>` : ''}</ul>` : ''}
      </div>`;
    runButton.disabled = parsed.products.length === 0;
    runButton.textContent = parsed.products.length ? `Import ${parsed.products.length.toLocaleString('en-NG')} products` : 'Nothing to import';
  });

  runButton.addEventListener('click', async () => {
    if (!parsed?.products.length || running) return;
    if (!navigator.onLine) {
      toast('Connect to the internet to import products, so every device gets them.', 'warning', 5000);
      return;
    }
    running = true;
    runButton.disabled = true;
    const categoryIds = new Map(categories.map((c) => [c.name.toLowerCase(), c.id]));
    let created = 0;
    const failures = [];
    for (const [index, item] of parsed.products.entries()) {
      runButton.textContent = `Importing ${index + 1} of ${parsed.products.length}…`;
      try {
        const payload = { ...item.payload };
        if (item.category) {
          const key = item.category.toLowerCase();
          if (!categoryIds.has(key)) {
            const result = await api.post('/categories', { name: item.category }, { skipOfflineQueue: true });
            categoryIds.set(key, result.category.id);
          }
          payload.category_id = Number(categoryIds.get(key));
        }
        await api.post('/products', payload, { skipOfflineQueue: true });
        created += 1;
      } catch (err) {
        failures.push({ line: item.line, message: err.message });
      }
    }
    running = false;
    preview.innerHTML = `
      <div class="import-summary">
        <p><strong>Imported ${created.toLocaleString('en-NG')} product${created === 1 ? '' : 's'}.</strong></p>
        ${failures.length ? `<p class="import-error">${failures.length} failed:</p><ul class="import-errors">${failures.slice(0, 8).map((f) => `<li>Line ${f.line}: ${escapeHTML(f.message)}</li>`).join('')}</ul>` : ''}
      </div>`;
    runButton.textContent = 'Done';
    toast(`Imported ${created} product${created === 1 ? '' : 's'}`, created ? 'success' : 'warning');
    onDone();
  });
}

function showProductModal(product, onSave) {
  const isEdit = !!product;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="product-modal-title" style="max-width:520px;">
      <h3 id="product-modal-title" style="font-weight:700;margin-bottom:1.25rem;">${isEdit ? 'Edit Product' : 'New Product'}</h3>
      <form id="product-form">
        <div class="form-grid-2">
          <div class="form-group" style="grid-column:1/-1;">
            <label class="label" for="image-url-input">Product Image</label>
            <div style="display:flex;gap:0.75rem;align-items:start;">
              <div id="image-preview" style="width:80px;height:80px;border-radius:0.5rem;border:1px dashed var(--color-border);display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0;background:rgba(255,255,255,0.05);">
                ${product?.image_url
                  ? `<img src="${escapeAttribute(product.image_url)}" alt="" style="width:100%;height:100%;object-fit:contain;">`
                  : `<span class="image-placeholder-icon">${icons.camera}</span>`
                }
              </div>
              <div style="flex:1;">
                <input class="input" name="image_url" id="image-url-input" value="${escapeAttribute(product?.image_url || '')}" placeholder="Image URL (auto-filled from barcode lookup)" style="margin-bottom:0.35rem;font-size:0.8rem;">
                <label class="btn btn-ghost btn-sm" style="cursor:pointer;font-size:0.75rem;" id="image-upload-label">
                  ${icons.upload} Upload image
                  <input type="file" accept="image/*" id="image-upload-input" style="display:none;">
                </label>
              </div>
            </div>
          </div>
          <div class="form-group" style="grid-column:1/-1;">
            <label class="label" for="product-name">Product Name *</label>
            <input id="product-name" class="input" name="name" value="${escapeAttribute(product?.name || '')}" required>
          </div>
          <div class="form-group">
            <label class="label" for="product-sku">SKU</label>
            <input id="product-sku" class="input" name="sku" value="${escapeAttribute(product?.sku || '')}">
          </div>
          <div class="form-group" style="grid-column:1/-1;">
            <label class="label" for="barcode-input">Barcode</label>
            <div class="barcode-controls">
              <input class="input" name="barcode" id="barcode-input" value="${escapeAttribute(product?.barcode || '')}" placeholder="Scan or type barcode" style="flex:1;">
              <button type="button" class="btn btn-ghost btn-sm" id="scan-barcode-btn" title="Scan barcode with camera" style="padding:0.5rem;">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><line x1="7" y1="12" x2="17" y2="12"/><line x1="7" y1="8" x2="13" y2="8"/><line x1="7" y1="16" x2="15" y2="16"/></svg>
              </button>
              <button type="button" class="btn btn-primary btn-sm" id="lookup-barcode-btn" title="Look up product info online" style="padding:0.5rem 0.75rem;font-size:0.75rem;">
                ${icons.search} Look up
              </button>
            </div>
          </div>
          <div id="lookup-status" style="grid-column:1/-1;display:none;"></div>
          <div class="form-group">
            <label class="label" for="product-price">Price (${currencySymbol()}) *</label>
            <input id="product-price" class="input" type="number" min="0" step="0.01" name="price" value="${escapeAttribute(product?.price || '')}" required>
          </div>
          <div class="form-group">
            <label class="label" for="product-cost-price">Cost Price (${currencySymbol()})</label>
            <input id="product-cost-price" class="input" type="number" min="0" step="0.01" name="cost_price" value="${escapeAttribute(product?.cost_price || '')}">
          </div>
          <div class="form-group">
            <label class="label" for="product-stock-quantity">Stock Quantity</label>
            <input id="product-stock-quantity" class="input" type="number" min="0" name="stock_quantity" value="${escapeAttribute(product?.stock_quantity ?? 0)}">
          </div>
          <div class="form-group">
            <label class="label" for="product-low-stock-threshold">Low Stock Alert</label>
            <input id="product-low-stock-threshold" class="input" type="number" min="0" name="low_stock_threshold" value="${escapeAttribute(product?.low_stock_threshold ?? 10)}">
          </div>
          <div class="form-group" style="grid-column:1/-1;">
            <label class="label" for="modal-category-select">Category</label>
            <select class="input" name="category_id" id="modal-category-select">
              <option value="">No Category</option>
            </select>
          </div>
          <div class="form-group" style="grid-column:1/-1;">
            <label class="label" for="product-description">Description</label>
            <textarea id="product-description" class="input" name="description" rows="2" style="resize:vertical;">${escapeHTML(product?.description || '')}</textarea>
          </div>
        </div>
        <div style="display:flex;gap:0.5rem;margin-top:1.25rem;">
          <button type="button" class="btn btn-ghost" id="cancel-product" data-dialog-close style="flex:1;">Cancel</button>
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

  function renderImagePreview(url) {
    const preview = document.getElementById('image-preview');
    preview.replaceChildren();
    if (!url) {
      const placeholder = document.createElement('span');
      placeholder.className = 'image-placeholder-icon';
      placeholder.innerHTML = icons.camera;
      preview.appendChild(placeholder);
      return;
    }
    const image = document.createElement('img');
    image.alt = '';
    image.src = url;
    image.style.cssText = 'width:100%;height:100%;object-fit:contain;';
    image.addEventListener('error', () => renderImagePreview(''), { once: true });
    preview.appendChild(image);
  }

  async function optimizeProductImage(file) {
    if (!file.type.startsWith('image/')) throw new Error('Choose a valid image file');
    if (file.size > 5 * 1024 * 1024) throw new Error('Image must be 5 MB or smaller');

    const objectUrl = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = objectUrl;
      await image.decode();

      const scale = Math.min(1, 480 / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('This device could not process the image');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);

      const dataUrl = canvas.toDataURL('image/jpeg', 0.75);
      if (dataUrl.length > 250_000) {
        throw new Error('Image is still too large after optimization. Choose a simpler image.');
      }
      return dataUrl;
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

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
        <span style="font-size:0.8rem;">Looking up barcode <strong>${escapeHTML(barcode)}</strong> online...</span>
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
          if (imgPreview) renderImagePreview(p.image_url);
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
            ${p.image_url ? `<img src="${escapeAttribute(p.image_url)}" alt="" style="width:48px;height:48px;object-fit:contain;border-radius:0.375rem;background:#fff;">` : ''}
            <div style="flex:1;min-width:0;">
              <div style="font-size:0.85rem;font-weight:600;color:var(--color-success);">✓ Product found!</div>
              <div style="font-size:0.75rem;color:var(--color-text-muted);">Source: ${escapeHTML(result.source)}${p.brand ? ` · Brand: ${escapeHTML(p.brand)}` : ''}${p.quantity_info ? ` · ${escapeHTML(p.quantity_info)}` : ''}</div>
            </div>
          </div>
        `;

        toast(`Product found: ${p.name}`, 'success');

        // Focus price field since that's likely what needs manual entry
        setTimeout(() => form.querySelector('[name="price"]').focus(), 100);
      } else {
        statusDiv.innerHTML = `
          <div style="padding:0.75rem;border-radius:0.5rem;background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.3);font-size:0.8rem;color:var(--color-warning);">
            Product not found in online databases for barcode: ${escapeHTML(barcode)}. Enter details manually.
          </div>
        `;
        toast('Product not found online — fill in details manually', 'info');
      }
    } catch (err) {
      statusDiv.innerHTML = `
        <div style="padding:0.75rem;border-radius:0.5rem;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);font-size:0.8rem;color:var(--color-danger);">
          Lookup failed: ${escapeHTML(err.message || 'Network error')}. Enter details manually.
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
  document.getElementById('image-upload-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const dataUrl = await optimizeProductImage(file);
      document.getElementById('image-url-input').value = dataUrl;
      renderImagePreview(dataUrl);
      toast('Image optimized and uploaded', 'success');
    } catch (error) {
      e.target.value = '';
      toast(error.message, 'error');
    }
  });

  // Image URL preview on manual input
  document.getElementById('image-url-input').addEventListener('change', (e) => {
    const url = e.target.value.trim();
    renderImagePreview(url);
  });

  document.getElementById('product-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const data = {
      name: form.get('name'),
      sku: form.get('sku') || undefined,
      barcode: form.get('barcode') || undefined,
      image_url: form.get('image_url') || (isEdit ? null : undefined),
      price: parseFloat(form.get('price')),
      cost_price: parseFloat(form.get('cost_price')) || 0,
      stock_quantity: parseInt(form.get('stock_quantity')) || 0,
      low_stock_threshold: parseInt(form.get('low_stock_threshold')) || 10,
      category_id: form.get('category_id')
        ? (/^\d+$/.test(form.get('category_id')) ? Number(form.get('category_id')) : form.get('category_id'))
        : null,
      description: form.get('description') || undefined,
    };
    if (isEdit && data.image_url === product.image_url) delete data.image_url;

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
