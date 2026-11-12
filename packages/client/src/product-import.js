// CSV import for products: parse a spreadsheet export, map flexible column names,
// validate each row the way the API will, and skip rows that would duplicate a SKU or barcode.

export const PRODUCT_CSV_HEADERS = ['name', 'sku', 'barcode', 'category', 'price', 'cost_price', 'stock_quantity', 'low_stock_threshold', 'description'];

const HEADER_ALIASES = {
  name: ['name', 'product', 'product name', 'item', 'item name'],
  sku: ['sku', 'code', 'product code', 'item code'],
  barcode: ['barcode', 'ean', 'upc', 'bar code'],
  category: ['category', 'category name', 'group'],
  price: ['price', 'selling price', 'sale price', 'retail price', 'unit price'],
  cost_price: ['cost_price', 'cost', 'cost price', 'buying price', 'purchase price'],
  stock_quantity: ['stock_quantity', 'stock', 'quantity', 'qty', 'in stock', 'opening stock'],
  low_stock_threshold: ['low_stock_threshold', 'low stock alert', 'reorder level', 'alert at', 'minimum stock'],
  description: ['description', 'details', 'notes'],
};

/** RFC 4180-style CSV parsing: quoted fields, escaped quotes, commas and newlines inside quotes. */
export function parseCSV(text) {
  const input = String(text || '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') { field += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field); field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[i + 1] === '\n') i += 1;
      row.push(field); field = '';
      if (row.some((cell) => cell.trim() !== '')) rows.push(row);
      row = [];
    } else {
      field += char;
    }
  }
  row.push(field);
  if (row.some((cell) => cell.trim() !== '')) rows.push(row);
  return rows;
}

function mapHeaders(headerRow) {
  const map = {};
  headerRow.forEach((raw, index) => {
    const header = String(raw).trim().toLowerCase().replace(/[_\s]+/g, ' ');
    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
      if (map[field] === undefined && aliases.some((alias) => alias.replace(/_/g, ' ') === header)) map[field] = index;
    }
  });
  return map;
}

function parseNumber(value) {
  const cleaned = String(value ?? '').replace(/[₦$,\s]/g, '').replace(/^ngn/i, '');
  if (cleaned === '') return null;
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : NaN;
}

const norm = (value) => String(value || '').trim().toLowerCase();

/**
 * Turns parsed CSV rows into product payloads.
 * Returns { products: [{ line, payload, category }], errors: [{ line, message }], missing: [...] }.
 */
export function rowsToProducts(rows, { existingProducts = [] } = {}) {
  if (!rows.length) return { products: [], errors: [{ line: 1, message: 'The file is empty' }], missing: [] };
  const columns = mapHeaders(rows[0]);
  const missing = ['name', 'price'].filter((field) => columns[field] === undefined);
  if (missing.length) {
    return { products: [], errors: [{ line: 1, message: `Missing column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}` }], missing };
  }

  const takenSku = new Set(existingProducts.map((p) => norm(p.sku)).filter(Boolean));
  const takenBarcode = new Set(existingProducts.map((p) => norm(p.barcode)).filter(Boolean));
  const products = [];
  const errors = [];
  const cell = (row, field) => (columns[field] === undefined ? '' : String(row[columns[field]] ?? '').trim());

  rows.slice(1).forEach((row, index) => {
    const line = index + 2;
    const name = cell(row, 'name');
    const price = parseNumber(cell(row, 'price'));
    const cost = parseNumber(cell(row, 'cost_price'));
    const stock = parseNumber(cell(row, 'stock_quantity'));
    const alertAt = parseNumber(cell(row, 'low_stock_threshold'));
    const sku = cell(row, 'sku');
    const barcode = cell(row, 'barcode');

    const problem =
      (!name && 'Name is empty') ||
      (name.length > 255 && 'Name is longer than 255 characters') ||
      ((price === null || Number.isNaN(price) || price <= 0) && 'Price must be a number above 0') ||
      (Number.isNaN(cost) || (cost !== null && cost < 0) ? 'Cost price must be 0 or more' : '') ||
      (Number.isNaN(stock) || (stock !== null && (stock < 0 || !Number.isInteger(stock))) ? 'Stock must be a whole number, 0 or more' : '') ||
      (Number.isNaN(alertAt) || (alertAt !== null && (alertAt < 0 || !Number.isInteger(alertAt))) ? 'Low stock alert must be a whole number' : '') ||
      (sku && takenSku.has(norm(sku)) && `SKU ${sku} already exists`) ||
      (barcode && takenBarcode.has(norm(barcode)) && `Barcode ${barcode} already exists`);
    if (problem) {
      errors.push({ line, message: problem });
      return;
    }

    if (sku) takenSku.add(norm(sku));
    if (barcode) takenBarcode.add(norm(barcode));
    const payload = { name, price };
    if (sku) payload.sku = sku;
    if (barcode) payload.barcode = barcode;
    if (cost !== null) payload.cost_price = cost;
    if (stock !== null) payload.stock_quantity = stock;
    if (alertAt !== null) payload.low_stock_threshold = alertAt;
    const description = cell(row, 'description');
    if (description) payload.description = description.slice(0, 2000);
    products.push({ line, payload, category: cell(row, 'category') });
  });

  return { products, errors, missing: [] };
}

export function productTemplateRows() {
  return [
    { name: 'Coca-Cola 50cl', sku: 'BEV-001', barcode: '5449000000996', category: 'Beverages', price: 350, cost_price: 250, stock_quantity: 48, low_stock_threshold: 12, description: '' },
    { name: 'Rice 5kg', sku: 'GRC-001', barcode: '', category: 'Groceries', price: 8500, cost_price: 7000, stock_quantity: 20, low_stock_threshold: 5, description: 'Long grain' },
  ];
}
