import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCSV, rowsToProducts } from './product-import.js';

test('parses quoted fields, escaped quotes, CRLF and a byte-order mark', () => {
  const rows = parseCSV('﻿name,price\r\n"Rice, 5kg",8500\r\n"Say ""hi"" bar",200\n\n');
  assert.deepEqual(rows, [['name', 'price'], ['Rice, 5kg', '8500'], ['Say "hi" bar', '200']]);
});

test('maps friendly headers and naira-formatted numbers', () => {
  const rows = parseCSV('Product Name,Selling Price,Cost,Qty,Reorder level,Category\nRice 5kg,"₦8,500",7000,20,5,Groceries');
  const result = rowsToProducts(rows);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.products[0], {
    line: 2,
    payload: { name: 'Rice 5kg', price: 8500, cost_price: 7000, stock_quantity: 20, low_stock_threshold: 5 },
    category: 'Groceries',
  });
});

test('reports bad rows with their line numbers and skips duplicates', () => {
  const rows = parseCSV([
    'name,price,sku,barcode,stock_quantity',
    'Good,100,A1,111,5',
    ',100,,,',
    'Free item,0,,,',
    'Half stock,100,,,2.5',
    'Dup existing,100,EXIST,,',
    'Dup in file,100,A1,,',
  ].join('\n'));
  const result = rowsToProducts(rows, { existingProducts: [{ sku: 'exist', barcode: null }] });
  assert.equal(result.products.length, 1);
  assert.deepEqual(result.errors.map((e) => [e.line, e.message]), [
    [3, 'Name is empty'],
    [4, 'Price must be a number above 0'],
    [5, 'Stock must be a whole number, 0 or more'],
    [6, 'SKU EXIST already exists'],
    [7, 'SKU A1 already exists'],
  ]);
});

test('requires name and price columns', () => {
  const result = rowsToProducts(parseCSV('title,cost\nRice,100'));
  assert.deepEqual(result.missing, ['name', 'price']);
  assert.equal(result.products.length, 0);
});
