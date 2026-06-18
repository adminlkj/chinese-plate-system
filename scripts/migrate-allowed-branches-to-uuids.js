/**
 * Migration script: normalize user.allowedBranches from legacy branch CODES
 * (e.g. "CHINA_TOWN", "PALACE_INDIA") to canonical branchId UUIDs.
 *
 * This is a ONE-TIME migration to run after the branch-system refactor.
 * After running this, all stored allowedBranches values are UUID arrays,
 * so assertBranchAccess can do a simple UUID-to-UUID comparison without
 * any DB lookup in the hot path.
 *
 * Idempotent: safe to re-run. Entries that are already UUIDs (or that
 * cannot be resolved to a branch) are left as-is.
 *
 * Usage:
 *   node scripts/migrate-allowed-branches-to-uuids.js
 *   # or
 *   bun run scripts/migrate-allowed-branches-to-uuids.js
 *
 * Environment:
 *   DATABASE_URL must be set (same as the app's .env)
 */
const { PrismaClient } = require('@prisma/client');

async function main() {
  const prisma = new PrismaClient();

  try {
    console.log('🔄 Loading all branches...');
    const branches = await prisma.branch.findMany({
      select: { id: true, code: true, name: true },
    });
    console.log(`   Found ${branches.length} branch(es).`);

    // Build a lookup map: code/name → UUID
    const codeToId = new Map();
    for (const b of branches) {
      if (b.code) codeToId.set(b.code, b.id);
      if (b.name) codeToId.set(b.name, b.id);
    }

    console.log('🔄 Loading all users with allowedBranches set...');
    const users = await prisma.user.findMany({
      where: { allowedBranches: { not: null } },
      select: { id: true, email: true, allowedBranches: true },
    });
    console.log(`   Found ${users.length} user(s) with allowedBranches set.`);

    let migrated = 0;
    let skipped = 0;

    for (const user of users) {
      let arr;
      try {
        arr = JSON.parse(user.allowedBranches);
        if (!Array.isArray(arr)) {
          console.log(`   ⚠️  [${user.email}] allowedBranches is not an array — skipping`);
          skipped++;
          continue;
        }
      } catch {
        console.log(`   ⚠️  [${user.email}] allowedBranches is not valid JSON — skipping`);
        skipped++;
        continue;
      }

      // Resolve each entry to a UUID
      const resolved = [];
      let changed = false;
      for (const entry of arr) {
        if (typeof entry !== 'string') continue;
        // Already a UUID? (match a Branch by id)
        const byId = branches.find((b) => b.id === entry);
        if (byId) {
          resolved.push(entry);
          continue;
        }
        // Otherwise try to resolve by code or name
        const id = codeToId.get(entry);
        if (id) {
          resolved.push(id);
          changed = true;
        } else {
          console.log(`   ⚠️  [${user.email}] could not resolve "${entry}" — dropping`);
          changed = true;
        }
      }

      // Deduplicate
      const deduped = Array.from(new Set(resolved));

      if (changed || deduped.length !== arr.length) {
        const newValue = deduped.length > 0 ? JSON.stringify(deduped) : null;
        await prisma.user.update({
          where: { id: user.id },
          data: { allowedBranches: newValue },
        });
        console.log(`   ✅ [${user.email}] migrated: ${JSON.stringify(arr)} → ${JSON.stringify(deduped)}`);
        migrated++;
      } else {
        console.log(`   ✓  [${user.email}] already uses UUIDs — no change`);
        skipped++;
      }
    }

    console.log(`\n✓ Done. Migrated ${migrated} user(s), skipped ${skipped}.`);
  } catch (error) {
    console.error('✗ Migration failed:', error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main();
