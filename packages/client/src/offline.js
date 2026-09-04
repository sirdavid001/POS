const CACHE_ROOT = 'quickpos_cache:';
const SNAPSHOT_ROOT = 'quickpos_snapshot:';
const QUEUE_ROOT = 'quickpos_offline_queue:';
const LEGACY_QUEUE_KEY = 'quickpos_offline_queue';
const LEGACY_ORDER_QUEUE_KEY = 'quickpos_offline_orders';
const LAST_SYNC_ROOT = 'quickpos_last_sync:';

const CACHEABLE_GET_PREFIXES = [
  '/categories',
  '/customers',
  '/inventory/logs',
  '/inventory/suppliers',
  '/orders',
  '/products',
  '/reports',
  '/settings/store',
  '/settings/users',
];

const SNAPSHOT_LISTS = ['products', 'categories', 'customers', 'suppliers', 'orders', 'logs', 'users'];

function currentScope() {
  const user = storageGet('user', {});
  const storeId = user.storeId || user.store_id || 'unassigned';
  return `store-${storeId}-user-${user.id || 'unassigned'}`;
}

function cachePrefix() {
  return `${CACHE_ROOT}${currentScope()}:`;
}

function queueKey() {
  return `${QUEUE_ROOT}${currentScope()}`;
}

function snapshotKey(resource) {
  return `${SNAPSHOT_ROOT}${currentScope()}:${resource}`;
}

function lastSyncKey() {
  return `${LAST_SYNC_ROOT}${currentScope()}`;
}

const QUEUEABLE_WRITE_PREFIXES = [
  '/categories',
  '/customers',
  '/inventory/adjust',
  '/inventory/suppliers',
  '/orders',
  '/products',
  '/settings/store',
];

function storageGet(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function storageSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    window.dispatchEvent(new CustomEvent('offline-storage-error', {
      detail: { message: 'Device storage is full. Sync or free storage before making more offline changes.' },
    }));
    return false;
  }
}

function cacheKey(path) {
  return `${cachePrefix()}${path}`;
}

function nowIso() {
  return new Date().toISOString();
}

function tempId() {
  return `offline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function pathMatches(path, prefixes) {
  return prefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}?`));
}

function ensureScopedMigration() {
  const marker = `quickpos_offline_migrated:${currentScope()}`;
  if (localStorage.getItem(marker) === 'true') return;

  const legacyQueue = storageGet(LEGACY_QUEUE_KEY, []);
  if (legacyQueue.length && !storageGet(queueKey(), []).length) {
    storageSet(queueKey(), legacyQueue);
  }

  const legacyCacheKeys = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (key?.startsWith(CACHE_ROOT) && key.slice(CACHE_ROOT.length).startsWith('/')) {
      legacyCacheKeys.push(key);
    }
  }
  legacyCacheKeys.forEach((key) => {
    const path = key.slice(CACHE_ROOT.length);
    if (!localStorage.getItem(cacheKey(path))) localStorage.setItem(cacheKey(path), localStorage.getItem(key));
    localStorage.removeItem(key);
  });
  localStorage.removeItem(LEGACY_QUEUE_KEY);
  localStorage.setItem(marker, 'true');
}

function readSnapshot(resource, fallback = resource === 'store' ? null : []) {
  return storageGet(snapshotKey(resource), fallback);
}

function writeSnapshot(resource, value) {
  storageSet(snapshotKey(resource), value);
}

function mergeEntities(existing = [], incoming = []) {
  const merged = new Map(existing.map((item) => [String(item.id), item]));
  incoming.forEach((item) => {
    if (item?.id == null) return;
    merged.set(String(item.id), { ...merged.get(String(item.id)), ...item });
  });
  return [...merged.values()];
}

function mergeSnapshotResponse(data) {
  SNAPSHOT_LISTS.forEach((resource) => {
    if (Array.isArray(data?.[resource])) {
      writeSnapshot(resource, mergeEntities(readSnapshot(resource, []), data[resource]));
    }
  });

  const singularResources = {
    product: 'products',
    category: 'categories',
    customer: 'customers',
    supplier: 'suppliers',
    order: 'orders',
    log: 'logs',
    user: 'users',
  };
  Object.entries(singularResources).forEach(([singular, resource]) => {
    if (data?.[singular]?.id != null) {
      writeSnapshot(resource, mergeEntities(readSnapshot(resource, []), [data[singular]]));
    }
  });
  if (data?.store) writeSnapshot('store', data.store);
}

function mutateSnapshotList(resource, mutator) {
  writeSnapshot(resource, mutator(structuredClone(readSnapshot(resource, []))));
}

function getCachedEntries() {
  ensureScopedMigration();
  const entries = [];
  const prefix = cachePrefix();
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!key?.startsWith(prefix)) continue;
    const value = storageGet(key, null);
    if (value?.data) entries.push({ key, path: key.slice(prefix.length), ...value });
  }
  return entries;
}

function mutateCachedEntries(predicate, mutator) {
  getCachedEntries()
    .filter((entry) => predicate(entry.path, entry.data))
    .forEach((entry) => {
      const nextData = mutator(structuredClone(entry.data), entry.path);
      storageSet(entry.key, {
        data: nextData,
        cached_at: nowIso(),
        offline_mutated: true,
      });
    });
}

function extractIdFromPath(path, resource) {
  const match = path.match(new RegExp(`^/${resource}/([^/?]+)`));
  return match?.[1] || null;
}

function createOfflineOrder(data) {
  const products = getBestCachedProducts();
  const user = storageGet('user', {});
  const customers = readSnapshot('customers', []);
  const customer = customers.find((item) => String(item.id) === String(data.customer_id));
  const productById = new Map(products.map((product) => [String(product.id), product]));
  const items = (data.items || []).map((item) => {
    const product = productById.get(String(item.product_id)) || {};
    const unitPrice = Number(product.price || item.unit_price || 0);
    const quantity = Number(item.quantity || 0);
    return {
      product_id: item.product_id,
      product_name: product.name || `Product ${item.product_id}`,
      quantity,
      unit_price: unitPrice,
      discount: item.discount || 0,
      total: unitPrice * quantity - (item.discount || 0),
    };
  });
  const subtotal = items.reduce((sum, item) => sum + Number(item.total || 0), 0);
  const discount = Number(data.discount_amount || 0);
  const store = getBestCachedStore();
  const taxAmount = subtotal * (Number(store.tax_rate || 0) / 100);
  const order = {
    id: tempId(),
    offline: true,
    order_number: `OFFLINE-${Date.now()}`,
    created_at: nowIso(),
    customer_id: data.customer_id || null,
    customer_name: customer?.name || null,
    cashier_name: user.name || 'This device',
    payment_method: data.payment_method || 'cash',
    payment_reference: data.payment_reference || null,
    payments: data.payment_reference ? [{ reference: data.payment_reference }] : [],
    client_order_id: data.client_order_id,
    subtotal,
    tax_amount: taxAmount,
    discount_amount: discount,
    total: subtotal + taxAmount - discount,
    status: 'completed',
    items,
  };

  updateProductStockForOrder(data.items || []);
  addOrderToCachedLists(order);
  mutateSnapshotList('orders', (orders) => [order, ...orders]);
  return { order, offline: true, queued: true };
}

function getBestCachedStore() {
  const snapshot = readSnapshot('store', null);
  if (snapshot) return snapshot;
  const entry = getCachedEntries()
    .filter((item) => item.path.startsWith('/settings/store') && item.data?.store)
    .sort((a, b) => new Date(b.cached_at || 0) - new Date(a.cached_at || 0))[0];
  return entry?.data?.store || {};
}

function getBestCachedProducts() {
  const snapshot = readSnapshot('products', []);
  if (snapshot.length) return snapshot;
  const entry = getCachedEntries()
    .filter((item) => item.data?.products)
    .sort((a, b) => Number(b.path === '/products?limit=100') - Number(a.path === '/products?limit=100'))[0];
  return entry?.data?.products || [];
}

function updateProductStockForOrder(items) {
  mutateSnapshotList('products', (products) => products.map((product) => {
    const sold = items.find((item) => String(item.product_id) === String(product.id));
    if (!sold) return product;
    return {
      ...product,
      stock_quantity: Math.max(0, Number(product.stock_quantity || 0) - Number(sold.quantity || 0)),
      offline: true,
    };
  }));
  mutateCachedEntries(
    (path, data) => path.startsWith('/products') && Array.isArray(data.products),
    (data) => {
      data.products = data.products.map((product) => {
        const sold = items.find((item) => String(item.product_id) === String(product.id));
        if (!sold) return product;
        return {
          ...product,
          stock_quantity: Math.max(0, Number(product.stock_quantity || 0) - Number(sold.quantity || 0)),
        };
      });
      return data;
    },
  );
}

function addOrderToCachedLists(order) {
  mutateCachedEntries(
    (path, data) => path.startsWith('/orders') && Array.isArray(data.orders),
    (data) => {
      data.orders = [order, ...data.orders];
      data.total = Number(data.total || 0) + 1;
      return data;
    },
  );
}

function createOfflineEntity(resource, data, pathPrefix = `/${resource}`) {
  const singular = resource.endsWith('ies') ? resource.slice(0, -3) + 'y' : resource.slice(0, -1);
  const entity = {
    ...data,
    id: tempId(),
    offline: true,
    is_active: data.is_active ?? true,
    created_at: nowIso(),
    updated_at: nowIso(),
  };

  mutateSnapshotList(resource, (items) => [entity, ...items]);

  mutateCachedEntries(
    (path, cached) => path.startsWith(pathPrefix) && Array.isArray(cached[resource]),
    (cached) => {
      cached[resource] = [entity, ...cached[resource]];
      cached.total = Number(cached.total || cached[resource].length);
      return cached;
    },
  );

  return { [singular]: entity, offline: true, queued: true };
}

function updateOfflineEntity(resource, id, data, pathPrefix = `/${resource}`) {
  const singular = resource.endsWith('ies') ? resource.slice(0, -3) + 'y' : resource.slice(0, -1);
  let updated = { ...data, id, offline: true, updated_at: nowIso() };

  mutateSnapshotList(resource, (items) => items.map((entity) => {
    if (String(entity.id) !== String(id)) return entity;
    updated = { ...entity, ...data, offline: true, updated_at: nowIso() };
    return updated;
  }));

  mutateCachedEntries(
    (path, cached) => path.startsWith(pathPrefix) && Array.isArray(cached[resource]),
    (cached) => {
      cached[resource] = cached[resource].map((entity) => {
        if (String(entity.id) !== String(id)) return entity;
        updated = { ...entity, ...data, offline: true, updated_at: nowIso() };
        return updated;
      });
      return cached;
    },
  );

  storageSet(cacheKey(`${pathPrefix}/${id}`), {
    data: { [singular]: updated },
    cached_at: nowIso(),
    offline_mutated: true,
  });

  return { [singular]: updated, offline: true, queued: true };
}

function deleteOfflineEntity(resource, id, pathPrefix = `/${resource}`) {
  mutateSnapshotList(resource, (items) => items.filter((entity) => String(entity.id) !== String(id)));
  mutateCachedEntries(
    (path, cached) => path.startsWith(pathPrefix) && Array.isArray(cached[resource]),
    (cached) => {
      cached[resource] = cached[resource].filter((entity) => String(entity.id) !== String(id));
      cached.total = Math.max(0, Number(cached.total || 0) - 1);
      return cached;
    },
  );
  localStorage.removeItem(cacheKey(`${pathPrefix}/${id}`));
  return { message: 'Saved offline and will sync when connected', offline: true, queued: true };
}

function createOfflineInventoryAdjustment(data) {
  const product = getBestCachedProducts().find((item) => String(item.id) === String(data.product_id));
  const quantity = Number(data.quantity);
  if (!product) throw new Error('This product is not available in the offline store snapshot.');
  if (!Number.isInteger(quantity) || quantity < 1) throw new Error('Inventory quantity must be a positive whole number.');
  if (data.type === 'out' && quantity > Number(product.stock_quantity || 0)) {
    throw new Error(`Insufficient offline stock for ${product.name}.`);
  }
  const log = {
    ...data,
    id: tempId(),
    offline: true,
    product_name: product?.name || `Product ${data.product_id}`,
    created_at: nowIso(),
  };
  const modifier = data.type === 'out' ? -quantity : quantity;

  mutateSnapshotList('products', (products) => products.map((item) => (
    String(item.id) === String(data.product_id)
      ? { ...item, stock_quantity: Number(item.stock_quantity || 0) + modifier, offline: true }
      : item
  )));
  mutateSnapshotList('logs', (logs) => [log, ...logs]);

  mutateCachedEntries(
    (path, cached) => path.startsWith('/products') && Array.isArray(cached.products),
    (cached) => {
      cached.products = cached.products.map((product) => (
        String(product.id) === String(data.product_id)
          ? { ...product, stock_quantity: Number(product.stock_quantity || 0) + modifier }
          : product
      ));
      return cached;
    },
  );

  mutateCachedEntries(
    (path, cached) => path.startsWith('/inventory/logs') && Array.isArray(cached.logs),
    (cached) => {
      cached.logs = [log, ...cached.logs];
      return cached;
    },
  );

  return { log, offline: true, queued: true };
}

function updateOfflineStore(data) {
  const store = {
    ...getBestCachedStore(),
    ...data,
    offline: true,
    updated_at: nowIso(),
  };
  writeSnapshot('store', store);
  mutateCachedEntries(
    (path, cached) => path.startsWith('/settings/store') && cached.store,
    (cached) => ({ ...cached, store }),
  );
  return { store, offline: true, queued: true };
}

function optimisticResponse(method, path, data) {
  if (method === 'POST' && path === '/orders') return createOfflineOrder(data || {});
  if (method === 'POST' && path === '/inventory/adjust') return createOfflineInventoryAdjustment(data || {});
  if (method === 'POST' && path === '/products') return createOfflineEntity('products', data || {});
  if (method === 'POST' && path === '/customers') return createOfflineEntity('customers', data || {});
  if (method === 'POST' && path === '/categories') return createOfflineEntity('categories', data || {});
  if (method === 'POST' && path === '/inventory/suppliers') return createOfflineEntity('suppliers', data || {}, '/inventory/suppliers');
  if (method === 'PATCH' && path === '/settings/store') return updateOfflineStore(data || {});

  const productId = extractIdFromPath(path, 'products');
  if (productId && method === 'PATCH') return updateOfflineEntity('products', productId, data || {});
  if (productId && method === 'DELETE') return deleteOfflineEntity('products', productId);

  const customerId = extractIdFromPath(path, 'customers');
  if (customerId && method === 'PATCH') return updateOfflineEntity('customers', customerId, data || {});
  if (customerId && method === 'DELETE') return deleteOfflineEntity('customers', customerId);

  const categoryId = extractIdFromPath(path, 'categories');
  if (categoryId && method === 'PATCH') return updateOfflineEntity('categories', categoryId, data || {});
  if (categoryId && method === 'DELETE') return deleteOfflineEntity('categories', categoryId);

  const supplierId = path.match(/^\/inventory\/suppliers\/([^/?]+)/)?.[1];
  if (supplierId && method === 'PATCH') return updateOfflineEntity('suppliers', supplierId, data || {}, '/inventory/suppliers');
  if (supplierId && method === 'DELETE') return deleteOfflineEntity('suppliers', supplierId, '/inventory/suppliers');

  return { offline: true, queued: true, message: 'Saved offline and will sync when connected' };
}

function migrateLegacyOrderQueue() {
  ensureScopedMigration();
  const legacy = storageGet(LEGACY_ORDER_QUEUE_KEY, []);
  if (!Array.isArray(legacy) || legacy.length === 0) return;

  const queue = storageGet(queueKey(), []);
  legacy.forEach((order) => {
    queue.push({
      id: order.temp_id || tempId(),
      method: 'POST',
      path: '/orders',
      data: order,
      created_at: order.created_at || nowIso(),
    });
  });
  storageSet(queueKey(), queue);
  localStorage.removeItem(LEGACY_ORDER_QUEUE_KEY);
}

export function isNetworkError(error) {
  return (
    error instanceof TypeError ||
    error?.name === 'TypeError' ||
    error?.message === 'Failed to fetch' ||
    error?.message?.toLowerCase().includes('network')
  );
}

export function isGetCacheable(path) {
  return pathMatches(path, CACHEABLE_GET_PREFIXES);
}

export function isWriteQueueable(path) {
  return pathMatches(path, QUEUEABLE_WRITE_PREFIXES);
}

function parsedPath(path) {
  const url = new URL(path, 'https://quickpos.local');
  return { pathname: url.pathname, params: url.searchParams };
}

function paginate(items, params) {
  const page = Math.max(1, Number(params.get('page') || 1));
  const limit = Math.max(1, Number(params.get('limit') || items.length || 50));
  const offset = (page - 1) * limit;
  return items.slice(offset, offset + limit);
}

function filterProducts(products, params) {
  const search = (params.get('search') || '').trim().toLowerCase();
  const categoryId = params.get('category_id');
  let result = products.filter((product) => (
    (!search || [product.name, product.sku, product.barcode].some((value) => String(value || '').toLowerCase().includes(search))) &&
    (!categoryId || String(product.category_id) === String(categoryId))
  ));
  const sort = ['name', 'price', 'stock_quantity', 'created_at'].includes(params.get('sort'))
    ? params.get('sort')
    : 'name';
  const direction = params.get('order') === 'desc' ? -1 : 1;
  result = result.sort((a, b) => String(a[sort] ?? '').localeCompare(String(b[sort] ?? ''), undefined, { numeric: true }) * direction);
  return result;
}

function filterCustomers(customers, params) {
  const search = (params.get('search') || '').trim().toLowerCase();
  return customers
    .filter((customer) => !search || [customer.name, customer.email, customer.phone]
      .some((value) => String(value || '').toLowerCase().includes(search)))
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
}

function filterOrders(orders, params) {
  const status = params.get('status');
  const start = params.get('start_date') ? new Date(params.get('start_date')).getTime() : null;
  const end = params.get('end_date') ? new Date(`${params.get('end_date')}T23:59:59.999`).getTime() : null;
  return orders
    .filter((order) => {
      const created = new Date(order.created_at).getTime();
      return (!status || order.status === status) && (!start || created >= start) && (!end || created <= end);
    })
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

function periodKey(date, period) {
  const value = new Date(date);
  if (period === 'monthly') return value.toISOString().slice(0, 7);
  if (period === 'weekly') {
    const utc = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
    const day = utc.getUTCDay() || 7;
    utc.setUTCDate(utc.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
    const week = Math.ceil((((utc - yearStart) / 86400000) + 1) / 7);
    return `${utc.getUTCFullYear()}-${String(week).padStart(2, '0')}`;
  }
  return value.toISOString().slice(0, 10);
}

function offlineSalesReport(orders, params) {
  const period = params.get('period') || 'daily';
  const grouped = new Map();
  filterOrders(orders, params)
    .filter((order) => order.status === 'completed')
    .forEach((order) => {
      const key = periodKey(order.created_at, period);
      const row = grouped.get(key) || { period: key, total_orders: 0, revenue: 0, total_discounts: 0, total_tax: 0 };
      row.total_orders += 1;
      row.revenue += Number(order.total || 0);
      row.total_discounts += Number(order.discount_amount || 0);
      row.total_tax += Number(order.tax_amount || 0);
      grouped.set(key, row);
    });
  return [...grouped.values()]
    .map((row) => ({ ...row, avg_order_value: row.total_orders ? row.revenue / row.total_orders : 0 }))
    .sort((a, b) => b.period.localeCompare(a.period))
    .slice(0, 30);
}

function revenueSummary(orders) {
  const completed = orders.filter((order) => order.status === 'completed');
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const week = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7)).getTime();
  const month = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const summarize = (items) => ({
    revenue: items.reduce((sum, order) => sum + Number(order.total || 0), 0),
    orders: items.length,
  });
  return {
    today: summarize(completed.filter((order) => new Date(order.created_at).getTime() >= today)),
    thisWeek: summarize(completed.filter((order) => new Date(order.created_at).getTime() >= week)),
    thisMonth: summarize(completed.filter((order) => new Date(order.created_at).getTime() >= month)),
    allTime: summarize(completed),
  };
}

function topProducts(orders, limit) {
  const grouped = new Map();
  orders.filter((order) => order.status === 'completed').forEach((order) => {
    (order.items || []).forEach((item) => {
      const key = item.product_name || String(item.product_id);
      const row = grouped.get(key) || { product_name: key, total_quantity: 0, total_revenue: 0 };
      row.total_quantity += Number(item.quantity || 0);
      row.total_revenue += Number(item.total || 0);
      grouped.set(key, row);
    });
  });
  return [...grouped.values()].sort((a, b) => b.total_quantity - a.total_quantity).slice(0, limit);
}

function deriveSnapshotResponse(path) {
  const { pathname, params } = parsedPath(path);
  const products = readSnapshot('products', []);
  const customers = readSnapshot('customers', []);
  const orders = readSnapshot('orders', []);

  if (pathname === '/settings/store') return readSnapshot('store', null) ? { store: readSnapshot('store') } : null;
  if (pathname === '/products/low-stock' && products.length) {
    return { products: products.filter((product) => product.is_active !== false && Number(product.stock_quantity || 0) <= Number(product.low_stock_threshold || 0)) };
  }
  const lookupBarcode = pathname.match(/^\/products\/lookup\/([^/]+)$/)?.[1];
  if (lookupBarcode && products.length) {
    const code = decodeURIComponent(lookupBarcode).toLowerCase();
    const product = products.find((item) => [item.barcode, item.sku].some((value) => String(value || '').toLowerCase() === code));
    return product ? { product, source: 'device cache' } : { product: null, source: 'device cache' };
  }
  const productId = pathname.match(/^\/products\/([^/]+)$/)?.[1];
  if (productId && products.length) {
    const product = products.find((item) => String(item.id) === String(productId));
    return product ? { product } : null;
  }
  if (pathname === '/products' && products.length) {
    const filtered = filterProducts(products, params);
    return { products: paginate(filtered, params), total: filtered.length, page: Number(params.get('page') || 1), limit: Number(params.get('limit') || filtered.length) };
  }

  const customerId = pathname.match(/^\/customers\/([^/]+)$/)?.[1];
  if (customerId && customers.length) {
    const customer = customers.find((item) => String(item.id) === String(customerId)) || null;
    return customer ? { customer, orders: orders.filter((order) => String(order.customer_id) === String(customerId)).slice(0, 20) } : null;
  }
  if (pathname === '/customers' && customers.length) {
    const filtered = filterCustomers(customers, params);
    return { customers: paginate(filtered, params), total: filtered.length };
  }

  const orderId = pathname.match(/^\/orders\/([^/]+)$/)?.[1];
  if (orderId && orders.length) {
    const order = orders.find((item) => String(item.id) === String(orderId));
    return order ? { order } : null;
  }
  if (pathname === '/orders' && orders.length) {
    const filtered = filterOrders(orders, params);
    return { orders: paginate(filtered, params), total: filtered.length, page: Number(params.get('page') || 1) };
  }

  if (pathname === '/categories') return { categories: readSnapshot('categories', []) };
  if (pathname === '/inventory/suppliers') return { suppliers: readSnapshot('suppliers', []) };
  if (pathname === '/inventory/logs') return { logs: paginate(readSnapshot('logs', []), params) };
  if (pathname === '/settings/users') return { users: readSnapshot('users', []) };
  if (pathname === '/reports/revenue' && orders.length) return revenueSummary(orders);
  if (pathname === '/reports/sales' && orders.length) return { sales: offlineSalesReport(orders, params) };
  if (pathname === '/reports/recent-orders' && orders.length) return { orders: orders.slice(0, 10).map((order) => ({ ...order, cashier: order.cashier_name })) };
  if (pathname === '/reports/top-products' && orders.length) return { products: topProducts(orders, Number(params.get('limit') || 10)) };
  return null;
}

export function cacheResponse(path, data) {
  if (!isGetCacheable(path)) return;
  ensureScopedMigration();
  storageSet(cacheKey(path), { data, cached_at: nowIso() });
  mergeSnapshotResponse(data);
}

export function cacheMutationResponse(method, path, data) {
  if (!isWriteQueueable(path)) return;
  mergeSnapshotResponse(data);
  if (method !== 'DELETE') return;

  const mappings = [
    { pattern: /^\/products\/([^/?]+)/, resource: 'products' },
    { pattern: /^\/customers\/([^/?]+)/, resource: 'customers' },
    { pattern: /^\/categories\/([^/?]+)/, resource: 'categories' },
    { pattern: /^\/inventory\/suppliers\/([^/?]+)/, resource: 'suppliers' },
  ];
  const mapping = mappings.find((item) => item.pattern.test(path));
  if (!mapping) return;
  const id = path.match(mapping.pattern)?.[1];
  mutateSnapshotList(mapping.resource, (items) => items.filter((item) => String(item.id) !== String(id)));
}

export function cacheBootstrapSnapshot(snapshot, syncedAt = nowIso()) {
  if (!snapshot) return;
  ensureScopedMigration();
  SNAPSHOT_LISTS.forEach((resource) => {
    if (Array.isArray(snapshot[resource])) writeSnapshot(resource, snapshot[resource]);
  });
  if (snapshot.store) writeSnapshot('store', snapshot.store);

  cacheResponse('/products?limit=1000', { products: snapshot.products || [], total: snapshot.products?.length || 0, page: 1, limit: 1000 });
  cacheResponse('/customers?limit=1000', { customers: snapshot.customers || [], total: snapshot.customers?.length || 0 });
  cacheResponse('/categories', { categories: snapshot.categories || [] });
  cacheResponse('/inventory/suppliers', { suppliers: snapshot.suppliers || [] });
  cacheResponse('/inventory/logs?limit=500', { logs: snapshot.logs || [] });
  cacheResponse('/orders?limit=500', { orders: snapshot.orders || [], total: snapshot.orders?.length || 0, page: 1 });
  cacheResponse('/settings/users', { users: snapshot.users || [] });
  if (snapshot.store) cacheResponse('/settings/store', { store: snapshot.store });
  const reportOrders = snapshot.orders || [];
  if (reportOrders.length) {
    cacheResponse('/reports/revenue', revenueSummary(reportOrders));
    cacheResponse('/reports/sales?period=daily', { sales: offlineSalesReport(reportOrders, parsedPath('/reports/sales?period=daily').params) });
    cacheResponse('/reports/top-products?limit=10', { products: topProducts(reportOrders, 10) });
    cacheResponse('/reports/recent-orders', { orders: reportOrders.slice(0, 10).map((order) => ({ ...order, cashier: order.cashier_name })) });
  }
  localStorage.setItem(lastSyncKey(), syncedAt);
}

export function getLastSyncAt() {
  return localStorage.getItem(lastSyncKey());
}

export function getCachedResponse(path) {
  ensureScopedMigration();
  const preferLocalReport = path.startsWith('/reports/') && getOfflineQueue()
    .some((item) => item.path === '/orders');
  if (preferLocalReport) {
    const localReport = deriveSnapshotResponse(path);
    if (localReport) return { ...structuredClone(localReport), offline: true, cached_at: getLastSyncAt() };
  }
  const exact = storageGet(cacheKey(path), null);
  if (exact?.data) return { ...structuredClone(exact.data), offline: true, cached_at: exact.cached_at };

  const derived = deriveSnapshotResponse(path);
  if (derived) return { ...structuredClone(derived), offline: true, cached_at: getLastSyncAt() };

  const [basePath] = path.split('?');
  if (basePath.startsWith('/reports/')) return null;
  const fallback = getCachedEntries()
    .filter((entry) => entry.path === basePath || entry.path.startsWith(`${basePath}?`))
    .sort((a, b) => new Date(b.cached_at || 0) - new Date(a.cached_at || 0))[0];

  if (!fallback?.data) return null;
  return { ...structuredClone(fallback.data), offline: true, cached_at: fallback.cached_at };
}

export function getOfflineQueue() {
  migrateLegacyOrderQueue();
  return storageGet(queueKey(), []);
}

export function getOfflineQueueCount() {
  return getOfflineQueue().length;
}

export function getOfflineQueueSummary() {
  const queue = getOfflineQueue();
  return {
    count: queue.length,
    needs_attention: queue.filter((item) => item.last_error).length,
    oldest_at: queue[0]?.created_at || null,
  };
}

function notifyQueue(queue) {
  window.dispatchEvent(new CustomEvent('offline-queue-updated', {
    detail: {
      count: queue.length,
      needs_attention: queue.filter((item) => item.last_error).length,
    },
  }));
}

function persistQueue(queue) {
  if (!storageSet(queueKey(), queue)) {
    throw new Error('This device could not save the offline change. Free storage and try again.');
  }
}

export function enqueueOfflineRequest({ method, path, data }) {
  const optimistic = optimisticResponse(method, path, data);
  const tempEntity =
    optimistic.product ||
    optimistic.customer ||
    optimistic.category ||
    optimistic.supplier ||
    optimistic.order;
  let queue = getOfflineQueue();
  const temporaryId = path.match(/\/(offline-[^/?]+)(?:\?|$)/)?.[1];

  if (temporaryId) {
    const createIndex = queue.findIndex((item) => item.method === 'POST' && item.meta?.temp_id === temporaryId);
    if (createIndex >= 0 && method === 'PATCH') {
      queue[createIndex] = {
        ...queue[createIndex],
        data: { ...queue[createIndex].data, ...data },
        updated_at: nowIso(),
      };
      persistQueue(queue);
      notifyQueue(queue);
      return optimistic;
    }
    if (createIndex >= 0 && method === 'DELETE') {
      queue = queue.filter((item, index) => index !== createIndex && item.path !== path);
      persistQueue(queue);
      notifyQueue(queue);
      return optimistic;
    }
  }

  const existingPatch = method === 'PATCH'
    ? queue.findIndex((item) => item.method === 'PATCH' && item.path === path)
    : -1;
  if (existingPatch >= 0) {
    queue[existingPatch] = {
      ...queue[existingPatch],
      data: { ...queue[existingPatch].data, ...data },
      last_error: null,
      updated_at: nowIso(),
    };
    persistQueue(queue);
    notifyQueue(queue);
    return optimistic;
  }

  if (method === 'DELETE') {
    queue = queue.filter((item) => !(item.method === 'PATCH' && item.path === path));
  }

  queue.push({
    id: tempId(),
    method,
    path,
    data,
    meta: tempEntity?.id ? { temp_id: tempEntity.id } : undefined,
    created_at: nowIso(),
    attempt_count: 0,
  });
  persistQueue(queue);
  notifyQueue(queue);
  return optimistic;
}

export function removeOfflineQueueItem(id) {
  const queue = getOfflineQueue().filter((item) => item.id !== id);
  persistQueue(queue);
  notifyQueue(queue);
}

export function updateOfflineQueueItem(id, changes) {
  const queue = getOfflineQueue().map((item) => (
    item.id === id ? { ...item, ...changes } : item
  ));
  persistQueue(queue);
  notifyQueue(queue);
}

function replaceValueDeep(value, oldValue, newValue) {
  if (String(value) === String(oldValue)) return newValue;
  if (Array.isArray(value)) return value.map((item) => replaceValueDeep(item, oldValue, newValue));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, replaceValueDeep(item, oldValue, newValue)]),
    );
  }
  return value;
}

export function reconcileQueuedTempId(tempIdValue, serverId) {
  if (!tempIdValue || !serverId) return getOfflineQueue();
  const queue = getOfflineQueue().map((item) => ({
    ...item,
    path: String(item.path).split(String(tempIdValue)).join(String(serverId)),
    data: replaceValueDeep(item.data, tempIdValue, serverId),
  }));
  persistQueue(queue);

  const scopedPrefixes = [cachePrefix(), `${SNAPSHOT_ROOT}${currentScope()}:`];
  const keys = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (scopedPrefixes.some((prefix) => key?.startsWith(prefix))) keys.push(key);
  }
  keys.forEach((key) => {
    const value = storageGet(key, null);
    if (value != null) storageSet(key, replaceValueDeep(value, tempIdValue, serverId));
  });
  notifyQueue(queue);
  return queue;
}
