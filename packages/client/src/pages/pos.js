import { api } from '../api.js';
import { renderLayout } from './layout.js';
import { formatCurrency, toast, debounce, icons } from '../utils.js';
import { startUSBScanner, stopUSBScanner, openCameraScanner, scanButtonHTML } from '../scanner.js';

let cart = [];
let products = [];

function getCartTotal() {
  const subtotal = cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
  return { subtotal, tax: 0, discount: 0, total: subtotal };
}

function renderCart() {
  const cartItems = document.getElementById('cart-items');
  const cartSummary = document.getElementById('cart-summary');

  if (cart.length === 0) {
    cartItems.innerHTML = '<div class="empty-state" style="padding:2rem;"><p>Cart is empty</p><p style="font-size:0.8rem;">Click products to add them</p></div>';
    cartSummary.innerHTML = '';
    return;
  }

  cartItems.innerHTML = cart.map((item, i) => `
    <div class="cart-item animate-fade-in">
      ${item.image_url
        ? `<img src="${item.image_url}" alt="" style="width:36px;height:36px;object-fit:contain;border-radius:0.375rem;flex-shrink:0;background:rgba(128,128,128,0.08);">`
        : `<div style="width:36px;height:36px;display:flex;align-items:center;justify-content:center;border-radius:0.375rem;flex-shrink:0;background:rgba(128,128,128,0.08);font-size:1rem;">📦</div>`
      }
      <div class="cart-item-name">${item.name}</div>
      <div class="cart-item-qty">
        <button onclick="window._posUpdateQty(${i}, -1)">−</button>
        <span style="min-width:20px;text-align:center;font-weight:600;">${item.qty}</span>
        <button onclick="window._posUpdateQty(${i}, 1)">+</button>
      </div>
      <div class="cart-item-price">${formatCurrency(item.price * item.qty)}</div>
      <button class="cart-item-remove" onclick="window._posRemoveItem(${i})">×</button>
    </div>
  `).join('');

  const totals = getCartTotal();
  cartSummary.innerHTML = `
    <div class="cart-summary-row"><span>Subtotal</span><span>${formatCurrency(totals.subtotal)}</span></div>
    <div class="cart-summary-row cart-total"><span>Total</span><span>${formatCurrency(totals.total)}</span></div>
    <div style="display:flex;gap:0.5rem;margin-top:1rem;">
      <button class="btn btn-ghost" style="flex:1;" onclick="window._posClearCart()">Clear</button>
      <button class="btn btn-accent btn-lg" style="flex:2;" onclick="window._posCheckout()">
        Pay ${formatCurrency(totals.total)}
      </button>
    </div>
  `;
}

function addToCart(product) {
  const existing = cart.find(item => item.id === product.id);
  if (existing) {
    if (existing.qty >= product.stock_quantity) {
      toast('No more stock available', 'error');
      return;
    }
    existing.qty++;
  } else {
    if (product.stock_quantity <= 0) {
      toast('Product out of stock', 'error');
      return;
    }
    cart.push({ id: product.id, name: product.name, price: parseFloat(product.price), qty: 1, stock: product.stock_quantity, image_url: product.image_url || '' });
  }
  renderCart();
}

// Barcode scan handler — looks up product by barcode/SKU and adds to cart
function handleBarcodeScan(barcode) {
  const product = products.find(p =>
    p.barcode === barcode || p.sku === barcode || p.name.toLowerCase() === barcode.toLowerCase()
  );

  if (product) {
    addToCart(product);
    toast(`✓ Scanned: ${product.name}`, 'success');
  } else {
    toast(`Product not found for barcode: ${barcode}`, 'error');
  }
}

// Global functions for inline handlers
window._posUpdateQty = (index, delta) => {
  cart[index].qty += delta;
  if (cart[index].qty <= 0) cart.splice(index, 1);
  else if (cart[index].qty > cart[index].stock) {
    cart[index].qty = cart[index].stock;
    toast('Maximum stock reached', 'error');
  }
  renderCart();
};

window._posRemoveItem = (index) => {
  cart.splice(index, 1);
  renderCart();
};

window._posClearCart = () => {
  cart = [];
  renderCart();
};

window._posCheckout = () => {
  if (cart.length === 0) return;
  showPaymentModal();
};

function showPaymentModal() {
  const totals = getCartTotal();

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" style="max-width:420px;">
      <h3 style="font-size:1.15rem;font-weight:700;margin-bottom:1.5rem;">Complete Payment</h3>
      <div style="text-align:center;margin-bottom:1.5rem;">
        <div style="font-size:0.8rem;color:var(--color-text-muted);text-transform:uppercase;">Total Amount</div>
        <div style="font-size:2rem;font-weight:800;color:var(--color-accent);">${formatCurrency(totals.total)}</div>
        <div style="font-size:0.8rem;color:var(--color-text-muted);">${cart.length} item(s)</div>
      </div>

      <label class="label">Payment Method</label>
      <div style="display:flex;gap:0.5rem;margin-bottom:1.5rem;">
        <button class="btn btn-primary pay-method-btn active-method" data-method="cash" style="flex:1;">💵 Cash</button>
        <button class="btn btn-ghost pay-method-btn" data-method="card" style="flex:1;">💳 Card</button>
        <button class="btn btn-ghost pay-method-btn" data-method="transfer" style="flex:1;">🏦 Transfer</button>
      </div>

      <div class="form-group">
        <label class="label" for="customer-select">Customer (Optional)</label>
        <select class="input" id="customer-select">
          <option value="">Walk-in Customer</option>
        </select>
      </div>

      <div style="display:flex;gap:0.5rem;margin-top:1.5rem;">
        <button class="btn btn-ghost" id="cancel-payment" style="flex:1;">Cancel</button>
        <button class="btn btn-accent btn-lg" id="confirm-payment" style="flex:2;">
          Confirm Payment
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Load customers
  api.get('/customers?limit=100').then(data => {
    const select = document.getElementById('customer-select');
    data.customers.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.name;
      select.appendChild(opt);
    });
  }).catch(() => {});

  // Payment method selection
  let selectedMethod = 'cash';
  overlay.querySelectorAll('.pay-method-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      overlay.querySelectorAll('.pay-method-btn').forEach(b => { b.className = 'btn btn-ghost pay-method-btn'; b.style.flex = '1'; });
      btn.className = 'btn btn-primary pay-method-btn active-method';
      btn.style.flex = '1';
      selectedMethod = btn.dataset.method;
    });
  });

  // Cancel
  document.getElementById('cancel-payment').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  // Confirm
  document.getElementById('confirm-payment').addEventListener('click', async () => {
    const confirmBtn = document.getElementById('confirm-payment');
    confirmBtn.disabled = true;
    confirmBtn.innerHTML = '<div class="spinner" style="width:18px;height:18px;border-width:2px;"></div> Processing...';

    try {
      const orderData = {
        items: cart.map(item => ({
          product_id: item.id,
          quantity: item.qty,
        })),
        payment_method: selectedMethod,
        customer_id: document.getElementById('customer-select').value || null,
      };

      const result = await api.post('/orders', orderData);

      overlay.remove();
      cart = [];
      renderCart();

      // Show receipt modal
      showReceiptModal(result.order);

      // Reload products to update stock
      loadProducts();

      toast('Sale completed! ' + result.order.order_number, 'success');
    } catch (err) {
      toast(err.message || 'Payment failed', 'error');
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Confirm Payment';
    }
  });
}

function showReceiptModal(order) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" style="max-width:380px;font-family:monospace;">
      <div style="text-align:center;border-bottom:1px dashed var(--color-border);padding-bottom:1rem;margin-bottom:1rem;">
        <h3 style="font-size:1.1rem;">⚡ QuickPOS</h3>
        <p style="font-size:0.75rem;color:var(--color-text-muted);">Receipt</p>
      </div>

      <div style="font-size:0.8rem;margin-bottom:1rem;">
        <div style="display:flex;justify-content:space-between;"><span>Order #:</span><span style="font-weight:700;">${order.order_number}</span></div>
        <div style="display:flex;justify-content:space-between;"><span>Date:</span><span>${new Date(order.created_at).toLocaleString()}</span></div>
        <div style="display:flex;justify-content:space-between;"><span>Payment:</span><span>${order.payment_method?.toUpperCase()}</span></div>
      </div>

      <div style="border-top:1px dashed var(--color-border);border-bottom:1px dashed var(--color-border);padding:0.75rem 0;margin-bottom:0.75rem;">
        ${(order.items || []).map(item => `
          <div style="display:flex;justify-content:space-between;font-size:0.8rem;margin-bottom:0.25rem;">
            <span>${item.product_name} × ${item.quantity}</span>
            <span>${formatCurrency(item.total)}</span>
          </div>
        `).join('')}
      </div>

      <div style="font-size:0.85rem;">
        <div style="display:flex;justify-content:space-between;"><span>Subtotal:</span><span>${formatCurrency(order.subtotal)}</span></div>
        <div style="display:flex;justify-content:space-between;"><span>Tax:</span><span>${formatCurrency(order.tax_amount)}</span></div>
        <div style="display:flex;justify-content:space-between;font-weight:800;font-size:1.1rem;margin-top:0.5rem;border-top:1px dashed var(--color-border);padding-top:0.5rem;">
          <span>TOTAL:</span><span>${formatCurrency(order.total)}</span>
        </div>
      </div>

      <div style="text-align:center;margin-top:1.5rem;">
        <button class="btn btn-ghost btn-sm" onclick="window.print()">🖨️ Print</button>
        <button class="btn btn-primary btn-sm" onclick="this.closest('.modal-overlay').remove()">Done</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
}

async function loadProducts(search = '') {
  try {
    const params = search ? `?search=${encodeURIComponent(search)}&limit=100` : '?limit=100';
    const data = await api.get(`/products${params}`);
    products = data.products.filter(p => p.is_active);
    renderProducts();
  } catch (err) {
    toast('Failed to load products', 'error');
  }
}

function renderProducts() {
  const grid = document.getElementById('product-grid');
  if (products.length === 0) {
    grid.innerHTML = '<div class="empty-state"><p>No products found</p></div>';
    return;
  }

  grid.innerHTML = products.map(p => `
    <div class="product-card" data-product-id="${p.id}">
      ${p.image_url
        ? `<img src="${p.image_url}" alt="${p.name}" style="width:100%;height:90px;object-fit:contain;border-radius:0.5rem;margin-bottom:0.35rem;background:rgba(255,255,255,0.05);">`
        : `<div style="width:100%;height:90px;display:flex;align-items:center;justify-content:center;border-radius:0.5rem;margin-bottom:0.35rem;background:rgba(255,255,255,0.05);font-size:2rem;">📦</div>`
      }
      <div class="product-name">${p.name}</div>
      <div class="product-price">${formatCurrency(p.price)}</div>
      <div class="product-stock">${p.stock_quantity > 0 ? p.stock_quantity + ' in stock' : '<span style="color:var(--color-danger);">Out of stock</span>'}</div>
    </div>
  `).join('');

  // Click handlers
  grid.querySelectorAll('.product-card').forEach(card => {
    card.addEventListener('click', () => {
      const id = parseInt(card.dataset.productId);
      const product = products.find(p => p.id === id);
      if (product) addToCart(product);
    });
  });
}

const debouncedSearch = debounce((term) => loadProducts(term));

export async function renderPOS() {
  // Cleanup previous scanner listeners
  stopUSBScanner();
  cart = [];
  const content = renderLayout('pos');

  content.innerHTML = `
    <div class="animate-fade-in">
      <div class="page-header" style="margin-bottom:1rem;">
        <h2>POS Terminal</h2>
        <div style="display:flex;align-items:center;gap:0.5rem;">
          <div style="display:flex;align-items:center;gap:0.35rem;padding:0.4rem 0.75rem;border-radius:0.5rem;background:rgba(130,100,255,0.15);font-size:0.75rem;color:var(--color-primary-light);">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><line x1="7" y1="12" x2="17" y2="12"/></svg>
            Scanner Ready
          </div>
          ${scanButtonHTML('pos-camera-scan', { label: 'Scan', variant: 'btn-primary btn-sm' })}
        </div>
      </div>

      <div class="pos-grid">
        <div>
          <div style="margin-bottom:1rem;display:flex;gap:0.5rem;align-items:center;">
            <div style="flex:1;position:relative;">
              <input class="input" type="text" id="product-search" placeholder="Search products by name, SKU, or barcode..." style="padding-left:2.5rem;">
              <span style="position:absolute;left:0.75rem;top:50%;transform:translateY(-50%);color:var(--color-text-muted);width:18px;height:18px;">${icons.search}</span>
            </div>
          </div>
          <div class="product-grid" id="product-grid">
            <div style="grid-column:1/-1;display:flex;justify-content:center;padding:2rem;"><div class="spinner spinner-lg"></div></div>
          </div>
        </div>

        <div class="cart-panel">
          <div class="cart-header">🛒 Cart</div>
          <div class="cart-items" id="cart-items">
            <div class="empty-state" style="padding:2rem;"><p>Cart is empty</p><p style="font-size:0.75rem;">Scan a barcode or click products</p></div>
          </div>
          <div class="cart-summary" id="cart-summary"></div>
        </div>
      </div>
    </div>
  `;

  // Search
  document.getElementById('product-search').addEventListener('input', (e) => {
    debouncedSearch(e.target.value);
  });

  // Camera scan button
  document.getElementById('pos-camera-scan').addEventListener('click', () => {
    openCameraScanner((barcode) => {
      handleBarcodeScan(barcode);
    }, { title: 'Scan Product Barcode' });
  });

  // Start USB/Bluetooth barcode scanner listener
  await loadProducts();

  startUSBScanner((barcode) => {
    handleBarcodeScan(barcode);
  });
}
