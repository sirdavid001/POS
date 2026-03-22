import bcrypt from 'bcryptjs';
import { query } from '../config/database.js';

function parseArgs(argv) {
  const args = {};

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;

    const key = arg.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) {
      args[key] = 'true';
      continue;
    }

    args[key] = value;
    i += 1;
  }

  return args;
}

function printUsage() {
  console.log(
    'Usage: npm run admin:ensure -- --email you@example.com --password "new-password" [--name "Admin User"] [--current-email old@example.com]'
  );
}

async function ensureAdmin() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help === 'true' || !args.email || !args.password) {
    printUsage();
    process.exit(args.help === 'true' ? 0 : 1);
  }

  const email = args.email.trim().toLowerCase();
  const currentEmail = (args['current-email'] || email).trim().toLowerCase();
  const name = (args.name || 'Admin User').trim();

  const roleResult = await query("SELECT id FROM roles WHERE name = 'admin' LIMIT 1");
  if (roleResult.rows.length === 0) {
    throw new Error("Admin role not found. Run migrations and seed first.");
  }

  const storeResult = await query('SELECT id FROM stores ORDER BY id ASC LIMIT 1');
  if (storeResult.rows.length === 0) {
    throw new Error('No store found. Run seed first.');
  }

  const adminRoleId = roleResult.rows[0].id;
  const storeId = storeResult.rows[0].id;
  const passwordHash = await bcrypt.hash(args.password, 12);

  const userResult = await query(
    'SELECT id FROM users WHERE email = $1 OR email = $2 ORDER BY email = $1 DESC LIMIT 1',
    [currentEmail, email]
  );

  if (userResult.rows.length > 0) {
    const userId = userResult.rows[0].id;
    await query(
      `UPDATE users
       SET email = $1,
           name = $2,
           role_id = $3,
           password_hash = $4,
           is_active = true,
           updated_at = NOW()
       WHERE id = $5`,
      [email, name, adminRoleId, passwordHash, userId]
    );

    console.log(`Updated admin user ${email}`);
    return;
  }

  await query(
    `INSERT INTO users (store_id, role_id, email, password_hash, name, is_active)
     VALUES ($1, $2, $3, $4, $5, true)`,
    [storeId, adminRoleId, email, passwordHash, name]
  );

  console.log(`Created admin user ${email}`);
}

ensureAdmin()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
