/**
 * Pre-build script for Render (PostgreSQL) deployment — NO-OP SAFETY NET.
 *
 * As of PROD-PRISMA-FIX, the Prisma schema (`prisma/schema.prisma`) is
 * written DIRECTLY for PostgreSQL (`provider = "postgresql"`). This script
 * is retained as a build-time safety net: if for any reason the schema
 * provider were reverted to `sqlite` (e.g. a stale merge or sandbox
 * sync), this script will switch it back to `postgresql` before
 * `prisma generate` runs, ensuring the Render build never generates a
 * SQLite client.
 *
 * Behavior:
 *   - If schema contains `provider = "sqlite"`  → flips to "postgresql"
 *   - If schema already has `provider = "postgresql"` → NO-OP (prints ✓)
 *
 * Invoked from render.yaml buildCommand:
 *   node scripts/switch-to-postgres.js && npx prisma generate && npm run build
 */
const fs = require('fs');
const path = require('path');

const schemaPath = path.join(__dirname, '..', 'prisma', 'schema.prisma');

try {
  let schema = fs.readFileSync(schemaPath, 'utf8');

  if (schema.includes('provider = "sqlite"')) {
    schema = schema.replace('provider = "sqlite"', 'provider = "postgresql"');
    fs.writeFileSync(schemaPath, schema);
    console.log('✓ Switched Prisma provider: sqlite → postgresql');
  } else {
    console.log('✓ Prisma provider already postgresql (no change needed)');
  }
} catch (error) {
  console.error('✗ Failed to switch Prisma provider:', error.message);
  process.exit(1);
}
