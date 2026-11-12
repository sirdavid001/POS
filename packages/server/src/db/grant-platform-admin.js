import { query } from '../config/database.js';

function emailFromArgs(argv) {
  const index = argv.indexOf('--email');
  return index >= 0 ? String(argv[index + 1] || '').trim().toLowerCase() : '';
}

async function grantPlatformAdmin() {
  const email = emailFromArgs(process.argv.slice(2));
  if (!email) {
    throw new Error('Usage: npm run platform-admin:grant -- --email owner@example.com');
  }

  const result = await query(
    `INSERT INTO platform_admins (user_id)
     SELECT id FROM users WHERE LOWER(email) = $1
     ON CONFLICT (user_id) DO UPDATE SET granted_at = platform_admins.granted_at
     RETURNING user_id`,
    [email]
  );

  if (!result.rows[0]) {
    throw new Error(`No QuickPOS user exists for ${email}`);
  }

  console.log(`Platform access granted to ${email}`);
}

grantPlatformAdmin()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
