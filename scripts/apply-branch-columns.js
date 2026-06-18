/**
 * One-off migration script: adds the new per-branch independent-settings
 * columns to the local SQLite `Branch` table.
 *
 * The Prisma schema already declares these columns (see prisma/schema.prisma),
 * but the local sandbox cannot run `prisma db push` because the schema is
 * written for PostgreSQL (uses @db.Decimal) while the sandbox DB is SQLite.
 * This script bypasses Prisma and applies the columns directly via SQLite
 * ALTER TABLE statements.
 *
 * Idempotent: it checks PRAGMA table_info(Branch) first and only adds
 * columns that are missing.
 *
 * Usage:  bun run scripts/apply-branch-columns.js
 */
const { Database } = require('bun:sqlite');
const path = require('path');

const DB_PATH = path.resolve(__dirname, '..', 'db', 'custom.db');
const db = new Database(DB_PATH);

// Columns to add: name -> SQLite type (mirrors the Prisma schema)
const NEW_COLUMNS = [
  { name: 'addressEn', type: 'TEXT' },
  { name: 'email', type: 'TEXT' },
  { name: 'vatNumber', type: 'TEXT' },
  { name: 'taxRate', type: 'REAL' },
  { name: 'maxDiscountPercentage', type: 'REAL' },
  { name: 'logo', type: 'TEXT' },
  { name: 'receiptHeader', type: 'TEXT' },
  { name: 'receiptFooter', type: 'TEXT' },
];

// Discover all branch tables (Prisma stores them as `Branch` capitalised)
const tables = db
  .query(`SELECT name FROM sqlite_master WHERE type='table' AND (lower(name)='branch' OR lower(name) LIKE 'branch%')`)
  .all()
  .map((r) => r.name);

console.log('Found branch tables:', tables);

for (const table of tables) {
  const cols = db.query(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  console.log(`\n[${table}] existing columns:`, cols);

  for (const col of NEW_COLUMNS) {
    if (!cols.includes(col.name)) {
      const sql = `ALTER TABLE ${table} ADD COLUMN ${col.name} ${col.type}`;
      console.log(`  + ${sql}`);
      db.run(sql);
    } else {
      console.log(`  ✓ ${col.name} already exists — skipping`);
    }
  }
}

console.log('\n✓ Done. Branch columns are now in sync with the Prisma schema.');
db.close();
