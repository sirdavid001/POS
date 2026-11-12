import { api } from '../api.js';
import { canWriteBusinessData } from '../entitlement.js';
import { renderLayout } from './layout.js';
import { mountCustomerPicker } from '../customer-picker.js';
import { currencySymbol, escapeAttribute, escapeHTML, formatCurrency, toast, debounce, icons } from '../utils.js';
import { startUSBScanner, stopUSBScanner, openCameraScanner, scanButtonHTML } from '../scanner.js';
import {
  calculateCartTotals,
  changeDue,
  createClientOrderId,
  quickCashAmounts,
  resolveDiscount,
  roundMoney,
} from '../pos-math.js';

let cart = [];
let products = [];
let categories = [];
let activeCategory = '';
let storeSettings = {
  name: 'QuickPOS Store',
  tax_rate: 0,
  receipt_header: '',
  receipt_footer: 'Thank you for your business!'
};

function getCartTotal() {
  return calculateCartTotals(cart, storeSettings.tax_rate);
}

function renderCart() {
  const cartItems = document.getElementById('cart-items');
  const cartSummary = document.getElementById('cart-summary');

  if (cart.length === 0) {
    cartItems.innerHTML = '<div class="empty-state" style="padding:2rem;"><p>Cart is empty</p><p style="font-size:0.8rem;">Click products to add them</p></div>';
    cartSummary.innerHTML = '';
    const emptyBadge = document.getElementById('mobile-cart-badge');
    if (emptyBadge) emptyBadge.hidden = true;
    return;
  }

  cartItems.innerHTML = cart.map((item, i) => `
    <div class="cart-item animate-fade-in">
      ${item.image_url
        ? `<img src="${escapeAttribute(item.image_url)}" alt="" style="width:36px;height:36px;object-fit:contain;border-radius:0.375rem;flex-shrink:0;background:rgba(128,128,128,0.08);">`
        : `<div style="width:36px;height:36px;display:flex;align-items:center;justify-content:center;border-radius:0.375rem;flex-shrink:0;background:rgba(128,128,128,0.08);color:var(--color-text-muted);" class="placeholder-icon">${icons.package}</div>`
      }
      <div class="cart-item-name">${escapeHTML(item.name)}<span class="cart-item-unit">${formatCurrency(item.price)} each</span></div>
      <div class="cart-item-qty">
        <button type="button" data-cart-action="decrease" data-index="${i}" aria-label="Decrease ${escapeAttribute(item.name)} quantity">−</button>
        <span style="min-width:20px;text-align:center;font-weight:600;">${item.qty}</span>
        <button type="button" data-cart-action="increase" data-index="${i}" aria-label="Increase ${escapeAttribute(item.name)} quantity">+</button>
      </div>
      <div class="cart-item-price">${formatCurrency(item.price * item.qty)}</div>
      <button type="button" class="cart-item-remove" data-cart-action="remove" data-index="${i}" aria-label="Remove ${escapeAttribute(item.name)} from cart">×</button>
    </div>
  `).join('');

  cartItems.querySelectorAll('[data-cart-action]').forEach((button) => {
    button.addEventListener('click', () => {
      const index = Number(button.dataset.index);
      const action = button.dataset.cartAction;
      if (action === 'decrease') updateCartQuantity(index, -1);
      if (action === 'increase') updateCartQuantity(index, 1);
      if (action === 'remove') removeCartItem(index);
    });
  });

  const totals = getCartTotal();
  cartSummary.innerHTML = `
    <div class="cart-summary-row"><span>Subtotal</span><span>${formatCurrency(totals.subtotal)}</span></div>
    ${totals.tax > 0 ? `<div class="cart-summary-row"><span>Tax (${Number(storeSettings.tax_rate)}%)</span><span>${formatCurrency(totals.tax)}</span></div>` : ''}
    <div class="cart-summary-row cart-total"><span>Total</span><span>${formatCurrency(totals.total)}</span></div>
    <div style="display:flex;gap:0.5rem;margin-top:1rem;">
      <button class="btn btn-ghost" id="clear-cart" type="button" style="flex:1;">Clear</button>
      <button class="btn btn-accent btn-lg" id="checkout-cart" type="button" style="flex:2;">
        Pay ${formatCurrency(totals.total)}
      </button>
    </div>
  `;
  document.getElementById('clear-cart').addEventListener('click', clearCart);
  document.getElementById('checkout-cart').addEventListener('click', checkoutCart);

  // Update mobile cart badge
  const cartBadge = document.getElementById('mobile-cart-badge');
  if (cartBadge) {
    const count = cart.reduce((sum, item) => sum + item.qty, 0);
    cartBadge.textContent = count;
    cartBadge.hidden = count === 0;
  }
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

function updateCartQuantity(index, delta) {
  cart[index].qty += delta;
  if (cart[index].qty <= 0) cart.splice(index, 1);
  else if (cart[index].qty > cart[index].stock) {
    cart[index].qty = cart[index].stock;
    toast('Maximum stock reached', 'error');
  }
  renderCart();
}

function removeCartItem(index) {
  cart.splice(index, 1);
  renderCart();
}

function clearCart() {
  if (cart.length === 0) return;
  if (!confirm('Clear every item from this cart?')) return;
  cart = [];
  renderCart();
}

function checkoutCart() {
  if (cart.length === 0) return;
  showPaymentModal();
}

function showPaymentModal() {
  const baseTotals = getCartTotal();
  const billTotal = roundMoney(baseTotals.subtotal + baseTotals.tax);
  const itemCount = cart.reduce((sum, item) => sum + item.qty, 0);

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal payment-modal" role="dialog" aria-modal="true" aria-labelledby="payment-modal-title" style="max-width:440px;">
      <h3 id="payment-modal-title" style="font-size:1.15rem;font-weight:700;margin-bottom:1.25rem;">Complete Payment</h3>
      <div class="payment-total">
        <div class="payment-total-label">Total to pay</div>
        <div class="payment-total-value" id="payment-total-value">${formatCurrency(billTotal)}</div>
        <div class="payment-total-meta" id="payment-total-meta">${itemCount} item${itemCount === 1 ? '' : 's'}</div>
      </div>

      <div class="form-group">
        <label class="label" for="payment-discount">Discount (optional)</label>
        <div class="discount-row">
          <input class="input" id="payment-discount" type="number" inputmode="decimal" min="0" step="0.01" placeholder="0" autocomplete="off">
          <select class="input" id="payment-discount-unit" aria-label="Discount type">
            <option value="amount">${currencySymbol()} off</option>
            <option value="percent">% off</option>
          </select>
        </div>
        <p class="field-help" id="payment-discount-help" hidden></p>
      </div>

      <span class="label" id="payment-method-label">Payment Method</span>
      <div role="group" aria-labelledby="payment-method-label" style="display:flex;gap:0.5rem;margin-bottom:1.5rem;">
        <button type="button" class="btn btn-primary pay-method-btn active-method" aria-pressed="true" data-method="cash" style="flex:1;">${icons.cash} Cash</button>
        <button type="button" class="btn btn-ghost pay-method-btn" aria-pressed="false" data-method="card" style="flex:1;">${icons.card} Card</button>
        <button type="button" class="btn btn-ghost pay-method-btn" aria-pressed="false" data-method="transfer" style="flex:1;">${icons.bank} Transfer</button>
      </div>

      <div class="form-group" id="cash-group">
        <label class="label" for="cash-received">Amount received</label>
        <input class="input" id="cash-received" type="number" inputmode="decimal" min="0" step="0.01" placeholder="Leave empty if exact" autocomplete="off">
        <div class="quick-cash" role="group" aria-label="Quick cash amounts" id="quick-cash"></div>
        <div class="change-due" id="change-due-row" aria-live="polite">
          <span>Change due</span><strong id="change-due">${formatCurrency(0)}</strong>
        </div>
      </div>

      <div class="form-group" id="payment-reference-group" hidden>
        <label class="label" for="payment-reference">Payment Reference</label>
        <input class="input" id="payment-reference" autocomplete="off" placeholder="Terminal or bank reference">
        <p class="field-help">Confirm the payment on the external terminal or bank app before completing this sale.</p>
      </div>

      <div class="form-group" id="customer-picker"></div>

      <div class="payment-actions">
        <button class="btn btn-ghost" id="cancel-payment" type="button" data-dialog-close style="flex:1;">Cancel</button>
        <button class="btn btn-accent btn-lg" id="confirm-payment" type="button" style="flex:2;">
          Confirm ${formatCurrency(billTotal)}
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  const previousFocus = document.activeElement;
  const closePaymentModal = () => {
    overlay.remove();
    previousFocus?.focus?.();
  };
  overlay.querySelector('[data-method="cash"]').focus();

  const customerPicker = mountCustomerPicker(overlay.querySelector('#customer-picker'));

  // Discount and cash: everything shown is recomputed from these inputs.
  const discountInput = overlay.querySelector('#payment-discount');
  const discountUnit = overlay.querySelector('#payment-discount-unit');
  const discountHelp = overlay.querySelector('#payment-discount-help');
  const cashInput = overlay.querySelector('#cash-received');
  const quickCash = overlay.querySelector('#quick-cash');
  const changeDueEl = overlay.querySelector('#change-due');
  const changeRow = overlay.querySelector('#change-due-row');
  let payable = billTotal;
  let discountAmount = 0;

  function renderQuickCash() {
    quickCash.innerHTML = quickCashAmounts(payable).map((amount, index) => `
      <button type="button" class="btn btn-ghost btn-sm" data-cash-amount="${amount}">${index === 0 ? 'Exact' : formatCurrency(amount)}</button>
    `).join('');
  }

  function updateChange() {
    if (cashInput.value === '') {
      changeDueEl.textContent = formatCurrency(0);
      changeRow.classList.remove('is-short');
      return;
    }
    const change = changeDue(cashInput.value, payable);
    changeRow.classList.toggle('is-short', change === null);
    changeDueEl.textContent = change === null
      ? `${formatCurrency(payable - roundMoney(cashInput.value))} short`
      : formatCurrency(change);
  }

  function updateTotals() {
    const { amount, capped } = resolveDiscount({ value: discountInput.value, unit: discountUnit.value, billTotal });
    discountAmount = amount;
    payable = roundMoney(billTotal - amount);
    overlay.querySelector('#payment-total-value').textContent = formatCurrency(payable);
    overlay.querySelector('#payment-total-meta').textContent = amount > 0
      ? `${itemCount} item${itemCount === 1 ? '' : 's'} · ${formatCurrency(amount)} discount`
      : `${itemCount} item${itemCount === 1 ? '' : 's'}`;
    overlay.querySelector('#confirm-payment').textContent = `Confirm ${formatCurrency(payable)}`;
    discountHelp.hidden = !capped;
    discountHelp.textContent = capped ? `Discount can’t be more than the bill (${formatCurrency(billTotal)}).` : '';
    renderQuickCash();
    updateChange();
  }

  discountInput.addEventListener('input', updateTotals);
  discountUnit.addEventListener('change', updateTotals);
  cashInput.addEventListener('input', updateChange);
  quickCash.addEventListener('click', (event) => {
    const button = event.target.closest('[data-cash-amount]');
    if (!button) return;
    cashInput.value = button.dataset.cashAmount;
    updateChange();
  });
  renderQuickCash();

  // Payment method selection
  let selectedMethod = 'cash';
  overlay.querySelectorAll('.pay-method-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      overlay.querySelectorAll('.pay-method-btn').forEach(b => { b.className = 'btn btn-ghost pay-method-btn'; b.style.flex = '1'; });
      overlay.querySelectorAll('.pay-method-btn').forEach(b => b.setAttribute('aria-pressed', 'false'));
      btn.className = 'btn btn-primary pay-method-btn active-method';
      btn.setAttribute('aria-pressed', 'true');
      btn.style.flex = '1';
      selectedMethod = btn.dataset.method;
      const referenceGroup = document.getElementById('payment-reference-group');
      const referenceInput = document.getElementById('payment-reference');
      referenceGroup.hidden = selectedMethod === 'cash';
      referenceInput.required = selectedMethod !== 'cash';
      if (selectedMethod === 'cash') referenceInput.value = '';
      overlay.querySelector('#cash-group').hidden = selectedMethod !== 'cash';
      if (selectedMethod !== 'cash') {
        cashInput.value = '';
        updateChange();
      }
    });
  });

  // Cancel
  document.getElementById('cancel-payment').addEventListener('click', closePaymentModal);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closePaymentModal(); });

  // Confirm
  document.getElementById('confirm-payment').addEventListener('click', async () => {
    if (!canWriteBusinessData()) {
      toast('QuickPOS is read-only. Ask the store owner to renew the subscription.', 'warning', 5000);
      return;
    }

    const confirmBtn = document.getElementById('confirm-payment');
    const paymentReference = document.getElementById('payment-reference').value.trim();
    if (selectedMethod !== 'cash' && !paymentReference) {
      toast('Enter the confirmed terminal or bank reference', 'warning');
      document.getElementById('payment-reference').focus();
      return;
    }
    const cashReceived = selectedMethod === 'cash' && cashInput.value !== '' ? roundMoney(cashInput.value) : null;
    const cashChange = cashReceived === null ? null : changeDue(cashReceived, payable);
    if (cashReceived !== null && cashChange === null) {
      toast(`Amount received is less than ${formatCurrency(payable)}. Enter the full amount or leave it empty for exact cash.`, 'warning', 5000);
      cashInput.focus();
      return;
    }
    const confirmLabel = confirmBtn.textContent;
    confirmBtn.disabled = true;
    confirmBtn.innerHTML = '<div class="spinner" style="width:18px;height:18px;border-width:2px;"></div> Processing…';

    const orderData = {
      items: cart.map(item => ({
        product_id: item.id,
        quantity: item.qty,
      })),
      payment_method: selectedMethod,
      payment_reference: paymentReference || undefined,
      customer_id: customerPicker.customerId,
      discount_amount: discountAmount,
      client_order_id: createClientOrderId(),
    };

    try {
      const result = await api.post('/orders', orderData);

      closePaymentModal();
      cart = [];
      renderCart();

      // Show receipt modal
      showReceiptModal(result.order, { cashReceived, cashChange, customerName: customerPicker.customer?.name || result.order.customer_name || null });

      // Reload products to update stock
      loadProducts();

      toast('Sale completed! ' + result.order.order_number, 'success');
      if (result.offline) {
        toast('Sale saved on this device and queued for sync', 'warning', 5000);
      }
    } catch (err) {
      if (err.code === 'SUBSCRIPTION_EXPIRED') {
        toast('QuickPOS is read-only until the store renews.', 'warning', 5000);
      } else {
        toast(err.message || 'Payment failed', 'error');
      }
      confirmBtn.disabled = false;
      confirmBtn.textContent = confirmLabel;
    }
  });
}

function receiptRow(label, value, extra = '') {
  return `<div class="receipt-row"${extra}><span>${label}</span><span>${value}</span></div>`;
}

function showReceiptModal(order, { cashReceived = null, cashChange = null, customerName = null } = {}) {
  const cashier = JSON.parse(localStorage.getItem('user') || '{}').name || order.cashier_name || '';
  const customer = customerName || order.customer_name || '';
  const taxRate = Number(storeSettings.tax_rate || 0);
  const storeContact = [storeSettings.address, storeSettings.phone]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  const discount = Number(order.discount_amount || 0);
  const discountLine = discount > 0
    ? `<div style="display:flex;justify-content:space-between;"><span>Discount:</span><span>−${formatCurrency(discount)}</span></div>`
    : '';
  const cashLines = cashReceived !== null
    ? `<div style="display:flex;justify-content:space-between;margin-top:0.5rem;"><span>Cash received:</span><span>${formatCurrency(cashReceived)}</span></div>
       <div style="display:flex;justify-content:space-between;font-weight:700;"><span>Change:</span><span>${formatCurrency(cashChange ?? 0)}</span></div>`
    : '';
  const shopName = escapeHTML(storeSettings.name || 'QuickPOS Store');
  const receiptHeader = storeSettings.receipt_header
    ? `<div style="text-align:center;font-size:0.8rem;margin-bottom:1rem;color:var(--color-text-muted);white-space:pre-wrap;">${escapeHTML(storeSettings.receipt_header)}</div>`
    : '';
  const receiptFooter = escapeHTML(storeSettings.receipt_footer || 'Thank you for your business!');

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal receipt-printable" role="dialog" aria-modal="true" aria-labelledby="receipt-title" style="max-width:380px;font-family:monospace;">
      <div style="text-align:center;border-bottom:1px dashed var(--color-border);padding-bottom:1rem;margin-bottom:1rem;">
        ${storeSettings.logo_url ? `<img class="receipt-logo" src="${escapeAttribute(storeSettings.logo_url)}" alt="" width="56" height="56">` : ''}
        <h3 id="receipt-title" style="font-size:1.1rem;">${shopName}</h3>
        ${storeContact.map((line) => `<div class="receipt-contact">${escapeHTML(line)}</div>`).join('')}
        ${receiptHeader}
        <p style="font-size:0.75rem;color:var(--color-text-muted);">Receipt</p>
      </div>

      <div style="font-size:0.8rem;margin-bottom:1rem;">
        <div style="display:flex;justify-content:space-between;"><span>Order #:</span><span style="font-weight:700;">${escapeHTML(order.order_number)}</span></div>
        <div style="display:flex;justify-content:space-between;"><span>Date:</span><span>${new Date(order.created_at).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' })}</span></div>
        <div style="display:flex;justify-content:space-between;"><span>Payment:</span><span>${escapeHTML(order.payment_method?.toUpperCase())}</span></div>
        ${cashier ? receiptRow('Cashier:', escapeHTML(cashier)) : ''}
        ${customer ? receiptRow('Customer:', escapeHTML(customer)) : ''}
        ${order.payment_reference ? `<div style="display:flex;justify-content:space-between;gap:1rem;"><span>Reference:</span><span>${escapeHTML(order.payment_reference)}</span></div>` : ''}
      </div>

      <div style="border-top:1px dashed var(--color-border);border-bottom:1px dashed var(--color-border);padding:0.75rem 0;margin-bottom:0.75rem;">
        ${(order.items || []).map(item => `
          <div style="display:flex;justify-content:space-between;font-size:0.8rem;margin-bottom:0.25rem;">
            <span>${escapeHTML(item.product_name)} × ${Number(item.quantity)}</span>
            <span>${formatCurrency(item.total)}</span>
          </div>
        `).join('')}
      </div>

      <div style="font-size:0.85rem;">
        <div style="display:flex;justify-content:space-between;"><span>Subtotal:</span><span>${formatCurrency(order.subtotal)}</span></div>
        <div style="display:flex;justify-content:space-between;"><span>${taxRate > 0 ? `Tax (${taxRate}%):` : 'Tax:'}</span><span>${formatCurrency(order.tax_amount)}</span></div>
        ${discountLine}
        <div style="display:flex;justify-content:space-between;font-weight:800;font-size:1.1rem;margin-top:0.5rem;border-top:1px dashed var(--color-border);padding-top:0.5rem;">
          <span>TOTAL:</span><span>${formatCurrency(order.total)}</span>
        </div>
        ${cashLines}
      </div>

      <div style="text-align:center;font-size:0.75rem;margin-top:1.5rem;color:var(--color-text-muted);white-space:pre-wrap;">${receiptFooter}</div>

      <div class="no-print" style="text-align:center;margin-top:1.5rem;">
        <button class="btn btn-ghost btn-sm" id="print-receipt" type="button">${icons.printer} Print</button>
        <button class="btn btn-primary btn-sm" id="close-receipt" type="button" data-dialog-close>Done</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  overlay.querySelector('#print-receipt').addEventListener('click', () => window.print());
  overlay.querySelector('#close-receipt').addEventListener('click', () => overlay.remove());
  
}

async function loadProducts(search = '') {
  try {
    const params = search ? `?search=${encodeURIComponent(search)}&limit=100` : '?limit=100';
    const data = await api.get(`/products${params}`);
    products = data.products.filter(p => p.is_active);
    renderProducts();
  } catch {
    toast('Failed to load products', 'error');
  }
}

function renderCategoryChips() {
  const container = document.getElementById('category-chips');
  if (!container) return;
  const used = new Set(products.map((product) => String(product.category_id)));
  const visible = categories.filter((category) => used.has(String(category.id)));
  if (visible.length < 2) {
    container.hidden = true;
    return;
  }
  container.hidden = false;
  container.innerHTML = [{ id: '', name: 'All' }, ...visible].map((category) => `
    <button type="button" class="category-chip" data-category="${escapeAttribute(category.id)}" aria-pressed="${String(category.id) === String(activeCategory)}">${escapeHTML(category.name)}</button>
  `).join('');
}

function renderProducts() {
  const grid = document.getElementById('product-grid');
  renderCategoryChips();
  const shown = activeCategory
    ? products.filter((product) => String(product.category_id) === String(activeCategory))
    : products;
  if (shown.length === 0) {
    grid.innerHTML = '<div class="empty-state"><p>No products found</p></div>';
    return;
  }

  grid.innerHTML = shown.map(p => `
    <button type="button" class="product-card" data-product-id="${escapeAttribute(p.id)}" aria-label="Add ${escapeAttribute(p.name)} to cart">
      ${p.image_url
        ? `<img src="${escapeAttribute(p.image_url)}" alt="" style="width:100%;height:90px;object-fit:contain;border-radius:0.5rem;margin-bottom:0.35rem;background:rgba(255,255,255,0.05);">`
        : `<div style="width:100%;height:90px;display:flex;align-items:center;justify-content:center;border-radius:0.5rem;margin-bottom:0.35rem;background:rgba(255,255,255,0.05);color:var(--color-text-muted);" class="placeholder-icon placeholder-icon-lg">${icons.package}</div>`
      }
      <div class="product-name">${escapeHTML(p.name)}</div>
      <div class="product-price">${formatCurrency(p.price)}</div>
      <div class="product-stock">${p.stock_quantity > 0 ? p.stock_quantity + ' in stock' : '<span style="color:var(--color-danger);">Out of stock</span>'}</div>
    </button>
  `).join('');

  // Click handlers
  grid.querySelectorAll('.product-card').forEach(card => {
    card.addEventListener('click', () => {
      const id = card.dataset.productId;
      const product = products.find(p => String(p.id) === String(id));
      if (product) {
        addToCart(product);
        card.classList.add('just-added');
        setTimeout(() => card.classList.remove('just-added'), 350);
      }
    });
  });
}

const debouncedSearch = debounce((term) => loadProducts(term));

// Keyboard shortcuts for busy counters: F2 jumps to search, F9 opens payment.
// Function keys never reach the barcode-scanner buffer, so scanning is unaffected.
function handlePOSShortcuts(event) {
  if (!window.location.hash.startsWith('#/pos')) return;
  if (document.querySelector('.modal-overlay')) return;
  if (event.key === 'F2') {
    event.preventDefault();
    const search = document.getElementById('product-search');
    search?.focus();
    search?.select();
  } else if (event.key === 'F9') {
    event.preventDefault();
    checkoutCart();
  }
}
if (!window._posShortcutsMounted) {
  window._posShortcutsMounted = true;
  document.addEventListener('keydown', handlePOSShortcuts);
}

export async function renderPOS() {
  // Cleanup previous scanner listeners
  stopUSBScanner();
  cart = [];
  const content = renderLayout('pos');

  content.innerHTML = `
    <div class="animate-fade-in">
      <div class="page-header" style="margin-bottom:1rem;">
        <h1>POS Terminal</h1>
        <div style="display:flex;align-items:center;gap:0.5rem;">
          <span class="pos-shortcuts" aria-hidden="true"><kbd>F2</kbd> search · <kbd>F9</kbd> pay</span>
          ${scanButtonHTML('pos-camera-scan', { label: 'Scan', variant: 'btn-primary btn-sm' })}
        </div>
      </div>

      <div class="pos-grid">
        <div>
          <div class="filter-row" style="margin-bottom:1rem;display:flex;gap:0.5rem;align-items:center;">
            <div style="flex:1;position:relative;">
              <label class="sr-only" for="product-search">Search products</label>
              <input class="input" type="search" id="product-search" placeholder="Search name, SKU or barcode…" autocomplete="off" spellcheck="false" style="padding-left:2.5rem;">
              <span style="position:absolute;left:0.75rem;top:50%;transform:translateY(-50%);color:var(--color-text-muted);width:18px;height:18px;">${icons.search}</span>
            </div>
          </div>
          <div class="category-chips" id="category-chips" role="group" aria-label="Filter by category" hidden></div>
          <div class="product-grid" id="product-grid">
            <div style="grid-column:1/-1;display:flex;justify-content:center;padding:2rem;"><div class="spinner spinner-lg"></div></div>
          </div>
        </div>

        <div class="cart-panel mobile-hidden" id="cart-panel">
          <div class="cart-header" style="display:flex;justify-content:space-between;align-items:center;"><span class="cart-title"><span aria-hidden="true">${icons.cart}</span> Cart</span> <button class="btn btn-ghost btn-sm" id="close-cart-mobile" type="button" aria-label="Close cart" style="display:none;padding:0.25rem 0.5rem;">${icons.close}</button></div>
          <div class="cart-items" id="cart-items">
            <div class="empty-state" style="padding:2rem;"><p>Cart is empty</p><p style="font-size:0.75rem;">Scan a barcode or click products</p></div>
          </div>
          <div class="cart-summary" id="cart-summary"></div>
        </div>
      </div>

      <!-- Mobile cart toggle FAB -->
      <button class="mobile-cart-toggle" id="mobile-cart-toggle" type="button" aria-label="Open cart">
        ${icons.cart}
        <span class="cart-badge" id="mobile-cart-badge" hidden>0</span>
      </button>
    </div>
  `;

  // Wire up mobile cart toggle
  const cartToggleBtn = document.getElementById('mobile-cart-toggle');
  const cartPanel = document.getElementById('cart-panel');
  const closeCartBtn = document.getElementById('close-cart-mobile');

  if (cartToggleBtn && cartPanel && closeCartBtn) {
    cartToggleBtn.addEventListener('click', () => {
      cartPanel.classList.remove('mobile-hidden');
      cartPanel.classList.add('mobile-visible');
      closeCartBtn.style.display = 'block';
    });

    closeCartBtn.addEventListener('click', () => {
      cartPanel.classList.add('mobile-hidden');
      cartPanel.classList.remove('mobile-visible');
      closeCartBtn.style.display = 'none';
    });
  }

  // Category chips
  document.getElementById('category-chips').addEventListener('click', (event) => {
    const chip = event.target.closest('[data-category]');
    if (!chip) return;
    activeCategory = chip.dataset.category;
    renderProducts();
  });
  activeCategory = '';
  api.get('/categories').then((data) => {
    categories = data.categories || [];
    renderCategoryChips();
  }).catch(() => {});

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

  try {
    const { store } = await api.get('/settings/store');
    storeSettings = { ...storeSettings, ...store };
  } catch {}

  // Start USB/Bluetooth barcode scanner listener
  await loadProducts();

  startUSBScanner((barcode) => {
    handleBarcodeScan(barcode);
  });
}
