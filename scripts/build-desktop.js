#!/usr/bin/env node
/**
 * نظام المحاسبة - Electron Desktop Build Script (Cross-Platform Node.js)
 * ────────────────────────────────────────────────────────────────────────────────
 * Builds the Next.js standalone output for Electron and packages it as a
 * Windows desktop application.
 *
 * Output: Windows NSIS installer + portable executable (x64)
 *
 * Usage:
 *   node scripts/build-desktop.js
 * ────────────────────────────────────────────────────────────────────────────────
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// ─── Configuration ────────────────────────────────────────────────────────────
const PROJECT_DIR = path.resolve(__dirname, '..');
const STANDALONE_DIR = path.join(PROJECT_DIR, '.next', 'standalone');
const STATIC_DIR = path.join(PROJECT_DIR, '.next', 'static');
const PUBLIC_DIR = path.join(PROJECT_DIR, 'public');
const PRISMA_DIR = path.join(PROJECT_DIR, 'prisma');
const DB_DIR = path.join(PROJECT_DIR, 'db');
const NODE_MODULES_DIR = path.join(PROJECT_DIR, 'node_modules');

// ─── Utilities ────────────────────────────────────────────────────────────────
function log(step, message) {
  console.log(`[${step}] ${message}`);
}

function logError(step, message) {
  console.error(`[${step}] ERROR: ${message}`);
}

function logWarning(step, message) {
  console.warn(`[${step}] WARNING: ${message}`);
}

/**
 * Recursively copy a directory (cross-platform)
 */
function copyDirRecursive(src, dest) {
  if (!fs.existsSync(src)) {
    return false;
  }

  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }

  return true;
}

/**
 * Run a command and exit on failure
 */
function runCommand(command, step, options = {}) {
  try {
    log(step, `Running: ${command}`);
    execSync(command, {
      stdio: 'inherit',
      cwd: PROJECT_DIR,
      env: { ...process.env, ...options.env },
    });
    return true;
  } catch (err) {
    logError(step, `Command failed: ${command}`);
    logError(step, err.message);
    return false;
  }
}

// ─── Build Steps ──────────────────────────────────────────────────────────────

console.log('');
console.log('═══════════════════════════════════════════════════════════════');
console.log('  نظام المحاسبة - Electron Desktop Build (Windows)');
console.log('═══════════════════════════════════════════════════════════════');
console.log('');

// ── Step 1: Generate Prisma Client ────────────────────────────────────────────
log('1/7', 'Generating Prisma Client...');
if (!runCommand('npx prisma generate', '1/7')) {
  process.exit(1);
}

// ── Step 2: Build Next.js standalone output ───────────────────────────────────
log('2/7', 'Building Next.js standalone output...');
if (!runCommand('npx next build', '2/7', { env: { DATABASE_URL: 'file:./db/custom.db' } })) {
  process.exit(1);
}

// ── Step 3: Verify standalone output exists ───────────────────────────────────
log('3/7', 'Verifying standalone output...');
if (!fs.existsSync(STANDALONE_DIR)) {
  logError('3/7', '.next/standalone/ directory not found. Build may have failed.');
  process.exit(1);
}
if (!fs.existsSync(path.join(STANDALONE_DIR, 'server.js'))) {
  logError('3/7', 'server.js not found in standalone output!');
  process.exit(1);
}
log('3/7', 'Standalone output ready at: .next/standalone/');

// ── Step 4: Copy static files to standalone ───────────────────────────────────
log('4/7', 'Copying static files and dependencies to standalone directory...');

// Copy .next/static to standalone/.next/static
const standaloneStaticDir = path.join(STANDALONE_DIR, '.next', 'static');
if (fs.existsSync(STATIC_DIR)) {
  fs.mkdirSync(standaloneStaticDir, { recursive: true });
  if (copyDirRecursive(STATIC_DIR, standaloneStaticDir)) {
    log('4/7', 'Copied .next/static to standalone/.next/static');
  } else {
    logWarning('4/7', 'Failed to copy .next/static');
  }
} else {
  logWarning('4/7', '.next/static directory not found');
}

// Copy public to standalone/public
if (fs.existsSync(PUBLIC_DIR)) {
  const standalonePublicDir = path.join(STANDALONE_DIR, 'public');
  if (copyDirRecursive(PUBLIC_DIR, standalonePublicDir)) {
    log('4/7', 'Copied public to standalone/public');
  } else {
    logWarning('4/7', 'Failed to copy public');
  }
} else {
  logWarning('4/7', 'public directory not found');
}

// Copy prisma schema to standalone/prisma
const standalonePrismaDir = path.join(STANDALONE_DIR, 'prisma');
fs.mkdirSync(standalonePrismaDir, { recursive: true });
const schemaSrc = path.join(PRISMA_DIR, 'schema.prisma');
if (fs.existsSync(schemaSrc)) {
  fs.copyFileSync(schemaSrc, path.join(standalonePrismaDir, 'schema.prisma'));
  log('4/7', 'Copied prisma/schema.prisma');
} else {
  logWarning('4/7', 'prisma/schema.prisma not found');
}

// Copy database to standalone/db
const standaloneDbDir = path.join(STANDALONE_DIR, 'db');
fs.mkdirSync(standaloneDbDir, { recursive: true });
const dbFile = path.join(DB_DIR, 'custom.db');
if (fs.existsSync(dbFile)) {
  fs.copyFileSync(dbFile, path.join(standaloneDbDir, 'custom.db'));
  log('4/7', 'Copied db/custom.db');

  // Also copy WAL and SHM files if they exist
  const walFile = dbFile + '-wal';
  const shmFile = dbFile + '-shm';
  if (fs.existsSync(walFile)) {
    fs.copyFileSync(walFile, path.join(standaloneDbDir, 'custom.db-wal'));
  }
  if (fs.existsSync(shmFile)) {
    fs.copyFileSync(shmFile, path.join(standaloneDbDir, 'custom.db-shm'));
  }
} else {
  logWarning('4/7', 'db/custom.db not found — database will be created on first run');
}

// ── Step 5: Copy Prisma engines and client to standalone ──────────────────────
log('5/7', 'Copying Prisma native engine and client...');

// Copy @prisma/engines
const enginesSrc = path.join(NODE_MODULES_DIR, '@prisma', 'engines');
const enginesDest = path.join(STANDALONE_DIR, 'node_modules', '@prisma', 'engines');
if (fs.existsSync(enginesSrc)) {
  fs.mkdirSync(enginesDest, { recursive: true });
  if (copyDirRecursive(enginesSrc, enginesDest)) {
    log('5/7', 'Copied @prisma/engines');
  } else {
    logWarning('5/7', 'Failed to copy @prisma/engines');
  }
} else {
  logWarning('5/7', '@prisma/engines not found in node_modules');
}

// Copy .prisma/client (generated client with engine binary)
const prismaClientSrc = path.join(NODE_MODULES_DIR, '.prisma', 'client');
const prismaClientDest = path.join(STANDALONE_DIR, 'node_modules', '.prisma', 'client');
if (fs.existsSync(prismaClientSrc)) {
  fs.mkdirSync(prismaClientDest, { recursive: true });
  if (copyDirRecursive(prismaClientSrc, prismaClientDest)) {
    log('5/7', 'Copied .prisma/client');
  } else {
    logWarning('5/7', 'Failed to copy .prisma/client');
  }
} else {
  logWarning('5/7', '.prisma/client not found in node_modules');
}

// Ensure @prisma/client wrapper is available
const clientWrapperSrc = path.join(NODE_MODULES_DIR, '@prisma', 'client');
const clientWrapperDest = path.join(STANDALONE_DIR, 'node_modules', '@prisma', 'client');
if (!fs.existsSync(clientWrapperDest) && fs.existsSync(clientWrapperSrc)) {
  fs.mkdirSync(clientWrapperDest, { recursive: true });
  if (copyDirRecursive(clientWrapperSrc, clientWrapperDest)) {
    log('5/7', 'Copied @prisma/client wrapper');
  }
}

// Copy bcryptjs (needed for login)
const bcryptjsSrc = path.join(NODE_MODULES_DIR, 'bcryptjs');
const bcryptjsDest = path.join(STANDALONE_DIR, 'node_modules', 'bcryptjs');
if (!fs.existsSync(bcryptjsDest) && fs.existsSync(bcryptjsSrc)) {
  fs.mkdirSync(bcryptjsDest, { recursive: true });
  if (copyDirRecursive(bcryptjsSrc, bcryptjsDest)) {
    log('5/7', 'Copied bcryptjs');
  }
}

// Copy next-auth (may not be in standalone trace)
const nextAuthSrc = path.join(NODE_MODULES_DIR, 'next-auth');
const nextAuthDest = path.join(STANDALONE_DIR, 'node_modules', 'next-auth');
if (!fs.existsSync(nextAuthDest) && fs.existsSync(nextAuthSrc)) {
  fs.mkdirSync(nextAuthDest, { recursive: true });
  if (copyDirRecursive(nextAuthSrc, nextAuthDest)) {
    log('5/7', 'Copied next-auth');
  }
}

// ── Step 6: Verify critical files ─────────────────────────────────────────────
log('6/7', 'Verifying build output...');
let errors = 0;

if (!fs.existsSync(path.join(STANDALONE_DIR, 'server.js'))) {
  logError('6/7', 'server.js not found in standalone output!');
  errors++;
}

if (!fs.existsSync(path.join(STANDALONE_DIR, '.next', 'static'))) {
  logError('6/7', '.next/static not found in standalone output!');
  errors++;
}

if (!fs.existsSync(path.join(STANDALONE_DIR, 'prisma', 'schema.prisma'))) {
  logWarning('6/7', 'prisma/schema.prisma not found in standalone output');
}

if (errors > 0) {
  logError('6/7', `Build verification FAILED with ${errors} errors`);
  process.exit(1);
} else {
  log('6/7', 'Build verification PASSED');
}

// ── Step 7: Package with electron-builder ─────────────────────────────────────
log('7/7', 'Creating Windows package with electron-builder...');
if (!runCommand('npx electron-builder --win', '7/7')) {
  logError('7/7', 'electron-builder failed');
  process.exit(1);
}

// ── Done ──────────────────────────────────────────────────────────────────────
console.log('');
console.log('═══════════════════════════════════════════════════════════════');
console.log('  ✅ Build complete!');
console.log('═══════════════════════════════════════════════════════════════');

// Show the output files
const distDir = path.join(PROJECT_DIR, 'dist-electron');
if (fs.existsSync(distDir)) {
  console.log('');
  console.log('  Output directory: dist-electron/');
  const files = fs.readdirSync(distDir);
  for (const file of files) {
    const filePath = path.join(distDir, file);
    const stat = fs.statSync(filePath);
    const sizeMB = (stat.size / (1024 * 1024)).toFixed(1);
    console.log(`  - ${file} (${sizeMB} MB)`);
  }
}

console.log('');
