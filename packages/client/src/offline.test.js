import assert from 'node:assert/strict';
import { before, beforeEach, test } from 'node:test';

class MemoryStorage {
  constructor() { this.values = new Map(); }
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key) { return this.values.has(String(key)) ? this.values.get(String(key)) : null; }
  key(index) { return [...this.values.keys()][index] ?? null; }
  removeItem(key) { this.values.delete(String(key)); }
  setItem(key, value) { this.values.set(String(key), String(value)); }
}

let offline;

before(async () => {
  globalThis.localStorage = new MemoryStorage();
  globalThis.window = new EventTarget();
  if (!globalThis.CustomEvent) {
    globalThis.CustomEvent = class CustomEvent extends Event {
      constructor(type, options = {}) {
        super(type);
        this.detail = options.detail;
      }
    };
  }
  offline = await import('./offline.js');
});

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('user', JSON.stringify({ id: 7, storeId: 42, name: 'Owner' }));
});

function seedSnapshot() {
  offline.cacheBootstrapSnapshot({
    store: { id: 42, name: 'Test Store', tax_rate: 7.5 },
    products: [
      { id: 1, name: 'Blue Soap', sku: 'SOAP-B', barcode: '111', price: 500, stock_quantity: 10, low_stock_threshold: 2, is_active: true },
      { id: 2, name: 'Red Drink', sku: 'DRINK-R', barcode: '222', price: 350, stock_quantity: 2, low_stock_threshold: 3, is_active: true },
    ],
    categories: [],
    customers: [{ id: 5, name: 'Ada Customer', email: 'ada@example.com' }],
    suppliers: [],
    orders: [],
    logs: [],
    users: [],
  }, '2026-07-06T12:00:00.000Z');
}

test('serves filtered lists, details, barcodes, and low stock from the device snapshot', () => {
  seedSnapshot();

  const search = offline.getCachedResponse('/products?search=drink&limit=100');
  assert.deepEqual(search.products.map((product) => product.id), [2]);
  assert.equal(search.offline, true);

  assert.equal(offline.getCachedResponse('/products/1').product.name, 'Blue Soap');
  assert.equal(offline.getCachedResponse('/products/lookup/222').product.name, 'Red Drink');
  assert.deepEqual(offline.getCachedResponse('/products/low-stock').products.map((product) => product.id), [2]);
  assert.equal(offline.getCachedResponse('/customers/5').customer.name, 'Ada Customer');
});

test('keeps offline data isolated between stores on the same device', () => {
  seedSnapshot();
  localStorage.setItem('user', JSON.stringify({ id: 8, storeId: 99, name: 'Another Owner' }));

  assert.equal(offline.getCachedResponse('/products?limit=100'), null);
  assert.equal(offline.getOfflineQueueCount(), 0);
});

test('keeps queued work attributed to the user who created it', () => {
  seedSnapshot();
  offline.enqueueOfflineRequest({ method: 'POST', path: '/customers', data: { name: 'Offline Customer' } });
  assert.equal(offline.getOfflineQueueCount(), 1);

  localStorage.setItem('user', JSON.stringify({ id: 99, storeId: 42, name: 'Cashier' }));
  assert.equal(offline.getOfflineQueueCount(), 0);
  assert.equal(offline.getCachedResponse('/customers?limit=100'), null);
});

test('merges repeated offline edits and cancels a create that is deleted before sync', () => {
  seedSnapshot();
  const created = offline.enqueueOfflineRequest({ method: 'POST', path: '/products', data: { name: 'Offline Item', price: 100, stock_quantity: 3 } });
  const path = `/products/${created.product.id}`;

  offline.enqueueOfflineRequest({ method: 'PATCH', path, data: { name: 'Renamed Item' } });
  assert.equal(offline.getOfflineQueueCount(), 1);
  assert.equal(offline.getOfflineQueue()[0].data.name, 'Renamed Item');

  offline.enqueueOfflineRequest({ method: 'DELETE', path });
  assert.equal(offline.getOfflineQueueCount(), 0);
  assert.equal(offline.getCachedResponse('/products?search=renamed').products.length, 0);
});

test('repairs temporary ids in queued request bodies and URLs', () => {
  seedSnapshot();
  const temporary = 'offline-1234-test';
  offline.enqueueOfflineRequest({
    method: 'PATCH',
    path: `/products/${temporary}`,
    data: { category_id: temporary, name: 'Queued edit' },
  });

  offline.reconcileQueuedTempId(temporary, 88);
  const queued = offline.getOfflineQueue()[0];
  assert.equal(queued.path, '/products/88');
  assert.equal(queued.data.category_id, 88);
});

test('records an offline sale once, reduces local stock, and includes it in local reports', () => {
  seedSnapshot();
  const result = offline.enqueueOfflineRequest({
    method: 'POST',
    path: '/orders',
    data: {
      client_order_id: 'sale-offline-test-1234',
      items: [{ product_id: 1, quantity: 2 }],
      customer_id: 5,
      payment_method: 'cash',
    },
  });

  assert.equal(result.order.client_order_id, 'sale-offline-test-1234');
  assert.equal(result.order.total, 1075);
  assert.equal(offline.getCachedResponse('/products/1').product.stock_quantity, 8);
  assert.equal(offline.getCachedResponse('/orders?limit=50').orders.length, 1);
  assert.equal(offline.getCachedResponse('/reports/revenue').allTime.revenue, 1075);
  assert.equal(offline.getCachedResponse('/reports/top-products?limit=10').products[0].total_quantity, 2);
});
