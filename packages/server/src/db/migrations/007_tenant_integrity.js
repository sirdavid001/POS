import { query } from '../../config/database.js';
import logger from '../../config/logger.js';

const migration = `
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS store_id INTEGER;
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS store_id INTEGER;

UPDATE order_items oi
SET store_id = o.store_id
FROM orders o
WHERE oi.order_id = o.id AND oi.store_id IS DISTINCT FROM o.store_id;

UPDATE purchase_order_items poi
SET store_id = po.store_id
FROM purchase_orders po
WHERE poi.purchase_order_id = po.id AND poi.store_id IS DISTINCT FROM po.store_id;

-- Nullable relationships can be repaired without discarding business records.
UPDATE categories child
SET parent_id = NULL
FROM categories parent
WHERE child.parent_id = parent.id
  AND child.store_id IS DISTINCT FROM parent.store_id;

UPDATE products product
SET category_id = NULL
FROM categories category
WHERE product.category_id = category.id
  AND product.store_id IS DISTINCT FROM category.store_id;

UPDATE orders store_order
SET customer_id = NULL
FROM customers customer
WHERE store_order.customer_id = customer.id
  AND store_order.store_id IS DISTINCT FROM customer.store_id;

UPDATE orders store_order
SET user_id = NULL
FROM users store_user
WHERE store_order.user_id = store_user.id
  AND store_order.store_id IS DISTINCT FROM store_user.store_id;

UPDATE order_items item
SET product_id = NULL
FROM products product
WHERE item.product_id = product.id
  AND item.store_id IS DISTINCT FROM product.store_id;

UPDATE payments payment
SET order_id = NULL
FROM orders store_order
WHERE payment.order_id = store_order.id
  AND payment.store_id IS DISTINCT FROM store_order.store_id;

UPDATE inventory_logs log
SET product_id = NULL
FROM products product
WHERE log.product_id = product.id
  AND log.store_id IS DISTINCT FROM product.store_id;

UPDATE inventory_logs log
SET user_id = NULL
FROM users store_user
WHERE log.user_id = store_user.id
  AND log.store_id IS DISTINCT FROM store_user.store_id;

UPDATE inventory_logs log
SET supplier_id = NULL
FROM suppliers supplier
WHERE log.supplier_id = supplier.id
  AND log.store_id IS DISTINCT FROM supplier.store_id;

UPDATE purchase_orders purchase_order
SET supplier_id = NULL
FROM suppliers supplier
WHERE purchase_order.supplier_id = supplier.id
  AND purchase_order.store_id IS DISTINCT FROM supplier.store_id;

UPDATE purchase_orders purchase_order
SET user_id = NULL
FROM users store_user
WHERE purchase_order.user_id = store_user.id
  AND purchase_order.store_id IS DISTINCT FROM store_user.store_id;

UPDATE purchase_order_items item
SET product_id = NULL
FROM products product
WHERE item.product_id = product.id
  AND item.store_id IS DISTINCT FROM product.store_id;

UPDATE users child
SET created_by_user_id = NULL
FROM users creator
WHERE child.created_by_user_id = creator.id
  AND child.store_id IS DISTINCT FROM creator.store_id;

UPDATE audit_logs audit
SET user_id = NULL
FROM users store_user
WHERE audit.user_id = store_user.id
  AND audit.store_id IS DISTINCT FROM store_user.store_id;

UPDATE legal_acceptances acceptance
SET store_id = store_user.store_id
FROM users store_user
WHERE acceptance.user_id = store_user.id
  AND acceptance.store_id IS DISTINCT FROM store_user.store_id;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM order_items WHERE store_id IS NULL) THEN
    RAISE EXCEPTION 'Cannot enforce tenant integrity: order_items contains orphaned rows';
  END IF;
  IF EXISTS (SELECT 1 FROM purchase_order_items WHERE store_id IS NULL) THEN
    RAISE EXCEPTION 'Cannot enforce tenant integrity: purchase_order_items contains orphaned rows';
  END IF;
END $$;

ALTER TABLE order_items ALTER COLUMN store_id SET NOT NULL;
ALTER TABLE purchase_order_items ALTER COLUMN store_id SET NOT NULL;
ALTER TABLE users ALTER COLUMN store_id SET NOT NULL;
ALTER TABLE categories ALTER COLUMN store_id SET NOT NULL;
ALTER TABLE products ALTER COLUMN store_id SET NOT NULL;
ALTER TABLE customers ALTER COLUMN store_id SET NOT NULL;
ALTER TABLE suppliers ALTER COLUMN store_id SET NOT NULL;
ALTER TABLE orders ALTER COLUMN store_id SET NOT NULL;
ALTER TABLE payments ALTER COLUMN store_id SET NOT NULL;
ALTER TABLE inventory_logs ALTER COLUMN store_id SET NOT NULL;
ALTER TABLE purchase_orders ALTER COLUMN store_id SET NOT NULL;
ALTER TABLE audit_logs ALTER COLUMN store_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'categories_id_store_unique') THEN
    ALTER TABLE categories ADD CONSTRAINT categories_id_store_unique UNIQUE (id, store_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customers_id_store_unique') THEN
    ALTER TABLE customers ADD CONSTRAINT customers_id_store_unique UNIQUE (id, store_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_id_store_unique') THEN
    ALTER TABLE products ADD CONSTRAINT products_id_store_unique UNIQUE (id, store_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'suppliers_id_store_unique') THEN
    ALTER TABLE suppliers ADD CONSTRAINT suppliers_id_store_unique UNIQUE (id, store_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_id_store_unique') THEN
    ALTER TABLE users ADD CONSTRAINT users_id_store_unique UNIQUE (id, store_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_id_store_unique') THEN
    ALTER TABLE orders ADD CONSTRAINT orders_id_store_unique UNIQUE (id, store_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_orders_id_store_unique') THEN
    ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_id_store_unique UNIQUE (id, store_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'categories_parent_store_fk') THEN
    ALTER TABLE categories ADD CONSTRAINT categories_parent_store_fk
      FOREIGN KEY (parent_id, store_id) REFERENCES categories(id, store_id)
      ON DELETE SET NULL (parent_id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_category_store_fk') THEN
    ALTER TABLE products ADD CONSTRAINT products_category_store_fk
      FOREIGN KEY (category_id, store_id) REFERENCES categories(id, store_id)
      ON DELETE SET NULL (category_id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_customer_store_fk') THEN
    ALTER TABLE orders ADD CONSTRAINT orders_customer_store_fk
      FOREIGN KEY (customer_id, store_id) REFERENCES customers(id, store_id)
      ON DELETE SET NULL (customer_id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_user_store_fk') THEN
    ALTER TABLE orders ADD CONSTRAINT orders_user_store_fk
      FOREIGN KEY (user_id, store_id) REFERENCES users(id, store_id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_items_order_store_fk') THEN
    ALTER TABLE order_items ADD CONSTRAINT order_items_order_store_fk
      FOREIGN KEY (order_id, store_id) REFERENCES orders(id, store_id) ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_items_product_store_fk') THEN
    ALTER TABLE order_items ADD CONSTRAINT order_items_product_store_fk
      FOREIGN KEY (product_id, store_id) REFERENCES products(id, store_id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_order_store_fk') THEN
    ALTER TABLE payments ADD CONSTRAINT payments_order_store_fk
      FOREIGN KEY (order_id, store_id) REFERENCES orders(id, store_id) ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_logs_product_store_fk') THEN
    ALTER TABLE inventory_logs ADD CONSTRAINT inventory_logs_product_store_fk
      FOREIGN KEY (product_id, store_id) REFERENCES products(id, store_id) ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_logs_user_store_fk') THEN
    ALTER TABLE inventory_logs ADD CONSTRAINT inventory_logs_user_store_fk
      FOREIGN KEY (user_id, store_id) REFERENCES users(id, store_id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_logs_supplier_store_fk') THEN
    ALTER TABLE inventory_logs ADD CONSTRAINT inventory_logs_supplier_store_fk
      FOREIGN KEY (supplier_id, store_id) REFERENCES suppliers(id, store_id)
      ON DELETE SET NULL (supplier_id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_orders_supplier_store_fk') THEN
    ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_supplier_store_fk
      FOREIGN KEY (supplier_id, store_id) REFERENCES suppliers(id, store_id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_orders_user_store_fk') THEN
    ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_user_store_fk
      FOREIGN KEY (user_id, store_id) REFERENCES users(id, store_id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_order_items_order_store_fk') THEN
    ALTER TABLE purchase_order_items ADD CONSTRAINT purchase_order_items_order_store_fk
      FOREIGN KEY (purchase_order_id, store_id) REFERENCES purchase_orders(id, store_id)
      ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_order_items_product_store_fk') THEN
    ALTER TABLE purchase_order_items ADD CONSTRAINT purchase_order_items_product_store_fk
      FOREIGN KEY (product_id, store_id) REFERENCES products(id, store_id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_creator_store_fk') THEN
    ALTER TABLE users ADD CONSTRAINT users_creator_store_fk
      FOREIGN KEY (created_by_user_id, store_id) REFERENCES users(id, store_id)
      ON DELETE SET NULL (created_by_user_id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'audit_logs_user_store_fk') THEN
    ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_user_store_fk
      FOREIGN KEY (user_id, store_id) REFERENCES users(id, store_id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'legal_acceptances_user_store_fk') THEN
    ALTER TABLE legal_acceptances ADD CONSTRAINT legal_acceptances_user_store_fk
      FOREIGN KEY (user_id, store_id) REFERENCES users(id, store_id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_nonnegative_stock') THEN
    ALTER TABLE products ADD CONSTRAINT products_nonnegative_stock
      CHECK (stock_quantity >= 0) NOT VALID;
  END IF;
END $$;

ALTER TABLE categories VALIDATE CONSTRAINT categories_parent_store_fk;
ALTER TABLE products VALIDATE CONSTRAINT products_category_store_fk;
ALTER TABLE orders VALIDATE CONSTRAINT orders_customer_store_fk;
ALTER TABLE orders VALIDATE CONSTRAINT orders_user_store_fk;
ALTER TABLE order_items VALIDATE CONSTRAINT order_items_order_store_fk;
ALTER TABLE order_items VALIDATE CONSTRAINT order_items_product_store_fk;
ALTER TABLE payments VALIDATE CONSTRAINT payments_order_store_fk;
ALTER TABLE inventory_logs VALIDATE CONSTRAINT inventory_logs_product_store_fk;
ALTER TABLE inventory_logs VALIDATE CONSTRAINT inventory_logs_user_store_fk;
ALTER TABLE inventory_logs VALIDATE CONSTRAINT inventory_logs_supplier_store_fk;
ALTER TABLE purchase_orders VALIDATE CONSTRAINT purchase_orders_supplier_store_fk;
ALTER TABLE purchase_orders VALIDATE CONSTRAINT purchase_orders_user_store_fk;
ALTER TABLE purchase_order_items VALIDATE CONSTRAINT purchase_order_items_order_store_fk;
ALTER TABLE purchase_order_items VALIDATE CONSTRAINT purchase_order_items_product_store_fk;
ALTER TABLE users VALIDATE CONSTRAINT users_creator_store_fk;
ALTER TABLE audit_logs VALIDATE CONSTRAINT audit_logs_user_store_fk;
ALTER TABLE legal_acceptances VALIDATE CONSTRAINT legal_acceptances_user_store_fk;
ALTER TABLE products VALIDATE CONSTRAINT products_nonnegative_stock;

CREATE INDEX IF NOT EXISTS idx_order_items_store ON order_items(store_id, order_id);
CREATE INDEX IF NOT EXISTS idx_purchase_order_items_store ON purchase_order_items(store_id, purchase_order_id);
`;

export async function up() {
  logger.info('Running migration: 007_tenant_integrity');
  await query(migration);
  logger.info('Migration 007_tenant_integrity completed');
}
