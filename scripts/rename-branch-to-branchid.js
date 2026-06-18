/**
 * One-off migration: renames the legacy `branch` column to `branchId`
 * in all tables of the local SQLite database, so the schema (which now
 * uses branchId everywhere) matches the actual DB columns.
 *
 * Idempotent: only renames when the old column exists and the new one
 * doesn't.
 *
 * Usage:  bun run scripts/rename-branch-to-branchid.js
 */
const { Database } = require('bun:sqlite');
const path = require('path');

const DB_PATH = path.resolve(__dirname, '..', 'db', 'custom.db');
const db = new Database(DB_PATH);

// Discover all tables in the schema
const tables = db
  .query(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma_%'`)
  .all()
  .map((r) => r.name);

console.log('Found tables:', tables);

let renamed = 0;
for (const table of tables) {
  // Wrap table name in double quotes to handle SQL-reserved names like "Transaction"
  const qname = `"${table}"`;
  const cols = db.query(`PRAGMA table_info(${qname})`).all().map((c) => c.name);
  if (cols.includes('branch') && !cols.includes('branchId')) {
    const sql = `ALTER TABLE ${qname} RENAME COLUMN branch TO branchId`;
    console.log(`  + ${sql}`);
    db.run(sql);
    renamed++;
  } else if (cols.includes('branchId')) {
    console.log(`  ✓ ${table} already has branchId`);
  }
}

console.log(`\n✓ Done. Renamed ${renamed} column(s).`);
db.close();
