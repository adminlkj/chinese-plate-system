#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * ═══════════════════════════════════════════════════════════════
 * Windows Desktop Package Builder
 * Builds a complete, portable Windows desktop package
 * ═══════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const STANDALONE = path.join(ROOT, '.next', 'standalone');
const STATIC = path.join(ROOT, '.next', 'static');
const RELEASE = path.join(ROOT, 'Release');

// Colors for console
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const RESET = '\x1b[0m';

function log(msg, color = RESET) {
  console.log(`${color}${msg}${RESET}`);
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function copyDirRecursive(src, dest) {
  ensureDir(dest);
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isSymbolicLink()) {
      // Resolve symlink and copy the actual target
      try {
        const realPath = fs.realpathSync(srcPath);
        const stat = fs.statSync(realPath);
        if (stat.isDirectory()) {
          copyDirRecursive(realPath, destPath);
        } else {
          fs.copyFileSync(realPath, destPath);
        }
      } catch (e) {
        // Skip broken symlinks
      }
    } else if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      try {
        fs.copyFileSync(srcPath, destPath);
      } catch (e) {
        // Skip files that can't be copied
      }
    }
  }
}

function copyFile(src, dest) {
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

// ── Step 0: Build Next.js in standalone mode ─────────────────
log('[0/8] Building Next.js in standalone mode...', YELLOW);

// Temporarily set output: 'standalone' in next.config.ts
const nextConfigPath = path.join(ROOT, 'next.config.ts');
const nextConfigContent = fs.readFileSync(nextConfigPath, 'utf8');
const modifiedConfig = nextConfigContent.replace(
  /output:\s*undefined/,
  "output: 'standalone'"
);
fs.writeFileSync(nextConfigPath, modifiedConfig);

try {
  execSync('npx next build', { cwd: ROOT, stdio: 'inherit', timeout: 300000 });
  log('  ✓ Next.js standalone build completed', GREEN);
} catch (e) {
  log('ERROR: Next.js build failed', RED);
  // Restore original config
  fs.writeFileSync(nextConfigPath, nextConfigContent);
  process.exit(1);
}

// Restore original config
fs.writeFileSync(nextConfigPath, nextConfigContent);
log('  ✓ next.config.ts restored', GREEN);

// ── Step 1: Validate prerequisites ──────────────────────────
log('\n[1/8] Validating prerequisites...', YELLOW);
if (!fs.existsSync(STANDALONE)) {
  log('ERROR: Standalone build not found. Run "bun run build" first.', RED);
  process.exit(1);
}
if (!fs.existsSync(path.join(STANDALONE, 'server.js'))) {
  log('ERROR: server.js not found in standalone output.', RED);
  process.exit(1);
}
log('  ✓ Standalone build found', GREEN);

// ── Step 2: Clean Release directory ─────────────────────────
log('[2/8] Cleaning Release directory...', YELLOW);
const dirsToClean = ['server', 'runtime', 'db', 'data', 'public', 'prisma', 'backups'];
for (const dir of dirsToClean) {
  const fullPath = path.join(RELEASE, dir);
  if (fs.existsSync(fullPath)) {
    fs.rmSync(fullPath, { recursive: true, force: true });
  }
}
log('  ✓ Cleaned', GREEN);

// ── Step 3: Copy server files ───────────────────────────────
log('[3/8] Copying server files...', YELLOW);

// Copy server.js
copyFile(
  path.join(STANDALONE, 'server.js'),
  path.join(RELEASE, 'server', 'server.js')
);

// Copy .next directory from standalone (server-side only)
const standaloneNext = path.join(STANDALONE, '.next');
if (fs.existsSync(standaloneNext)) {
  copyDirRecursive(standaloneNext, path.join(RELEASE, 'server', '.next'));
  log('  ✓ .next directory copied', GREEN);
}

// Copy node_modules from standalone
const standaloneModules = path.join(STANDALONE, 'node_modules');
if (fs.existsSync(standaloneModules)) {
  copyDirRecursive(standaloneModules, path.join(RELEASE, 'server', 'node_modules'));
  log('  ✓ node_modules copied', GREEN);
}

// Copy .next/static (client-side assets)
const staticDir = path.join(ROOT, '.next', 'static');
if (fs.existsSync(staticDir)) {
  copyDirRecursive(staticDir, path.join(RELEASE, 'server', '.next', 'static'));
  log('  ✓ Static assets copied', GREEN);
}

// Copy package.json for the server
if (fs.existsSync(path.join(STANDALONE, 'package.json'))) {
  copyFile(
    path.join(STANDALONE, 'package.json'),
    path.join(RELEASE, 'server', 'package.json')
  );
}

log('  ✓ Server files copied', GREEN);

// ── Step 4: Copy Node.js runtime ────────────────────────────
log('[4/8] Setting up Node.js runtime...', YELLOW);
ensureDir(path.join(RELEASE, 'runtime'));

// Check for pre-downloaded node.exe
const nodeExePaths = [
  '/tmp/node-extract/node-v20.11.1-win-x64/node.exe',
  path.join(ROOT, 'node-resources', 'node.exe'),
];

let nodeCopied = false;
for (const nodePath of nodeExePaths) {
  if (fs.existsSync(nodePath)) {
    copyFile(nodePath, path.join(RELEASE, 'runtime', 'node.exe'));
    log('  ✓ node.exe copied from: ' + nodePath, GREEN);
    nodeCopied = true;
    break;
  }
}

if (!nodeCopied) {
  log('  ⚠ node.exe not found - you need to download it manually', YELLOW);
  log('    Download from: https://nodejs.org/dist/v20.11.1/node-v20.11.1-win-x64.zip', YELLOW);
  log('    Place node.exe in: Release/runtime/node.exe', YELLOW);
}

// ── Step 5: Copy database and schema ────────────────────────
log('[5/8] Copying database and schema...', YELLOW);

// Copy seed database
const dbPath = path.join(ROOT, 'db', 'custom.db');
if (fs.existsSync(dbPath)) {
  ensureDir(path.join(RELEASE, 'db'));
  copyFile(dbPath, path.join(RELEASE, 'db', 'custom.db'));
  log('  ✓ Seed database copied', GREEN);
} else {
  log('  ⚠ No seed database found - will be created on first run', YELLOW);
}

// Ensure data directory
ensureDir(path.join(RELEASE, 'data'));

// Copy Prisma schema
const prismaSchema = path.join(ROOT, 'prisma', 'schema.prisma');
if (fs.existsSync(prismaSchema)) {
  ensureDir(path.join(RELEASE, 'prisma'));
  copyFile(prismaSchema, path.join(RELEASE, 'prisma', 'schema.prisma'));
  log('  ✓ Prisma schema copied', GREEN);
}

// ── Step 6: Copy public assets ──────────────────────────────
log('[6/8] Copying public assets...', YELLOW);
const publicDir = path.join(ROOT, 'public');
if (fs.existsSync(publicDir)) {
  copyDirRecursive(publicDir, path.join(RELEASE, 'public'));
  log('  ✓ Public assets copied', GREEN);
}

// Ensure backups directory
ensureDir(path.join(RELEASE, 'backups'));

// ── Step 7: Copy .env file ──────────────────────────────────
log('[7/8] Setting up environment...', YELLOW);

// Create production .env
const envContent = `DATABASE_URL=file:./data/custom.db
NODE_ENV=production
NEXTAUTH_SECRET=accounting-system-production-secret-key-change-me
NEXTAUTH_URL=http://localhost:3456
`;
fs.writeFileSync(path.join(RELEASE, 'server', '.env'), envContent);
log('  ✓ .env file created', GREEN);

// ── Step 8: Calculate sizes ─────────────────────────────────
log('[8/8] Calculating package size...', YELLOW);

function getDirSize(dir) {
  let size = 0;
  if (!fs.existsSync(dir)) return 0;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      size += getDirSize(fullPath);
    } else {
      size += fs.statSync(fullPath).size;
    }
  }
  return size;
}

const totalSize = getDirSize(RELEASE);
const totalSizeMB = (totalSize / (1024 * 1024)).toFixed(1);

log(`\n═══ Build Complete ═══\n`, GREEN);
log(`  Package size: ${totalSizeMB} MB`, BLUE);
log(`  Location: ${RELEASE}`, BLUE);
log(`\n  Next steps:`, BLUE);
log(`  1. Compress the Release folder to ZIP`, BLUE);
log(`  2. Distribute to Windows users`, BLUE);
log(`  3. Users run launch.bat to start the system`, BLUE);

// List key files
log(`\n  Key files:`, BLUE);
const keyFiles = [
  'launch.bat',
  'stop.bat',
  'README.txt',
  'runtime/node.exe',
  'server/server.js',
  'db/custom.db',
  'prisma/schema.prisma',
];
for (const file of keyFiles) {
  const fullPath = path.join(RELEASE, file);
  const exists = fs.existsSync(fullPath);
  const status = exists ? '✓' : '✗';
  const color = exists ? GREEN : RED;
  log(`  ${status} ${file}`, color);
}
