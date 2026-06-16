const CACHE_PREFIX = 'quickpos_cache:';
const QUEUE_KEY = 'quickpos_offline_queue';
const LEGACY_ORDER_QUEUE_KEY = 'quickpos_offline_orders';

const CACHEABLE_GET_PREFIXES = [
  '/categories',
  '/customers',
  '/inventory/logs',
  '/inventory/suppliers',
  '/orders',
  '/products',
  '/reports',
  '/settings/store',
];

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
  localStorage.setItem(key, JSON.stringify(value));
}

function cacheKey(path) {
  return `${CACHE_PREFIX}${path}`;
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

function getCachedEntries() {
  const entries = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!key?.startsWith(CACHE_PREFIX)) continue;
    const value = storageGet(key, null);
    if (value?.data) entries.push({ key, path: key.slice(CACHE_PREFIX.length), ...value });
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
  const order = {
    id: tempId(),
    offline: true,
    order_number: `OFFLINE-${Date.now()}`,
    created_at: nowIso(),
    customer_id: data.customer_id || null,
    payment_method: data.payment_method || 'cash',
    subtotal,
    tax_amount: 0,
    discount_amount: discount,
    total: subtotal - discount,
    status: 'completed',
    items,
  };

  updateProductStockForOrder(data.items || []);
  addOrderToCachedLists(order);
  return { order, offline: true, queued: true };
}

function getBestCachedProducts() {
  const entry = getCachedEntries()
    .filter((item) => item.data?.products)
    .sort((a, b) => Number(b.path === '/products?limit=100') - Number(a.path === '/products?limit=100'))[0];
  return entry?.data?.products || [];
}

function updateProductStockForOrder(items) {
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
  const log = {
    ...data,
    id: tempId(),
    offline: true,
    created_at: nowIso(),
  };
  const modifier = data.type === 'out' ? -Number(data.quantity || 0) : Number(data.quantity || 0);

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

function optimisticResponse(method, path, data) {
  if (method === 'POST' && path === '/orders') return createOfflineOrder(data || {});
  if (method === 'POST' && path === '/inventory/adjust') return createOfflineInventoryAdjustment(data || {});
  if (method === 'POST' && path === '/products') return createOfflineEntity('products', data || {});
  if (method === 'POST' && path === '/customers') return createOfflineEntity('customers', data || {});
  if (method === 'POST' && path === '/categories') return createOfflineEntity('categories', data || {});
  if (method === 'POST' && path === '/inventory/suppliers') return createOfflineEntity('suppliers', data || {}, '/inventory/suppliers');

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
  const legacy = storageGet(LEGACY_ORDER_QUEUE_KEY, []);
  if (!Array.isArray(legacy) || legacy.length === 0) return;

  const queue = storageGet(QUEUE_KEY, []);
  legacy.forEach((order) => {
    queue.push({
      id: order.temp_id || tempId(),
      method: 'POST',
      path: '/orders',
      data: order,
      created_at: order.created_at || nowIso(),
    });
  });
  storageSet(QUEUE_KEY, queue);
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

export function cacheResponse(path, data) {
  if (!isGetCacheable(path)) return;
  storageSet(cacheKey(path), { data, cached_at: nowIso() });
}

export function getCachedResponse(path) {
  const exact = storageGet(cacheKey(path), null);
  if (exact?.data) return { ...structuredClone(exact.data), offline: true, cached_at: exact.cached_at };

  const [basePath] = path.split('?');
  const fallback = getCachedEntries()
    .filter((entry) => entry.path === basePath || entry.path.startsWith(`${basePath}?`))
    .sort((a, b) => new Date(b.cached_at || 0) - new Date(a.cached_at || 0))[0];

  if (!fallback?.data) return null;
  return { ...structuredClone(fallback.data), offline: true, cached_at: fallback.cached_at };
}

export function getOfflineQueue() {
  migrateLegacyOrderQueue();
  return storageGet(QUEUE_KEY, []);
}

export function getOfflineQueueCount() {
  return getOfflineQueue().length;
}

export function enqueueOfflineRequest({ method, path, data }) {
  const optimistic = optimisticResponse(method, path, data);
  const tempEntity =
    optimistic.product ||
    optimistic.customer ||
    optimistic.category ||
    optimistic.supplier ||
    optimistic.order;
  const queue = getOfflineQueue();
  queue.push({
    id: tempId(),
    method,
    path,
    data,
    meta: tempEntity?.id ? { temp_id: tempEntity.id } : undefined,
    created_at: nowIso(),
  });
  storageSet(QUEUE_KEY, queue);
  window.dispatchEvent(new CustomEvent('offline-queue-updated', { detail: { count: queue.length } }));
  return optimistic;
}

export function removeOfflineQueueItem(id) {
  const queue = getOfflineQueue().filter((item) => item.id !== id);
  storageSet(QUEUE_KEY, queue);
  window.dispatchEvent(new CustomEvent('offline-queue-updated', { detail: { count: queue.length } }));
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
    data: replaceValueDeep(item.data, tempIdValue, serverId),
  }));
  storageSet(QUEUE_KEY, queue);
  return queue;
}
