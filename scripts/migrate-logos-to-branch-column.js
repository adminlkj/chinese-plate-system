/**
 * Migration script: move branch logos from the legacy Setting table
 * (keyed by `logo_<code>` or `logo_<branchId>`) into the canonical
 * Branch.logo column.
 *
 * This is a ONE-TIME migration to run after the branch-system refactor.
 * After running this, each branch's logo lives on the Branch row itself,
 * so the receipt template can read it directly without consulting the
 * Setting table.
 *
 * Idempotent: safe to re-run. Branches that already have a logo are
 * left untouched.
 *
 * Usage:
 *   node scripts/migrate-logos-to-branch-column.js
 *   # or
 *   bun run scripts/migrate-logos-to-branch-column.js
 */
const { PrismaClient } = require('@prisma/client');

async function main() {
  const prisma = new PrismaClient();

  try {
    console.log('🔄 Loading all branches...');
    const branches = await prisma.branch.findMany({
      select: { id: true, code: true, name: true, logo: true },
    });
    console.log(`   Found ${branches.length} branch(es).`);

    let migrated = 0;
    let skipped = 0;

    for (const branch of branches) {
      if (branch.logo) {
        console.log(`   ✓  [${branch.code}] already has a logo on the Branch row — skipping`);
        skipped++;
        continue;
      }

      // Try the legacy Setting keys: first by branchId (UUID), then by code
      const candidates = [`logo_${branch.id}`, `logo_${branch.code}`];
      let foundLogo = null;
      for (const key of candidates) {
        const setting = await prisma.setting.findUnique({ where: { key } });
        if (setting?.value) {
          foundLogo = setting.value;
          console.log(`   🔍 [${branch.code}] found logo under Setting key "${key}"`);
          break;
        }
      }

      if (!foundLogo) {
        console.log(`   ·  [${branch.code}] no legacy logo found — skipping`);
        skipped++;
        continue;
      }

      await prisma.branch.update({
        where: { id: branch.id },
        data: { logo: foundLogo },
      });
      console.log(`   ✅ [${branch.code}] migrated logo to Branch.logo column (${foundLogo.length} chars)`);
      migrated++;
    }

    console.log(`\n✓ Done. Migrated ${migrated} logo(s), skipped ${skipped}.`);
  } catch (error) {
    console.error('✗ Migration failed:', error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main();
