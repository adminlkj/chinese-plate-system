/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Post-Build Copy Script for Next.js Standalone + Tauri
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * CRITICAL: Next.js standalone output does NOT include static files or
 * public assets. Without this script, the production build will show
 * a BLANK/UNSTYLED screen because CSS/JS bundles are missing.
 *
 * This script ensures:
 * 1. .next/static → standalone/.next/static  (CSS/JS bundles)
 * 2. public/      → standalone/public/        (favicon, logo, etc.)
 * 3. Prisma client + engines → standalone/node_modules/  (DB access)
 * 4. prisma/      → standalone/prisma/         (schema + seed DB)
 *
 * Called by: npm run build → "prisma generate && next build && node scripts/copy-standalone.js"
 */

/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const STANDALONE_DIR = path.join(ROOT, '.next', 'standalone');

function log(msg) { console.log(`[copy-standalone] ${msg}`); }
function warn(msg) { console.warn(`[copy-standalone] ⚠️  ${msg}`); }
function error(msg) { console.error(`[copy-standalone] ❌ ${msg}`); }
function success(msg) { console.log(`[copy-standalone] ✅ ${msg}`); }

function copyDir(src, dest) {
  if (!fs.existsSync(src)) {
    warn(`Source not found: ${src}`);
    return 0;
  }
  fs.mkdirSync(dest, { recursive: true });
  let count = 0;
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      count += copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
      count++;
    }
  }
  return count;
}

function countFiles(dir) {
  if (!fs.existsSync(dir)) return 0;
  let count = 0;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      count += countFiles(fullPath);
    } else {
      count++;
    }
  }
  return count;
}

// ─── Verify standalone directory exists ───────────────────────────────────────
log('═════════════════════════════════════════════════════════');
log('  Post-Build: Copying essential files to standalone');
log('═════════════════════════════════════════════════════════');

if (!fs.existsSync(STANDALONE_DIR)) {
  error('Standalone directory not found! Is output: "standalone" set in next.config.ts?');
  error('Run `next build` first with output: "standalone" in next.config.ts');
  process.exit(1);
}

const serverJs = path.join(STANDALONE_DIR, 'server.js');
if (!fs.existsSync(serverJs)) {
  error('server.js not found in standalone output!');
  error('The Next.js build may have failed or output config is wrong.');
  process.exit(1);
}

success(`Standalone directory verified: ${STANDALONE_DIR}`);
success(`server.js found (${(fs.statSync(serverJs).size / 1024).toFixed(1)} KB)`);

// ─── Step 1: Copy .next/static → standalone/.next/static ─────────────────────
// THIS IS THE MOST CRITICAL STEP — without this, CSS/JS won't load
const staticDir = path.join(ROOT, '.next', 'static');
const standaloneStaticDir = path.join(STANDALONE_DIR, '.next', 'static');

log('');
log('Step 1: Copying .next/static → standalone/.next/static');
log('        (CSS/JS bundles — CRITICAL for styling)');
if (fs.existsSync(staticDir)) {
  const fileCount = copyDir(staticDir, standaloneStaticDir);
  success(`Step 1: Static files copied (${fileCount} files)`);

  // Verify CSS files exist (Next.js puts them in chunks/ not css/)
  const cssFiles = [];
  if (fs.existsSync(standaloneStaticDir)) {
    // Next.js 14+ puts CSS in chunks/ directory
    const chunksDir = path.join(standaloneStaticDir, 'chunks');
    if (fs.existsSync(chunksDir)) {
      const entries = fs.readdirSync(chunksDir);
      for (const entry of entries) {
        if (entry.endsWith('.css')) cssFiles.push(entry);
      }
    }
    // Also check css/ directory (older Next.js versions)
    const cssDir = path.join(standaloneStaticDir, 'css');
    if (fs.existsSync(cssDir)) {
      const entries = fs.readdirSync(cssDir);
      for (const entry of entries) {
        if (entry.endsWith('.css')) cssFiles.push(entry);
      }
    }
  }

  if (cssFiles.length > 0) {
    success(`Step 1: Found ${cssFiles.length} CSS file(s) — styling will work!`);
    for (const f of cssFiles) {
      log(`        - ${f}`);
    }
  } else {
    warn('Step 1: No CSS files found — UI may be unstyled!');
    warn('        Check tailwind.config.ts content paths include "./src/**/*.{js,ts,jsx,tsx}"');
  }
} else {
  error('Step 1: .next/static NOT FOUND — production CSS/JS will be missing!');
}

// ─── Step 2: Copy public → standalone/public ─────────────────────────────────
const publicDir = path.join(ROOT, 'public');
const standalonePublicDir = path.join(STANDALONE_DIR, 'public');

log('');
log('Step 2: Copying public/ → standalone/public/');
if (fs.existsSync(publicDir)) {
  const fileCount = copyDir(publicDir, standalonePublicDir);
  success(`Step 2: Public files copied (${fileCount} files)`);
} else {
  warn('Step 2: public/ not found — skipping.');
}

// ─── Step 3: Copy Prisma client to standalone/node_modules ───────────────────
const standaloneNodeModules = path.join(STANDALONE_DIR, 'node_modules');

log('');
log('Step 3: Copying Prisma client + engines to standalone...');

let prismaFileCount = 0;

// Copy .prisma (generated client with query engine)
const prismaClientDir = path.join(ROOT, 'node_modules', '.prisma');
if (fs.existsSync(prismaClientDir)) {
  prismaFileCount += copyDir(prismaClientDir, path.join(standaloneNodeModules, '.prisma'));
  success('Step 3a: .prisma (generated client) copied.');
} else {
  error('Step 3a: node_modules/.prisma NOT FOUND — Prisma will NOT work at runtime!');
  error('         Run `prisma generate` before building.');
}

// Copy @prisma/client
const prismaClientPkg = path.join(ROOT, 'node_modules', '@prisma', 'client');
if (fs.existsSync(prismaClientPkg)) {
  prismaFileCount += copyDir(prismaClientPkg, path.join(standaloneNodeModules, '@prisma', 'client'));
  success('Step 3b: @prisma/client copied.');
} else {
  error('Step 3b: @prisma/client NOT FOUND!');
}

// Copy @prisma/engines (query engine binaries)
const prismaEnginesDir = path.join(ROOT, 'node_modules', '@prisma', 'engines');
if (fs.existsSync(prismaEnginesDir)) {
  prismaFileCount += copyDir(prismaEnginesDir, path.join(standaloneNodeModules, '@prisma', 'engines'));
  success('Step 3c: @prisma/engines copied.');
}

success(`Step 3: Total Prisma files copied: ${prismaFileCount}`);

// ─── Step 4: Copy prisma/ directory (schema + seed DB) ──────────────────────
const prismaDir = path.join(ROOT, 'prisma');
const standalonePrismaDir = path.join(STANDALONE_DIR, 'prisma');

log('');
log('Step 4: Copying prisma/ directory (schema + seed DB)...');
if (fs.existsSync(prismaDir)) {
  // Only copy essential files, not the development databases
  fs.mkdirSync(standalonePrismaDir, { recursive: true });

  // Copy schema.prisma
  const schemaSrc = path.join(prismaDir, 'schema.prisma');
  if (fs.existsSync(schemaSrc)) {
    fs.copyFileSync(schemaSrc, path.join(standalonePrismaDir, 'schema.prisma'));
    success('Step 4a: schema.prisma copied.');
  }

  // Copy seed.db (pre-migrated database for first run)
  const seedDbSrc = path.join(prismaDir, 'seed.db');
  if (fs.existsSync(seedDbSrc)) {
    fs.copyFileSync(seedDbSrc, path.join(standalonePrismaDir, 'seed.db'));
    success(`Step 4b: seed.db copied (${(fs.statSync(seedDbSrc).size / 1024).toFixed(1)} KB).`);
  } else {
    warn('Step 4b: seed.db NOT FOUND — first-run database seeding will create empty DB.');
  }

  // Copy migrations directory if it exists
  const migrationsDir = path.join(prismaDir, 'migrations');
  if (fs.existsSync(migrationsDir)) {
    copyDir(migrationsDir, path.join(standalonePrismaDir, 'migrations'));
    success('Step 4c: migrations/ copied.');
  }
} else {
  warn('Step 4: prisma/ directory not found — skipping.');
}

// ─── Step 5: Verify critical files ───────────────────────────────────────────
log('');
log('Step 5: Verifying critical files...');

const criticalFiles = [
  { path: path.join(STANDALONE_DIR, 'server.js'), name: 'server.js' },
  { path: path.join(STANDALONE_DIR, '.next', 'static'), name: '.next/static/' },
  { path: path.join(standaloneNodeModules, '.prisma'), name: 'node_modules/.prisma/' },
  { path: path.join(STANDALONE_DIR, 'prisma', 'schema.prisma'), name: 'prisma/schema.prisma' },
];

let allGood = true;
for (const file of criticalFiles) {
  if (fs.existsSync(file.path)) {
    success(`  ✓ ${file.name}`);
  } else {
    error(`  ✗ ${file.name} — MISSING!`);
    allGood = false;
  }
}

// ─── Done ─────────────────────────────────────────────────────────────────────
log('');
log('═════════════════════════════════════════════════════════');
if (allGood) {
  success('Post-build copy complete — ALL critical files verified!');
} else {
  warn('Post-build copy complete — SOME files are missing.');
  warn('The application may not work correctly in production.');
}
log(`  Standalone dir: ${STANDALONE_DIR}`);
log(`  Static files:   ${countFiles(standaloneStaticDir)} files`);
log(`  Public files:   ${countFiles(standalonePublicDir)} files`);
log(`  Prisma files:   ${prismaFileCount} files`);
log('');
log('  Next: Run `npm run tauri:build` to create the installer');
log('═════════════════════════════════════════════════════════');
