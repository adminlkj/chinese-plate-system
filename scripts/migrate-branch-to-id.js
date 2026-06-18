#!/usr/bin/env node
/**
 * migrate-branch-to-id.js
 * ─────────────────────────────────────────────────────────────────────────
 * ONE-SHOT MIGRATION SCRIPT
 *
 * Converts existing string-based branch data to UUID-based branchId.
 *
 * Background:
 *   The Prisma schema was refactored. All `branch String` columns are now
 *   `branchId String` (UUID FK → Branch.id). The column rename preserves
 *   existing string values ('CHINA_TOWN', 'PALACE_INDIA', 'MAIN') in the
 *   renamed column. This script replaces those legacy string values with
 *   the actual UUID of the corresponding Branch row.
 *
 * What this script does (idempotent):
 *   1. Ensures the standard branches (MAIN, CHINA_TOWN, PALACE_INDIA) exist
 *      in the Branch table — creates any missing ones.
 *   2. Builds a code → UUID map.
 *   3. For each table that has a branchId column, replaces any string-valued
 *      branchId ('CHINA_TOWN', 'PALACE_INDIA', 'MAIN') with the UUID.
 *   4. For StockTransfer, also migrates fromBranchId / toBranchId.
 *
 * Idempotency:
 *   - Running twice is safe: after the first run, branchId columns hold UUIDs
 *     which won't match any of the legacy string codes, so subsequent UPDATEs
 *     affect zero rows.
 *   - Branch creation uses upsert by code, so repeated runs don't create
 *     duplicates.
 *
 * Usage:
 *   node scripts/migrate-branch-to-id.js
 *   (or)  bun run scripts/migrate-branch-to-id.js
 *
 * Requirements:
 *   - DATABASE_URL must be set in the environment (.env)
 *   - Run AFTER `prisma db push` (so the column is renamed to branchId)
 *   - Run BEFORE the application is started against the new schema
 * ─────────────────────────────────────────────────────────────────────────
 */

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient({
  log: ['warn', 'error'],
});

// ─── Configuration ────────────────────────────────────────────────────

const STANDARD_BRANCHES = [
  { code: 'MAIN', name: 'Main Branch', nameEn: 'Main Branch', sortOrder: 0, isActive: true },
  { code: 'CHINA_TOWN', name: 'China Town', nameEn: 'China Town', sortOrder: 1, isActive: true },
  { code: 'PALACE_INDIA', name: 'Palace India', nameEn: 'Palace India', sortOrder: 2, isActive: true },
];

// All tables that have a single `branchId` column (renamed from `branch`)
const BRANCH_TABLES = [
  'Account',
  'Transaction',
  'JournalEntry',
  'RestaurantTable',
  'ProductCategory',
  'Product',
  'StockTransaction',
  'StockTake',
  'Shift',
  'POSInvoice',
  'AuditLog',
];

// StockTransfer has fromBranchId + toBranchId instead of a single branchId
const STOCK_TRANSFER_TABLE = 'StockTransfer';

// ─── Helpers ──────────────────────────────────────────────────────────

function log(...args) {
  console.log('[migrate-branch-to-id]', ...args);
}

function warn(...args) {
  console.warn('[migrate-branch-to-id] WARNING:', ...args);
}

function error(...args) {
  console.error('[migrate-branch-to-id] ERROR:', ...args);
}

/**
 * Ensure all standard branches exist in the Branch table.
 * Returns a map of branch code → UUID.
 */
async function ensureBranches() {
  const map = {};
  log('Ensuring standard branches exist...');

  for (const def of STANDARD_BRANCHES) {
    const branch = await prisma.branch.upsert({
      where: { code: def.code },
      update: {
        // Keep existing branch names if they're already set with Arabic/localized values.
        // Only update sortOrder/isActive to keep the standard configuration consistent.
        sortOrder: def.sortOrder,
        isActive: def.isActive,
      },
      create: def,
    });
    map[def.code] = branch.id;
    log(`  • Branch "${def.code}" → ${branch.id}`);
  }

  return map;
}

/**
 * Check whether a given string looks like a legacy branch code (vs a UUID/cuid).
 * Legacy codes: 'CHINA_TOWN', 'PALACE_INDIA', 'MAIN' (and lowercase variants).
 */
function isLegacyBranchCode(value) {
  if (value == null) return false;
  const v = String(value).trim();
  if (!v) return false;
  // Prisma cuid() IDs are typically 20-30 chars, alphanumeric + lowercase.
  // Legacy branch codes are short uppercase strings.
  const KNOWN_CODES = ['CHINA_TOWN', 'PALACE_INDIA', 'MAIN', 'NONE'];
  if (KNOWN_CODES.includes(v.toUpperCase())) return true;
  // Heuristic: legacy codes are <= 32 chars, mostly uppercase letters/underscores, no dashes.
  // cuid UUIDs contain lowercase letters and often start with 'c' or 'k'.
  if (v.length <= 32 && /^[A-Z_]+$/.test(v)) return true;
  return false;
}

/**
 * Count rows in a table where branchId is a legacy string code.
 * Returns null if the table cannot be queried (e.g., column doesn't exist yet).
 */
async function countLegacyRows(table, column = 'branchId') {
  try {
    const result = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS cnt FROM "${table}" WHERE "${column}" IN ('CHINA_TOWN', 'PALACE_INDIA', 'MAIN', 'NONE')`
    );
    return Array.isArray(result) && result[0] ? result[0].cnt : 0;
  } catch (e) {
    warn(`Could not count legacy rows in "${table}"."${column}": ${e.message}`);
    return null;
  }
}

/**
 * Migrate a single branchId-style column on a single table.
 * Replaces each legacy code with the corresponding UUID.
 */
async function migrateBranchColumn(table, column, branchMap) {
  let totalUpdated = 0;

  for (const [code, uuid] of Object.entries(branchMap)) {
    try {
      const result = await prisma.$executeRaw`
        UPDATE "${table}"
        SET "${column}" = ${uuid}
        WHERE "${column}" = ${code}
      `;
      if (result > 0) {
        log(`  • ${table}.${column}: ${result} row(s) updated from "${code}" → ${uuid}`);
      }
      totalUpdated += result || 0;
    } catch (e) {
      error(`Failed to update ${table}.${column} for code "${code}": ${e.message}`);
      throw e;
    }
  }

  // Also handle lowercase / case variants just in case
  for (const code of Object.keys(branchMap)) {
    const lower = code.toLowerCase();
    if (lower === code) continue;
    try {
      const result = await prisma.$executeRaw`
        UPDATE "${table}"
        SET "${column}" = ${branchMap[code]}
        WHERE LOWER("${column}") = ${lower}
          AND "${column}" != ${branchMap[code]}
      `;
      if (result > 0) {
        log(`  • ${table}.${column}: ${result} row(s) updated from lowercase "${lower}" → ${branchMap[code]}`);
      }
      totalUpdated += result || 0;
    } catch (e) {
      // Non-fatal: lowercase variants are unusual but possible
      warn(`Could not migrate lowercase "${lower}" in ${table}.${column}: ${e.message}`);
    }
  }

  return totalUpdated;
}

/**
 * Verify there are no remaining legacy string values in a column.
 */
async function verifyColumn(table, column) {
  const remaining = await countLegacyRows(table, column);
  if (remaining === null) return null;
  if (remaining > 0) {
    warn(`  ⚠ ${table}.${column} still has ${remaining} legacy string value(s).`);
    return remaining;
  }
  return 0;
}

// ─── Main Migration ───────────────────────────────────────────────────

async function main() {
  const startTime = Date.now();
  log('══════════════════════════════════════════════════════════════');
  log('Branch String → UUID Migration');
  log('══════════════════════════════════════════════════════════════');

  // STEP 1: Ensure branches exist
  const branchMap = await ensureBranches();
  log(`✓ ${Object.keys(branchMap).length} branches ready.`);

  // STEP 2: Migrate all single-branchId tables
  log('');
  log('Migrating branchId columns...');
  const perTableUpdates = {};
  for (const table of BRANCH_TABLES) {
    const before = await countLegacyRows(table, 'branchId');
    if (before === 0) {
      log(`• ${table}: no legacy rows, skipping.`);
      perTableUpdates[table] = 0;
      continue;
    }
    if (before !== null) {
      log(`• ${table}: ${before} legacy row(s) to migrate.`);
    }
    const updated = await migrateBranchColumn(table, 'branchId', branchMap);
    perTableUpdates[table] = updated;
  }

  // STEP 3: Migrate StockTransfer (fromBranchId + toBranchId)
  log('');
  log('Migrating StockTransfer.fromBranchId / toBranchId...');
  for (const column of ['fromBranchId', 'toBranchId']) {
    const before = await countLegacyRows(STOCK_TRANSFER_TABLE, column);
    if (before === 0) {
      log(`• ${STOCK_TRANSFER_TABLE}.${column}: no legacy rows, skipping.`);
      continue;
    }
    if (before !== null) {
      log(`• ${STOCK_TRANSFER_TABLE}.${column}: ${before} legacy row(s) to migrate.`);
    }
    await migrateBranchColumn(STOCK_TRANSFER_TABLE, column, branchMap);
  }

  // STEP 4: Verify
  log('');
  log('Verifying migration...');
  let totalRemaining = 0;
  for (const table of BRANCH_TABLES) {
    const remaining = await verifyColumn(table, 'branchId');
    if (remaining !== null) totalRemaining += remaining;
  }
  for (const column of ['fromBranchId', 'toBranchId']) {
    const remaining = await verifyColumn(STOCK_TRANSFER_TABLE, column);
    if (remaining !== null) totalRemaining += remaining;
  }

  // Summary
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  log('');
  log('══════════════════════════════════════════════════════════════');
  log('MIGRATION SUMMARY');
  log('══════════════════════════════════════════════════════════════');
  log(`Branches ensured : ${Object.keys(branchMap).length}`);
  for (const [code, uuid] of Object.entries(branchMap)) {
    log(`  • ${code.padEnd(14)} → ${uuid}`);
  }
  log('');
  log('Rows updated per table:');
  for (const [table, count] of Object.entries(perTableUpdates)) {
    log(`  • ${table.padEnd(20)} : ${count}`);
  }
  log(`StockTransfer      : fromBranchId + toBranchId migrated`);
  log('');
  log(`Remaining legacy rows: ${totalRemaining}`);
  log(`Elapsed: ${elapsed}s`);

  if (totalRemaining > 0) {
    warn('Some legacy rows could not be migrated. Review the warnings above.');
    process.exitCode = 2;
  } else {
    log('✓ Migration complete — all branchId columns now hold UUIDs.');
  }
}

// ─── Entry Point ──────────────────────────────────────────────────────

main()
  .catch((e) => {
    error('Migration failed:', e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
