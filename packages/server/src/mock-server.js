// Lightweight mock API server for demo (no database required)
// Run with: node packages/server/src/mock-server.js

import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import { createServer } from 'http';

const app = express();
const server = createServer(app);
const PORT = 3001;
const JWT_SECRET = 'demo-secret';

app.use(cors({ origin: 'http://localhost:5173', credentials: true }));
app.use(express.json());

// ===== In-memory data =====
const store = { id: 1, name: 'QuickPOS Demo Store', address: '123 Main Street, Lagos', phone: '+234 800 000 0000', email: 'store@posapp.com', tax_rate: '7.50', currency: 'NGN', receipt_header: 'Thank you for shopping!', receipt_footer: 'Visit again soon!' };

const roles = [
  { id: 1, name: 'admin' },
  { id: 2, name: 'manager' },
  { id: 3, name: 'cashier' },
];

const users = [
  { id: 1, store_id: 1, role_id: 1, email: 'admin@posapp.com', password: 'admin123', name: 'Admin User', role: 'admin', is_active: true, last_login: new Date().toISOString(), created_at: new Date().toISOString() },
];

const categories = [
  { id: 1, store_id: 1, name: 'Beverages', description: 'Drinks and beverages', created_at: new Date().toISOString() },
  { id: 2, store_id: 1, name: 'Snacks', description: 'Quick bites and snacks', created_at: new Date().toISOString() },
  { id: 3, store_id: 1, name: 'Electronics', description: 'Gadgets and accessories', created_at: new Date().toISOString() },
  { id: 4, store_id: 1, name: 'Groceries', description: 'Daily grocery items', created_at: new Date().toISOString() },
  { id: 5, store_id: 1, name: 'Stationery', description: 'Office supplies', created_at: new Date().toISOString() },
];

let productIdCounter = 11;
const products = [
  { id: 1, store_id: 1, category_id: 1, name: 'Coca-Cola 50cl', description: 'Chilled Coca-Cola', sku: 'BEV-001', barcode: '5449000000996', price: '350.00', cost_price: '250.00', stock_quantity: 100, low_stock_threshold: 20, is_active: true, category_name: 'Beverages', image_url: '/products/coca-cola.png', created_at: new Date().toISOString() },
  { id: 2, store_id: 1, category_id: 1, name: 'Fanta Orange 50cl', description: 'Chilled Fanta Orange', sku: 'BEV-002', barcode: '5449000000997', price: '350.00', cost_price: '250.00', stock_quantity: 80, low_stock_threshold: 20, is_active: true, category_name: 'Beverages', image_url: '/products/fanta-orange.png', created_at: new Date().toISOString() },
  { id: 3, store_id: 1, category_id: 1, name: 'Water 75cl', description: 'Eva table water', sku: 'BEV-003', barcode: '5449000000998', price: '200.00', cost_price: '120.00', stock_quantity: 150, low_stock_threshold: 30, is_active: true, category_name: 'Beverages', image_url: '/products/water.png', created_at: new Date().toISOString() },
  { id: 4, store_id: 1, category_id: 2, name: 'Chin Chin (Medium)', description: 'Crunchy chin chin snack', sku: 'SNK-001', barcode: '1234567890001', price: '500.00', cost_price: '300.00', stock_quantity: 50, low_stock_threshold: 15, is_active: true, category_name: 'Snacks', image_url: '/products/chin-chin.png', created_at: new Date().toISOString() },
  { id: 5, store_id: 1, category_id: 2, name: 'Plantain Chips', description: 'Crispy plantain chips', sku: 'SNK-002', barcode: '1234567890002', price: '400.00', cost_price: '220.00', stock_quantity: 60, low_stock_threshold: 15, is_active: true, category_name: 'Snacks', image_url: '/products/plantain-chips.png', created_at: new Date().toISOString() },
  { id: 6, store_id: 1, category_id: 3, name: 'USB Cable Type-C', description: 'Fast charging cable', sku: 'ELC-001', barcode: '2345678901234', price: '2500.00', cost_price: '1200.00', stock_quantity: 30, low_stock_threshold: 10, is_active: true, category_name: 'Electronics', image_url: '/products/usb-cable.png', created_at: new Date().toISOString() },
  { id: 7, store_id: 1, category_id: 3, name: 'Earphones', description: 'In-ear wired earphones', sku: 'ELC-002', barcode: '2345678901235', price: '3500.00', cost_price: '1800.00', stock_quantity: 25, low_stock_threshold: 10, is_active: true, category_name: 'Electronics', image_url: '/products/earphones.png', created_at: new Date().toISOString() },
  { id: 8, store_id: 1, category_id: 4, name: 'Rice (5kg)', description: 'Long grain rice', sku: 'GRC-001', barcode: '3456789012345', price: '8500.00', cost_price: '6500.00', stock_quantity: 40, low_stock_threshold: 10, is_active: true, category_name: 'Groceries', image_url: '/products/rice.png', created_at: new Date().toISOString() },
  { id: 9, store_id: 1, category_id: 4, name: 'Cooking Oil (1L)', description: 'Vegetable cooking oil', sku: 'GRC-002', barcode: '3456789012346', price: '3200.00', cost_price: '2300.00', stock_quantity: 35, low_stock_threshold: 10, is_active: true, category_name: 'Groceries', image_url: '/products/cooking-oil.png', created_at: new Date().toISOString() },
  { id: 10, store_id: 1, category_id: 5, name: 'Notebook A5', description: 'Ruled exercise notebook', sku: 'STN-001', barcode: '4567890123456', price: '300.00', cost_price: '150.00', stock_quantity: 8, low_stock_threshold: 25, is_active: true, category_name: 'Stationery', image_url: '/products/notebook.png', created_at: new Date().toISOString() },
];

const customers = [
  { id: 1, store_id: 1, name: 'Adebayo Johnson', email: 'adebayo@email.com', phone: '+234 801 234 5678', loyalty_points: 120, created_at: new Date().toISOString() },
  { id: 2, store_id: 1, name: 'Chioma Okafor', email: 'chioma@email.com', phone: '+234 802 345 6789', loyalty_points: 85, created_at: new Date().toISOString() },
  { id: 3, store_id: 1, name: 'Emeka Eze', email: 'emeka@email.com', phone: '+234 803 456 7890', loyalty_points: 45, created_at: new Date().toISOString() },
];

const suppliers = [
  { id: 1, store_id: 1, name: 'Lagos Wholesale Ltd', contact_name: 'Mr. Okonkwo', email: 'wholesale@lagos.com', phone: '+234 800 111 2222', created_at: new Date().toISOString() },
  { id: 2, store_id: 1, name: 'Tech Imports Nigeria', contact_name: 'Mrs. Adeyemi', email: 'tech@imports.ng', phone: '+234 800 333 4444', created_at: new Date().toISOString() },
];

let orderIdCounter = 1;
const orders = [];
const inventoryLogs = [];

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
    req.user = users.find(u => u.id === decoded.userId) || { id: 1, store_id: 1, role: 'admin', name: 'Admin User' };
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
  });
});

app.post('/api/v1/auth/register', (req, res) => {
  const { name, email, password } = req.body;
  if (users.find(u => u.email === email)) return res.status(409).json({ error: 'Email already registered' });
  const newUser = { id: users.length + 1, store_id: 1, role_id: 3, email, password, name, role: 'cashier', is_active: true, created_at: new Date().toISOString() };
  users.push(newUser);
  res.status(201).json({ message: 'User registered successfully', user: { id: newUser.id, email, name } });
});

app.post('/api/v1/auth/refresh', (req, res) => {
  const accessToken = jwt.sign({ userId: 1, role: 'admin', storeId: 1 }, JWT_SECRET, { expiresIn: '24h' });
  res.json({ accessToken });
});

app.post('/api/v1/auth/logout', (req, res) => res.json({ message: 'Logged out' }));
app.get('/api/v1/auth/me', auth, (req, res) => res.json({ user: req.user }));

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
  const { items, payment_method, customer_id, discount_amount = 0 } = req.body;
  if (!items?.length) return res.status(400).json({ error: 'Order must have items' });

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
    payment_method: payment_method || 'cash', cashier_name: req.user.name,
    customer_name: customers.find(c => c.id == customer_id)?.name || null,
    paid_at: new Date().toISOString(), created_at: new Date().toISOString(), items: orderItems,
  };

  orders.unshift(order);
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

// ===== Customers =====
app.get('/api/v1/customers', auth, (req, res) => {
  let result = [...customers];
  if (req.query.search) {
    const s = req.query.search.toLowerCase();
    result = result.filter(c => c.name.toLowerCase().includes(s) || c.email?.toLowerCase().includes(s));
  }
  res.json({ customers: result, total: result.length });
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

app.get('/api/v1/inventory/purchase-orders', auth, (req, res) => res.json({ purchaseOrders: [] }));

// ===== Reports =====
app.get('/api/v1/reports/revenue', auth, (req, res) => {
  const todayOrders = orders.filter(o => o.status === 'completed');
  const totalRevenue = todayOrders.reduce((s, o) => s + parseFloat(o.total), 0);
  res.json({
    today: { revenue: totalRevenue.toFixed(2), orders: todayOrders.length },
    thisWeek: { revenue: totalRevenue.toFixed(2), orders: todayOrders.length },
    thisMonth: { revenue: totalRevenue.toFixed(2), orders: todayOrders.length },
    allTime: { revenue: totalRevenue.toFixed(2), orders: todayOrders.length },
  });
});

app.get('/api/v1/reports/recent-orders', auth, (req, res) => {
  res.json({ orders: orders.slice(0, 10).map(o => ({ id: o.id, order_number: o.order_number, total: o.total, payment_method: o.payment_method, created_at: o.created_at, cashier: o.cashier_name })) });
});

app.get('/api/v1/reports/top-products', auth, (req, res) => {
  const productSales = {};
  for (const order of orders) {
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
  if (orders.length === 0) return res.json({ sales: [] });
  const totalRevenue = orders.reduce((s, o) => s + parseFloat(o.total), 0);
  res.json({ sales: [{ period: new Date().toISOString().slice(0, 10), total_orders: orders.length, revenue: totalRevenue.toFixed(2), total_discounts: '0.00', total_tax: '0.00', avg_order_value: (totalRevenue / orders.length).toFixed(2) }] });
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

// ===== Health =====
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// ===== Start =====
server.listen(PORT, () => {
  console.log(`\n  ⚡ QuickPOS Mock Server running on http://localhost:${PORT}`);
  console.log(`  📦 ${products.length} products loaded`);
  console.log(`  👤 Login: admin@posapp.com / admin123\n`);
});
