// Lightweight mock API server for demo (no database required)
// Run with: node packages/server/src/mock-server.js

import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import { createServer } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import { computeInsightsFromOrders } from '../../shared/src/insights.js';
import { registerMockAdminTools, registerMockPlatform, registerMockSupport } from './mock-platform.js';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
const PORT = 3001;
const JWT_SECRET = 'demo-secret';

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// ===== In-memory data =====
const store = { id: 1, name: 'QuickPOS Demo Store', address: '123 Main Street, Lagos', phone: '+234 800 000 0000', email: 'store@posapp.com', tax_rate: '7.50', currency: 'NGN', receipt_header: 'Thank you for shopping!', receipt_footer: 'Visit again soon!' };

const users = [];
if (process.env.SEED_ADMIN_EMAIL && process.env.SEED_ADMIN_PASSWORD) {
  users.push({
    id: 1,
    store_id: 1,
    role_id: 1,
    email: process.env.SEED_ADMIN_EMAIL,
    password: process.env.SEED_ADMIN_PASSWORD,
    name: 'Seed Admin',
    role: 'admin',
    is_active: true,
    last_login: new Date().toISOString(),
    created_at: new Date().toISOString(),
  });
}

const mockSubscription = {
  status: 'grandfathered',
  can_write: true,
  offline_valid_until: new Date(Date.now() + 7 * 86400000).toISOString(),
  server_time: new Date().toISOString(),
};

const categories = [
  { id: 1, store_id: 1, name: 'Grains & Flour', description: 'Rice, garri, semolina, beans and pasta', created_at: new Date().toISOString() },
  { id: 2, store_id: 1, name: 'Provisions', description: 'Noodles, milk, tins and cooking essentials', created_at: new Date().toISOString() },
  { id: 3, store_id: 1, name: 'Drinks', description: 'Water and soft drinks', created_at: new Date().toISOString() },
  { id: 4, store_id: 1, name: 'Bakery & Eggs', description: 'Bread and fresh eggs', created_at: new Date().toISOString() },
  { id: 5, store_id: 1, name: 'Snacks', description: 'Chin chin, chips and small chops', created_at: new Date().toISOString() },
  { id: 6, store_id: 1, name: 'Stationery', description: 'School and office supplies', created_at: new Date().toISOString() },
  { id: 7, store_id: 1, name: 'Phone Accessories', description: 'Cables and earphones', created_at: new Date().toISOString() },
];

// A Nigerian supermarket catalogue for the demo store. Every brand is made up.
const catalogue = [
  [1, 'Long Grain Rice 5kg', 'Premium parboiled long grain rice', 'GRN-001', 12500, 10800, 34, 8, 'rice.png'],
  [1, 'Semolina 2kg', 'Fine wheat semolina for swallow', 'GRN-002', 4200, 3500, 26, 6, 'semolina.jpg'],
  [1, 'Garri (White) 2kg', 'Ijebu-style white garri', 'GRN-003', 3000, 2400, 40, 10, 'garri.jpg'],
  [1, 'Honey Beans (Oloyin) 1kg', 'Sorted brown honey beans', 'GRN-004', 2800, 2200, 30, 8, 'beans.jpg'],
  [1, 'Spaghetti 500g', 'Long spaghetti', 'GRN-005', 1300, 1050, 60, 15, 'spaghetti.jpg'],
  [2, 'Instant Noodles Chicken 120g', 'Chicken flavour instant noodles', 'PRV-001', 450, 360, 180, 40, 'noodles.jpg'],
  [2, 'Evaporated Milk 160g', 'Full cream evaporated milk', 'PRV-002', 650, 520, 96, 24, 'milk.jpg'],
  [2, 'Tomato Paste 400g', 'Double concentrated tomato paste', 'PRV-003', 1800, 1450, 48, 12, 'tomato-paste.jpg'],
  [2, 'Sardines in Oil 125g', 'Sardines in vegetable oil', 'PRV-004', 1300, 1050, 7, 12, 'sardines.jpg'],
  [2, 'Granulated Sugar 1kg', 'Refined white sugar', 'PRV-005', 2200, 1850, 35, 10, 'sugar.jpg'],
  [2, 'Vegetable Oil 1L', 'Pure vegetable cooking oil', 'PRV-006', 3800, 3200, 22, 8, 'cooking-oil.png'],
  [3, 'Malt Drink 33cl Can', 'Non-alcoholic malt drink', 'DRK-001', 700, 560, 120, 24, 'malt-drink.jpg'],
  [3, 'Table Water 75cl', 'Purified table water', 'DRK-002', 250, 170, 200, 48, 'water.png'],
  [4, 'Sliced Bread', 'Soft sliced white bread', 'BKE-001', 1500, 1200, 18, 6, 'bread.jpg'],
  [4, 'Crate of Eggs (30)', 'Fresh farm eggs, 30 per tray', 'BKE-002', 6500, 5600, 5, 8, 'eggs.jpg'],
  [5, 'Chin Chin 250g', 'Crunchy chin chin', 'SNK-001', 1000, 700, 45, 12, 'chin-chin.png'],
  [5, 'Plantain Chips', 'Crispy salted plantain chips', 'SNK-002', 500, 320, 64, 15, 'plantain-chips.png'],
  [6, 'Exercise Book A5', 'Ruled exercise book, 40 leaves', 'STN-001', 400, 250, 80, 20, 'notebook.png'],
  [7, 'USB-C Charging Cable', 'Fast charging cable, 1m', 'ACC-001', 2500, 1400, 20, 5, 'usb-cable.png'],
  [7, 'Wired Earphones', 'In-ear earphones with mic', 'ACC-002', 3500, 2000, 15, 4, 'earphones.png'],
];

let productIdCounter = catalogue.length + 1;
const products = catalogue.map(([categoryId, name, description, sku, price, cost, stock, alertAt, image], index) => ({
  id: index + 1,
  store_id: 1,
  category_id: categoryId,
  name,
  description,
  sku,
  barcode: `615${String(4021000 + index * 37).padStart(7, '0')}${String(index).padStart(3, '0')}`,
  price: price.toFixed(2),
  cost_price: cost.toFixed(2),
  stock_quantity: stock,
  low_stock_threshold: alertAt,
  is_active: true,
  category_name: categories.find((category) => category.id === categoryId).name,
  image_url: `/products/${image}`,
  created_at: new Date(Date.now() - 45 * 86400000).toISOString(),
}));

const customers = [
  { id: 1, store_id: 1, name: 'Adebayo Johnson', email: 'adebayo@email.com', phone: '+234 801 234 5678', loyalty_points: 120, notes: 'Buys rice and oil every month end', created_at: new Date(Date.now() - 40 * 86400000).toISOString() },
  { id: 2, store_id: 1, name: 'Chioma Okafor', email: 'chioma@email.com', phone: '+234 802 345 6789', loyalty_points: 85, notes: '', created_at: new Date(Date.now() - 38 * 86400000).toISOString() },
  { id: 3, store_id: 1, name: 'Emeka Eze', email: 'emeka@email.com', phone: '+234 803 456 7890', loyalty_points: 45, notes: '', created_at: new Date(Date.now() - 30 * 86400000).toISOString() },
  { id: 4, store_id: 1, name: 'Funmilayo Bakare', email: 'funmi@email.com', phone: '+234 805 112 9087', loyalty_points: 150, notes: 'Orders eggs in bulk for her bakery', created_at: new Date(Date.now() - 28 * 86400000).toISOString() },
  { id: 5, store_id: 1, name: 'Ibrahim Musa', email: 'ibrahim@email.com', phone: '+234 806 774 2210', loyalty_points: 30, notes: '', created_at: new Date(Date.now() - 20 * 86400000).toISOString() },
  { id: 6, store_id: 1, name: 'Ngozi Nwachukwu', email: 'ngozi@email.com', phone: '+234 809 553 6421', loyalty_points: 64, notes: '', created_at: new Date(Date.now() - 12 * 86400000).toISOString() },
];

const suppliers = [
  { id: 1, store_id: 1, name: 'Lagos Wholesale Ltd', contact_name: 'Mr. Okonkwo', email: 'wholesale@lagos.com', phone: '+234 800 111 2222', created_at: new Date().toISOString() },
  { id: 2, store_id: 1, name: 'Tech Imports Nigeria', contact_name: 'Mrs. Adeyemi', email: 'tech@imports.ng', phone: '+234 800 333 4444', created_at: new Date().toISOString() },
];

let orderIdCounter = 1;
const orders = [];
const inventoryLogs = [];

// Sixty days of believable counter sales so the dashboard, reports and
// orders pages have real numbers in demos and screenshots.
function seedDemoSales() {
  let seed = 20261128;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const pick = (list) => list[Math.floor(random() * list.length)];
  const fastMovers = [6, 7, 12, 13, 17, 16, 5, 8, 10, 14, 3, 2, 1, 4, 11, 9, 15, 18, 19, 20];
  const cashiers = ['Amaka Obi', 'Tunde Bello'];
  const now = new Date();
  for (let daysAgo = 59; daysAgo >= 0; daysAgo -= 1) {
    const day = new Date(now);
    day.setDate(now.getDate() - daysAgo);
    const weekend = [0, 6].includes(day.getDay());
    // A store that is growing: a few more sales a day as the weeks go by.
    const growth = ((59 - daysAgo) / 59) * 5;
    const count = Math.round(7 + random() * 8 + growth + (weekend ? 6 : 0));
    for (let n = 0; n < count; n += 1) {
      const createdAt = new Date(day);
      createdAt.setHours(8 + Math.floor(random() * 12), Math.floor(random() * 60), Math.floor(random() * 60), 0);
      if (createdAt > now) continue;
      const lineCount = 1 + Math.floor(random() * 4);
      const used = new Set();
      const items = [];
      for (let line = 0; line < lineCount; line += 1) {
        // Cheaper everyday items sell far more often than electronics.
        const productId = fastMovers[Math.min(fastMovers.length - 1, Math.floor(Math.pow(random(), 1.8) * fastMovers.length))];
        if (used.has(productId)) continue;
        used.add(productId);
        const product = products.find((p) => p.id === productId);
        const quantity = Number(product.price) <= 700 ? 1 + Math.floor(random() * 5) : 1 + Math.floor(random() * 2);
        const total = Number(product.price) * quantity;
        items.push({ id: orderIdCounter * 100 + items.length, product_id: product.id, product_name: product.name, quantity, unit_price: product.price, discount: '0.00', total: total.toFixed(2) });
      }
      const subtotal = items.reduce((sum, item) => sum + Number(item.total), 0);
      const taxAmount = subtotal * 0.075;
      const roll = random();
      const paymentMethod = roll < 0.48 ? 'cash' : roll < 0.84 ? 'transfer' : 'card';
      const customer = random() < 0.3 ? pick(customers) : null;
      orders.unshift({
        id: orderIdCounter++, store_id: 1, user_id: 1, customer_id: customer?.id || null,
        order_number: `ORD-${createdAt.toISOString().slice(2, 10).replace(/-/g, '')}-${String(orderIdCounter).padStart(4, '0')}`,
        subtotal: subtotal.toFixed(2), tax_amount: taxAmount.toFixed(2), discount_amount: '0.00', total: (subtotal + taxAmount).toFixed(2),
        status: 'completed', payment_method: paymentMethod,
        payment_reference: paymentMethod === 'cash' ? null : `${paymentMethod === 'card' ? 'POS' : 'TRF'}${Math.floor(100000 + random() * 899999)}`,
        client_order_id: null, cashier_name: pick(cashiers), customer_name: customer?.name || null,
        paid_at: createdAt.toISOString(), created_at: createdAt.toISOString(), items,
      });
    }
  }
  orders.sort((a, b) => b.created_at.localeCompare(a.created_at));
  [[1, 20, 8], [15, 30, 2], [6, 240, 5], [12, 144, 3], [9, 24, 1]].forEach(([productId, quantity, daysAgo]) => {
    const product = products.find((p) => p.id === productId);
    inventoryLogs.push({ id: inventoryLogs.length + 1, product_id: product.id, product_name: product.name, store_id: 1, user_id: 1, user_name: 'Amaka Obi', type: 'in', quantity, reason: 'Restock from Lagos Wholesale Ltd', created_at: new Date(Date.now() - daysAgo * 86400000).toISOString() });
  });
}
seedDemoSales();

function broadcast(event, data) {
  const message = JSON.stringify({ event, data });
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) client.send(message);
  });
}

function generateOrderNumber() {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `ORD-${ts}-${rand}`;
}

// ===== Auth middleware =====
function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'Auth required' });
  try {
    const decoded = jwt.verify(header.split(' ')[1], JWT_SECRET);
    req.user = users.find(u => u.id === decoded.userId);
    if (!req.user) return res.status(401).json({ error: 'User not found' });
    next();
  } catch { return res.status(401).json({ error: 'Invalid token' }); }
}

// ===== Auth Routes =====
app.post('/api/v1/auth/login', (req, res) => {
  const { email, password } = req.body;
  const user = users.find(u => u.email === email && u.password === password);
  if (!user) return res.status(401).json({ error: 'Invalid email or password' });

  const accessToken = jwt.sign({ userId: user.id, role: user.role, storeId: 1 }, JWT_SECRET, { expiresIn: '24h' });
  const refreshToken = 'mock-refresh-' + Date.now();

  res.json({
    accessToken,
    refreshToken,
    user: { id: user.id, email: user.email, name: user.name, role: user.role, storeId: 1 },
    subscription: mockSubscription,
  });
});

app.post('/api/v1/auth/register', (req, res) => {
  const {
    name,
    email,
    password,
    store_name: storeName,
    terms_accepted: termsAccepted,
    privacy_acknowledged: privacyAcknowledged,
  } = req.body;
  if (termsAccepted !== true || privacyAcknowledged !== true) {
    return res.status(400).json({ error: 'Accept the Terms of Service and acknowledge the Privacy Policy' });
  }
  if (users.find(u => u.email === email)) return res.status(409).json({ error: 'Email already registered' });
  const newUser = { id: users.length + 1, store_id: 1, role_id: 1, email, password, name, role: 'admin', is_active: true, created_at: new Date().toISOString() };
  users.push(newUser);
  store.name = storeName || store.name;
  res.status(201).json({
    message: 'Store and owner account created successfully',
    user: { id: newUser.id, email, name, role: 'admin' },
    store,
    subscription: mockSubscription,
  });
});

app.post('/api/v1/auth/refresh', (req, res) => {
  const accessToken = jwt.sign({ userId: 1, role: 'admin', storeId: 1 }, JWT_SECRET, { expiresIn: '24h' });
  res.json({ accessToken, subscription: mockSubscription });
});

app.post('/api/v1/auth/logout', (req, res) => res.json({ message: 'Logged out' }));
app.get('/api/v1/auth/me', auth, (req, res) => res.json({ user: req.user, subscription: mockSubscription }));

// ===== Products =====
app.get('/api/v1/products', auth, (req, res) => {
  let result = [...products];
  const { search, category_id } = req.query;
  if (search) {
    const s = search.toLowerCase();
    result = result.filter(p => p.name.toLowerCase().includes(s) || p.sku?.toLowerCase().includes(s) || p.barcode?.includes(s));
  }
  if (category_id) result = result.filter(p => p.category_id == category_id);
  res.json({ products: result, total: result.length, page: 1, limit: 100 });
});

app.get('/api/v1/products/low-stock', auth, (req, res) => {
  const lowStock = products.filter(p => p.stock_quantity <= p.low_stock_threshold && p.is_active);
  res.json({ products: lowStock });
});

app.get('/api/v1/products/:id', auth, (req, res) => {
  const product = products.find(p => p.id == req.params.id);
  if (!product) return res.status(404).json({ error: 'Product not found' });
  res.json({ product });
});

app.post('/api/v1/products', auth, (req, res) => {
  const cat = categories.find(c => c.id == req.body.category_id);
  const product = { id: productIdCounter++, store_id: 1, ...req.body, category_name: cat?.name || null, is_active: true, created_at: new Date().toISOString() };
  products.push(product);
  res.status(201).json({ product });
});

app.patch('/api/v1/products/:id', auth, (req, res) => {
  const product = products.find(p => p.id == req.params.id);
  if (!product) return res.status(404).json({ error: 'Product not found' });
  Object.assign(product, req.body);
  if (req.body.category_id) { const cat = categories.find(c => c.id == req.body.category_id); product.category_name = cat?.name || null; }
  res.json({ product });
});

app.delete('/api/v1/products/:id', auth, (req, res) => {
  const idx = products.findIndex(p => p.id == req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Product not found' });
  products.splice(idx, 1);
  res.json({ message: 'Product deleted' });
});

// ===== Categories =====
app.get('/api/v1/categories', auth, (req, res) => res.json({ categories }));
app.post('/api/v1/categories', auth, (req, res) => {
  const cat = { id: categories.length + 1, store_id: 1, ...req.body, created_at: new Date().toISOString() };
  categories.push(cat);
  res.status(201).json({ category: cat });
});

// ===== Orders =====
app.post('/api/v1/orders', auth, (req, res) => {
  const {
    items,
    payment_method = 'cash',
    payment_reference,
    customer_id,
    discount_amount = 0,
    client_order_id,
  } = req.body;
  if (!items?.length) return res.status(400).json({ error: 'Order must have items' });
  if (!['cash', 'card', 'transfer'].includes(payment_method)) {
    return res.status(400).json({ error: 'Unsupported payment method' });
  }
  if (payment_method !== 'cash' && !payment_reference?.trim()) {
    return res.status(400).json({ error: 'A payment reference is required for card and transfer sales' });
  }
  const existingOrder = client_order_id
    ? orders.find((order) => order.client_order_id === client_order_id)
    : null;
  if (existingOrder) return res.json({ order: existingOrder, idempotent: true });

  let subtotal = 0;
  const orderItems = [];

  for (const item of items) {
    const product = products.find(p => p.id === item.product_id);
    if (!product) return res.status(400).json({ error: `Product ${item.product_id} not found` });
    if (product.stock_quantity < item.quantity) return res.status(400).json({ error: `Insufficient stock for ${product.name}` });

    const itemTotal = parseFloat(product.price) * item.quantity;
    subtotal += itemTotal;
    orderItems.push({ id: orderIdCounter * 100 + orderItems.length, product_id: product.id, product_name: product.name, quantity: item.quantity, unit_price: product.price, discount: '0.00', total: itemTotal.toFixed(2) });
    product.stock_quantity -= item.quantity;
    inventoryLogs.push({ id: inventoryLogs.length + 1, product_id: product.id, product_name: product.name, store_id: 1, user_id: 1, user_name: req.user.name, type: 'out', quantity: item.quantity, reason: 'Sale', created_at: new Date().toISOString() });
  }

  const taxAmount = subtotal * 0.075;
  const total = subtotal + taxAmount - discount_amount;
  const orderNumber = generateOrderNumber();

  const order = {
    id: orderIdCounter++, store_id: 1, user_id: req.user.id, customer_id: customer_id || null,
    order_number: orderNumber, subtotal: subtotal.toFixed(2), tax_amount: taxAmount.toFixed(2),
    discount_amount: discount_amount.toFixed(2), total: total.toFixed(2), status: 'completed',
    payment_method, payment_reference: payment_reference || null, client_order_id: client_order_id || null,
    cashier_name: req.user.name,
    customer_name: customers.find(c => c.id == customer_id)?.name || null,
    paid_at: new Date().toISOString(), created_at: new Date().toISOString(), items: orderItems,
  };

  orders.unshift(order);
  broadcast('NEW_ORDER', { order_number: order.order_number, total: order.total, cashier_id: req.user.id });
  res.status(201).json({ order });
});

app.get('/api/v1/orders', auth, (req, res) => {
  let result = [...orders];
  if (req.query.status) result = result.filter(o => o.status === req.query.status);
  res.json({ orders: result, total: result.length, page: 1 });
});

app.get('/api/v1/orders/:id', auth, (req, res) => {
  const order = orders.find(o => o.id == req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  res.json({ order });
});

app.post('/api/v1/orders/:id/refund', auth, (req, res) => {
  const order = orders.find(o => o.id == req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (order.status === 'refunded') return res.status(409).json({ error: 'This sale has already been refunded' });
  const reason = String(req.body?.reason || '').trim();
  if (reason.length < 3) return res.status(400).json({ error: 'Give a short reason for the refund' });
  const restock = req.body?.restock !== false;
  if (restock) {
    for (const item of order.items || []) {
      const product = products.find(p => p.id === item.product_id);
      if (!product) continue;
      product.stock_quantity += item.quantity;
      inventoryLogs.unshift({ id: inventoryLogs.length + 1, product_id: product.id, product_name: product.name, store_id: 1, user_id: req.user.id, user_name: req.user.name, type: 'in', quantity: item.quantity, reason: `Refund ${order.order_number}`, created_at: new Date().toISOString() });
    }
  }
  order.status = 'refunded';
  res.json({ order, refund: { amount: Number(order.total), reason, restocked: restock } });
});

// ===== Customers =====
function customerStats(customerId) {
  const completed = orders.filter(o => o.customer_id == customerId && o.status === 'completed');
  return {
    order_count: completed.length,
    total_spent: completed.reduce((sum, o) => sum + Number(o.total), 0).toFixed(2),
    last_visit: completed[0]?.created_at || null,
    first_visit: completed[completed.length - 1]?.created_at || null,
  };
}

app.get('/api/v1/customers', auth, (req, res) => {
  let result = customers.map(c => ({ ...c, ...customerStats(c.id) }));
  if (req.query.search) {
    const s = req.query.search.toLowerCase();
    result = result.filter(c => c.name.toLowerCase().includes(s) || c.email?.toLowerCase().includes(s) || c.phone?.includes(s));
  }
  if (req.query.sort === 'spent') result.sort((a, b) => Number(b.total_spent) - Number(a.total_spent));
  else if (req.query.sort === 'recent') result.sort((a, b) => String(b.last_visit || '').localeCompare(String(a.last_visit || '')));
  else result.sort((a, b) => a.name.localeCompare(b.name));
  res.json({ customers: result, total: result.length });
});

app.patch('/api/v1/customers/:id', auth, (req, res) => {
  const customer = customers.find(c => c.id == req.params.id);
  if (!customer) return res.status(404).json({ error: 'Customer not found' });
  Object.assign(customer, req.body, { updated_at: new Date().toISOString() });
  res.json({ customer });
});

app.get('/api/v1/customers/:id', auth, (req, res) => {
  const customer = customers.find(c => c.id == req.params.id);
  if (!customer) return res.status(404).json({ error: 'Customer not found' });
  const history = orders.filter(o => o.customer_id == customer.id);
  const favourites = new Map();
  history.filter(o => o.status === 'completed').forEach(o => (o.items || []).forEach(item => {
    const row = favourites.get(item.product_name) || { product_name: item.product_name, quantity: 0, revenue: 0 };
    row.quantity += item.quantity;
    row.revenue += Number(item.total);
    favourites.set(item.product_name, row);
  }));
  res.json({
    customer,
    orders: history.slice(0, 20),
    stats: customerStats(customer.id),
    favourite_products: [...favourites.values()].sort((a, b) => b.quantity - a.quantity).slice(0, 5),
  });
});

app.post('/api/v1/customers', auth, (req, res) => {
  const customer = { id: customers.length + 1, store_id: 1, loyalty_points: 0, ...req.body, created_at: new Date().toISOString() };
  customers.push(customer);
  res.status(201).json({ customer });
});

app.delete('/api/v1/customers/:id', auth, (req, res) => {
  const idx = customers.findIndex(c => c.id == req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Customer not found' });
  customers.splice(idx, 1);
  res.json({ message: 'Customer deleted' });
});

// ===== Inventory =====
app.get('/api/v1/inventory/logs', auth, (req, res) => res.json({ logs: inventoryLogs.slice(0, 20) }));
app.post('/api/v1/inventory/adjust', auth, (req, res) => {
  const { product_id, type, quantity, reason } = req.body;
  const product = products.find(p => p.id === product_id);
  if (!product) return res.status(404).json({ error: 'Product not found' });
  if (type === 'out') product.stock_quantity -= quantity; else product.stock_quantity += quantity;
  const log = { id: inventoryLogs.length + 1, product_id, product_name: product.name, store_id: 1, user_id: 1, user_name: 'Admin User', type, quantity, reason: reason || '', created_at: new Date().toISOString() };
  inventoryLogs.unshift(log);
  res.status(201).json({ log });
});

app.get('/api/v1/inventory/suppliers', auth, (req, res) => res.json({ suppliers }));
app.post('/api/v1/inventory/suppliers', auth, (req, res) => {
  const supplier = { id: suppliers.length + 1, store_id: 1, ...req.body, created_at: new Date().toISOString() };
  suppliers.push(supplier);
  res.status(201).json({ supplier });
});

app.patch('/api/v1/inventory/suppliers/:id', auth, (req, res) => {
  const supplier = suppliers.find(s => s.id == req.params.id);
  if (!supplier) return res.status(404).json({ error: 'Supplier not found' });
  Object.assign(supplier, req.body, { updated_at: new Date().toISOString() });
  res.json({ supplier });
});

app.delete('/api/v1/inventory/suppliers/:id', auth, (req, res) => {
  const index = suppliers.findIndex(s => s.id == req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Supplier not found' });
  suppliers.splice(index, 1);
  res.json({ message: 'Supplier deleted' });
});

app.get('/api/v1/inventory/purchase-orders', auth, (req, res) => res.json({ purchaseOrders: [] }));

// ===== Reports =====
app.get('/api/v1/reports/insights', auth, (req, res) => {
  const result = computeInsightsFromOrders({ orders, products, start: req.query.start, end: req.query.end });
  if (!result) return res.status(400).json({ error: 'Choose a start and end date (YYYY-MM-DD), with the end on or after the start' });
  res.json(result);
});

app.get('/api/v1/reports/revenue', auth, (req, res) => {
  const completed = orders.filter((o) => o.status === 'completed');
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfWeek = new Date(startOfDay);
  startOfWeek.setDate(startOfDay.getDate() - ((startOfDay.getDay() + 6) % 7));
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const since = (from) => {
    const list = completed.filter((o) => new Date(o.created_at) >= from);
    return { revenue: list.reduce((sum, o) => sum + parseFloat(o.total), 0).toFixed(2), orders: list.length };
  };
  res.json({
    today: since(startOfDay),
    thisWeek: since(startOfWeek),
    thisMonth: since(startOfMonth),
    allTime: since(new Date(0)),
  });
});

app.get('/api/v1/reports/recent-orders', auth, (req, res) => {
  res.json({ orders: orders.slice(0, 10).map(o => ({ id: o.id, order_number: o.order_number, total: o.total, payment_method: o.payment_method, created_at: o.created_at, cashier: o.cashier_name })) });
});

app.get('/api/v1/reports/top-products', auth, (req, res) => {
  const productSales = {};
  for (const order of orders) {
    if (order.status !== 'completed') continue;
    for (const item of (order.items || [])) {
      if (!productSales[item.product_name]) productSales[item.product_name] = { product_name: item.product_name, total_quantity: 0, total_revenue: 0 };
      productSales[item.product_name].total_quantity += item.quantity;
      productSales[item.product_name].total_revenue += parseFloat(item.total);
    }
  }
  const sorted = Object.values(productSales).sort((a, b) => b.total_quantity - a.total_quantity).slice(0, parseInt(req.query.limit) || 10);
  sorted.forEach(p => p.total_revenue = p.total_revenue.toFixed(2));
  res.json({ products: sorted });
});

app.get('/api/v1/reports/sales', auth, (req, res) => {
  // Daily totals, newest first, like the real report.
  const dayKey = (value) => {
    const date = new Date(value);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  };
  const end = req.query.end || dayKey(new Date());
  const start = req.query.start || dayKey(new Date(Date.now() - 29 * 86400000));
  const days = new Map();
  for (const order of orders) {
    if (order.status !== 'completed') continue;
    const key = dayKey(order.created_at);
    if (key < start || key > end) continue;
    const day = days.get(key) || { period: key, total_orders: 0, revenue: 0, total_discounts: 0, total_tax: 0 };
    day.total_orders += 1;
    day.revenue += parseFloat(order.total);
    day.total_discounts += parseFloat(order.discount_amount || 0);
    day.total_tax += parseFloat(order.tax_amount || 0);
    days.set(key, day);
  }
  res.json({
    sales: [...days.values()].sort((a, b) => b.period.localeCompare(a.period)).slice(0, 30).map((day) => ({
      period: day.period,
      total_orders: day.total_orders,
      revenue: day.revenue.toFixed(2),
      total_discounts: day.total_discounts.toFixed(2),
      total_tax: day.total_tax.toFixed(2),
      avg_order_value: (day.revenue / day.total_orders).toFixed(2),
    })),
  });
});

// ===== Settings =====
app.get('/api/v1/settings/store', auth, (req, res) => {
  if (!['admin', 'manager'].includes(req.user.role)) return res.status(403).json({ error: 'Access denied' });
  res.json({ store });
});
app.patch('/api/v1/settings/store', auth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only admins can modify store settings' });
  Object.assign(store, req.body);
  res.json({ store });
});

app.get('/api/v1/settings/users', auth, (req, res) => {
  if (!['admin', 'manager'].includes(req.user.role)) return res.status(403).json({ error: 'Access denied' });
  // Managers can only see cashiers + themselves; admins see all
  let visibleUsers = users;
  if (req.user.role === 'manager') {
    visibleUsers = users.filter(u => u.role === 'cashier' || u.id === req.user.id);
  }
  res.json({
    users: visibleUsers.map(u => ({
      id: u.id, email: u.email, name: u.name, role: u.role,
      is_active: u.is_active, last_login: u.last_login,
      created_by: u.created_by || null, created_at: u.created_at,
    })),
  });
});

// Create new staff member
app.post('/api/v1/settings/users', auth, (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password || !role) return res.status(400).json({ error: 'Name, email, password, and role are required' });

  // Permission checks
  if (req.user.role === 'cashier') return res.status(403).json({ error: 'Cashiers cannot create staff' });
  if (req.user.role === 'manager' && role !== 'cashier') return res.status(403).json({ error: 'Managers can only create cashier accounts' });
  if (role === 'admin' && req.user.role !== 'admin') return res.status(403).json({ error: 'Only admins can create admin accounts' });

  if (users.find(u => u.email === email)) return res.status(409).json({ error: 'Email already in use' });

  const newUser = {
    id: users.length + 1,
    store_id: 1,
    role_id: role === 'admin' ? 1 : role === 'manager' ? 2 : 3,
    email, password, name, role,
    is_active: true,
    created_by: req.user.name,
    last_login: null,
    created_at: new Date().toISOString(),
  };
  users.push(newUser);
  res.status(201).json({
    user: { id: newUser.id, email: newUser.email, name: newUser.name, role: newUser.role, is_active: true, created_by: req.user.name },
  });
});

app.patch('/api/v1/settings/users/:id', auth, (req, res) => {
  const user = users.find(u => u.id == req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  // Permission checks
  if (req.user.role === 'cashier') return res.status(403).json({ error: 'Access denied' });
  if (req.user.role === 'manager') {
    if (user.role !== 'cashier') return res.status(403).json({ error: 'Managers can only modify cashier accounts' });
    if (req.body.role && req.body.role !== 'cashier') return res.status(403).json({ error: 'Managers cannot promote users beyond cashier' });
  }
  if (user.role === 'admin' && req.user.role !== 'admin') return res.status(403).json({ error: 'Only admins can modify admin accounts' });

  if (req.body.role) user.role = req.body.role;
  if (req.body.is_active !== undefined) user.is_active = req.body.is_active;
  if (req.body.name) user.name = req.body.name;
  if (req.body.email) {
    // Check if email is already taken by another user
    const emailTaken = users.find(u => u.email === req.body.email && u.id !== user.id);
    if (emailTaken) return res.status(409).json({ error: 'Email already in use by another user' });
    user.email = req.body.email;
  }
  if (req.body.password) user.password = req.body.password;
  res.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role, is_active: user.is_active } });
});

app.delete('/api/v1/settings/users/:id', auth, (req, res) => {
  if (req.user.role === 'cashier') return res.status(403).json({ error: 'Access denied' });
  const idx = users.findIndex(u => u.id == req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'User not found' });
  const target = users[idx];
  if (target.role === 'admin' && req.user.role !== 'admin') return res.status(403).json({ error: 'Only admins can delete admin accounts' });
  if (target.id === req.user.id) return res.status(400).json({ error: 'Cannot delete your own account' });
  if (req.user.role === 'manager' && target.role !== 'cashier') return res.status(403).json({ error: 'Managers can only delete cashier accounts' });
  users.splice(idx, 1);
  res.json({ message: 'User deleted' });
});

// ===== Permissions endpoint (returns what the current user can do) =====
app.get('/api/v1/auth/permissions', auth, (req, res) => {
  const role = req.user.role;
  const permissions = {
    admin: {
      dashboard: true, pos: true, products: { view: true, create: true, edit: true, delete: true },
      inventory: { view: true, adjust: true, suppliers: true }, orders: { view: true, viewAll: true, refund: true },
      customers: { view: true, create: true, edit: true, delete: true },
      reports: { view: true, export: true }, settings: { store: true, staff: true },
      staff: { view: true, create: ['admin', 'manager', 'cashier'], editRoles: true, delete: true },
    },
    manager: {
      dashboard: true, pos: true, products: { view: true, create: true, edit: true, delete: true },
      inventory: { view: true, adjust: true, suppliers: true }, orders: { view: true, viewAll: true, refund: false },
      customers: { view: true, create: true, edit: true, delete: false },
      reports: { view: true, export: false }, settings: { store: false, staff: true },
      staff: { view: true, create: ['cashier'], editRoles: false, delete: true },
    },
    cashier: {
      dashboard: true, pos: true, products: { view: true, create: false, edit: false, delete: false },
      inventory: { view: false, adjust: false, suppliers: false }, orders: { view: true, viewAll: false, refund: false },
      customers: { view: true, create: true, edit: false, delete: false },
      reports: { view: false, export: false }, settings: { store: false, staff: false },
      staff: { view: false, create: [], editRoles: false, delete: false },
    },
  };
  res.json({ role, permissions: permissions[role] || permissions.cashier });
});

// ===== Barcode Lookup (Online Product Database) =====
app.get('/api/v1/products/lookup/:barcode', auth, async (req, res) => {
  const { barcode } = req.params;

  try {
    // Try Open Food Facts first (free, no API key needed)
    const offResponse = await fetch(`https://world.openfoodfacts.org/api/v0/product/${barcode}.json`);
    const offData = await offResponse.json();

    if (offData.status === 1 && offData.product) {
      const p = offData.product;
      return res.json({
        found: true,
        source: 'Open Food Facts',
        product: {
          name: p.product_name || p.product_name_en || '',
          description: p.generic_name || p.generic_name_en || '',
          brand: p.brands || '',
          category: p.categories?.split(',')[0]?.trim() || '',
          barcode: barcode,
          image_url: p.image_front_small_url || p.image_url || '',
          quantity_info: p.quantity || '',
          ingredients: p.ingredients_text_en || p.ingredients_text || '',
        },
      });
    }

    // Try UPC Item DB as fallback (free tier)
    try {
      const upcResponse = await fetch(`https://api.upcitemdb.com/prod/trial/lookup?upc=${barcode}`);
      const upcData = await upcResponse.json();

      if (upcData.items && upcData.items.length > 0) {
        const item = upcData.items[0];
        return res.json({
          found: true,
          source: 'UPC Item DB',
          product: {
            name: item.title || '',
            description: item.description || '',
            brand: item.brand || '',
            category: item.category || '',
            barcode: barcode,
            image_url: item.images?.[0] || '',
            quantity_info: item.size || '',
            ingredients: '',
          },
        });
      }
    } catch {
      // UPC Item DB failed, ignore
    }

    // Not found in any database
    res.json({
      found: false,
      source: null,
      product: null,
      message: `Product not found for barcode: ${barcode}. You can still add it manually.`,
    });
  } catch (err) {
    console.error('Barcode lookup error:', err.message);
    res.json({
      found: false,
      source: null,
      product: null,
      message: 'Lookup service unavailable. Please enter product details manually.',
    });
  }
});

// ===== Offline Sync Bootstrap =====
app.get('/api/v1/sync/bootstrap', auth, (req, res) => {
  const canManage = ['admin', 'manager'].includes(req.user.role);
  res.json({
    snapshot: {
      store,
      products,
      categories,
      customers,
      suppliers,
      orders: canManage ? orders.slice(0, 500) : [],
      logs: canManage ? inventoryLogs.slice(0, 500) : [],
      users: canManage
        ? users.map(({ password: _password, ...user }) => user)
        : [],
    },
    synced_at: new Date().toISOString(),
  });
});

// ===== Health =====
registerMockAdminTools(app, auth);
registerMockPlatform(app, auth);
registerMockSupport(app, auth);

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// ===== Start (local dev) =====
if (process.env.VERCEL !== '1') {
  server.listen(PORT, () => {
    console.log(`\n  ⚡ QuickPOS Mock Server running on http://localhost:${PORT}`);
    console.log(`  📦 ${products.length} products loaded`);
    console.log('  Create an owner account in the app, or set private SEED_ADMIN_* values.\\n');
  });
}

// Export for Vercel serverless
export default app;
