import bcrypt from 'bcryptjs';
import { query } from '../config/database.js';
import logger from '../config/logger.js';

async function seed() {
  try {
    logger.info('Starting database seeding...');

    // Insert roles
    await query(`
      INSERT INTO roles (name, permissions) VALUES
        ('admin', '["all"]'),
        ('manager', '["products", "orders", "inventory", "customers", "reports"]'),
        ('cashier', '["orders", "customers"]')
      ON CONFLICT (name) DO NOTHING
    `);
    logger.info('Roles seeded');

    // Insert default store
    const storeResult = await query(`
      INSERT INTO stores (name, address, phone, email, tax_rate, currency)
      VALUES ('My POS Store', '123 Main Street, Lagos', '+234 800 000 0000', 'store@posapp.com', 7.50, 'NGN')
      ON CONFLICT DO NOTHING
      RETURNING id
    `);

    const storeId = storeResult.rows[0]?.id || 1;

    // Insert admin user (password: admin123)
    const passwordHash = await bcrypt.hash('admin123', 12);
    const adminRole = await query(`SELECT id FROM roles WHERE name = 'admin'`);

    await query(`
      INSERT INTO users (store_id, role_id, email, password_hash, name)
      VALUES ($1, $2, 'admin@posapp.com', $3, 'Admin User')
      ON CONFLICT (email) DO NOTHING
    `, [storeId, adminRole.rows[0].id, passwordHash]);
    logger.info('Admin user seeded (admin@posapp.com / admin123)');

    // Insert sample categories
    await query(`
      INSERT INTO categories (store_id, name, description) VALUES
        ($1, 'Beverages', 'Drinks and beverages'),
        ($1, 'Snacks', 'Quick bites and snacks'),
        ($1, 'Electronics', 'Electronic gadgets and accessories'),
        ($1, 'Groceries', 'Daily grocery items'),
        ($1, 'Stationery', 'Office and school supplies')
      ON CONFLICT DO NOTHING
    `, [storeId]);
    logger.info('Categories seeded');

    // Get category IDs
    const categories = await query(`SELECT id, name FROM categories WHERE store_id = $1`, [storeId]);
    const catMap = {};
    categories.rows.forEach(c => { catMap[c.name] = c.id; });

    // Insert sample products
    const products = [
      [storeId, catMap['Beverages'], 'Coca-Cola 50cl', 'Chilled Coca-Cola bottle', 'BEV-001', '5449000000996', 350.00, 250.00, 100, 20],
      [storeId, catMap['Beverages'], 'Fanta Orange 50cl', 'Chilled Fanta Orange bottle', 'BEV-002', '5449000000997', 350.00, 250.00, 80, 20],
      [storeId, catMap['Beverages'], 'Water 75cl', 'Eva table water', 'BEV-003', '5449000000998', 200.00, 120.00, 150, 30],
      [storeId, catMap['Snacks'], 'Chin Chin (Medium)', 'Crunchy chin chin snack', 'SNK-001', '1234567890001', 500.00, 300.00, 50, 15],
      [storeId, catMap['Snacks'], 'Plantain Chips', 'Crispy plantain chips', 'SNK-002', '1234567890002', 400.00, 220.00, 60, 15],
      [storeId, catMap['Electronics'], 'USB Cable Type-C', 'Fast charging cable', 'ELC-001', '2345678901234', 2500.00, 1200.00, 30, 10],
      [storeId, catMap['Electronics'], 'Earphones', 'In-ear wired earphones', 'ELC-002', '2345678901235', 3500.00, 1800.00, 25, 10],
      [storeId, catMap['Groceries'], 'Rice (5kg)', 'Long grain rice', 'GRC-001', '3456789012345', 8500.00, 6500.00, 40, 10],
      [storeId, catMap['Groceries'], 'Cooking Oil (1L)', 'Vegetable cooking oil', 'GRC-002', '3456789012346', 3200.00, 2300.00, 35, 10],
      [storeId, catMap['Stationery'], 'Notebook A5', 'Ruled exercise notebook', 'STN-001', '4567890123456', 300.00, 150.00, 100, 25],
    ];

    for (const p of products) {
      await query(`
        INSERT INTO products (store_id, category_id, name, description, sku, barcode, price, cost_price, stock_quantity, low_stock_threshold)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT DO NOTHING
      `, p);
    }
    logger.info('Products seeded (10 items)');

    // Insert sample customers
    await query(`
      INSERT INTO customers (store_id, name, email, phone) VALUES
        ($1, 'Adebayo Johnson', 'adebayo@email.com', '+234 801 234 5678'),
        ($1, 'Chioma Okafor', 'chioma@email.com', '+234 802 345 6789'),
        ($1, 'Emeka Eze', 'emeka@email.com', '+234 803 456 7890')
      ON CONFLICT DO NOTHING
    `, [storeId]);
    logger.info('Customers seeded');

    // Insert sample supplier
    await query(`
      INSERT INTO suppliers (store_id, name, contact_name, email, phone) VALUES
        ($1, 'Lagos Wholesale Ltd', 'Mr. Okonkwo', 'wholesale@lagos.com', '+234 800 111 2222'),
        ($1, 'Tech Imports Nigeria', 'Mrs. Adeyemi', 'tech@imports.ng', '+234 800 333 4444')
      ON CONFLICT DO NOTHING
    `, [storeId]);
    logger.info('Suppliers seeded');

    logger.info('Database seeding completed!');
    process.exit(0);
  } catch (err) {
    logger.error('Seeding failed', err);
    process.exit(1);
  }
}

seed();
