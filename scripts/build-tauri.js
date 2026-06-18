/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Production Build Script for Tauri Desktop App
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Called by `tauri build` via beforeBuildCommand in tauri.conf.json.
 *
 * Architecture: Next.js standalone server + Tauri desktop wrapper
 * - Next.js builds with output: "standalone" → produces .next/standalone/server.js
 * - Tauri spawns Node.js to run server.js on localhost:3456
 * - WebView navigates to the local server for the UI
 *
 * Steps:
 *  0. Pre-flight: Verify next.config.ts has output: "standalone"
 *  1. Generate Prisma Client
 *  2. Build Next.js (standalone output)
 *  3. Verify server.js exists (CRITICAL — build is useless without it)
 *  4. Copy .next/static → standalone/.next/static
 *  5. Copy public/ → standalone/public/
 *  6. Copy Prisma client + engines + CLI to standalone
 *  7. Copy prisma schema + migrations to standalone
 *  8. Verify database
 *  9. Prepare node.exe for Windows
 * 10. Verify Rust toolchain
 * 11. Production summary
 */

/* eslint-disable @typescript-eslint/no-require-imports */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
const BUILD_START = Date.now();

function log(msg) {
  console.log(`[build-tauri] ${msg}`);
}

function warn(msg) {
  console.warn(`[build-tauri] ⚠️  ${msg}`);
}

function error(msg) {
  console.error(`[build-tauri] ❌ ${msg}`);
}

function success(msg) {
  console.log(`[build-tauri] ✅ ${msg}`);
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function copyDir(src, dest) {
  ensureDir(dest);
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function getFileSize(filePath) {
  try {
    const stats = fs.statSync(filePath);
    return stats.isFile() ? stats.size : 0;
  } catch {
    return 0;
  }
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    const protocol = url.startsWith('https') ? https : http;

    function followRedirect(currentUrl, redirectCount = 0) {
      if (redirectCount > 10) {
        reject(new Error('Too many redirects'));
        return;
      }

      protocol.get(currentUrl, (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          followRedirect(response.headers.location, redirectCount + 1);
          return;
        }

        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode}`));
          return;
        }

        response.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve();
        });
      }).on('error', (err) => {
        fs.unlinkSync(destPath);
        reject(err);
      });
    }

    followRedirect(url);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// Step 0: Pre-flight checks
// ═══════════════════════════════════════════════════════════════════════════════
log('═══════════════════════════════════════════════════════════════════════');
log('  🏢 Accounting System — Production Build Pipeline');
log('═══════════════════════════════════════════════════════════════════════');

// Verify next.config.ts has output: "standalone"
const nextConfigPath = path.join(ROOT, 'next.config.ts');
const nextConfigContent = fs.readFileSync(nextConfigPath, 'utf-8');
if (!nextConfigContent.includes('output: "standalone"') && !nextConfigContent.includes("output: 'standalone'")) {
  error('next.config.ts does NOT have output: "standalone"!');
  error('This is required for Tauri desktop app production build.');
  error('Add: output: "standalone" to next.config.ts');
  process.exit(1);
}
success('Pre-flight: next.config.ts has output: "standalone"');

// ═══════════════════════════════════════════════════════════════════════════════
// Step 1: Generate Prisma Client
// ═══════════════════════════════════════════════════════════════════════════════
log('Step 1: Generating Prisma Client...');
try {
  execSync('npx prisma generate', {
    cwd: ROOT,
    stdio: 'inherit',
  });
  success('Step 1: Prisma Client generated.');
} catch (e) {
  error('Step 1: Prisma generate failed!');
  process.exit(1);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Step 2: Build Next.js with standalone output
// ═══════════════════════════════════════════════════════════════════════════════
log('Step 2: Building Next.js with output: "standalone"...');
execSync('npx next build', {
  cwd: ROOT,
  stdio: 'inherit',
  env: {
    ...process.env,
  },
});
success('Step 2: Next.js build complete.');

// ═══════════════════════════════════════════════════════════════════════════════
// Step 3: Verify standalone output + server.js (CRITICAL)
// ═══════════════════════════════════════════════════════════════════════════════
const standaloneDir = path.join(ROOT, '.next', 'standalone');

log('Step 3: Verifying standalone output...');
if (!fs.existsSync(standaloneDir)) {
  error(`Standalone directory not found at ${standaloneDir}`);
  error('Make sure next.config.ts has output: "standalone"');
  process.exit(1);
}

// CRITICAL: Verify server.js exists — this is the Node.js server entry point
const serverJsPath = path.join(standaloneDir, 'server.js');
if (!fs.existsSync(serverJsPath)) {
  error(`server.js NOT found at ${serverJsPath}`);
  error('The standalone build did not produce server.js — cannot run as desktop app!');
  error('Make sure next.config.ts has output: "standalone" and the build succeeded.');
  process.exit(1);
}
const serverJsSize = getFileSize(serverJsPath);
success(`Step 3: server.js verified (${formatBytes(serverJsSize)})`);

// ═══════════════════════════════════════════════════════════════════════════════
// Step 4: Copy .next/static → standalone/.next/static
// ═══════════════════════════════════════════════════════════════════════════════
const staticDir = path.join(ROOT, '.next', 'static');
const standaloneStaticDir = path.join(standaloneDir, '.next', 'static');

log('Step 4: Copying .next/static → standalone/.next/static');
if (fs.existsSync(staticDir)) {
  copyDir(staticDir, standaloneStaticDir);
  success('Step 4: Static files copied.');
} else {
  warn('Step 4: .next/static not found — skipping.');
}

// ═══════════════════════════════════════════════════════════════════════════════
// Step 5: Copy public/ → standalone/public/
// ═══════════════════════════════════════════════════════════════════════════════
const publicDir = path.join(ROOT, 'public');
const standalonePublicDir = path.join(standaloneDir, 'public');

log('Step 5: Copying public/ → standalone/public/');
if (fs.existsSync(publicDir)) {
  copyDir(publicDir, standalonePublicDir);
  success('Step 5: Public files copied.');
} else {
  warn('Step 5: public/ not found — skipping.');
}

// ═══════════════════════════════════════════════════════════════════════════════
// Step 6: Copy Prisma client + engines + CLI to standalone
// ═══════════════════════════════════════════════════════════════════════════════
const prismaClientDir = path.join(ROOT, 'node_modules', '.prisma');
const standaloneNodeModules = path.join(standaloneDir, 'node_modules');

log('Step 6: Copying Prisma client + engines + CLI to standalone...');

// Copy .prisma (generated client)
if (fs.existsSync(prismaClientDir)) {
  const destPrismaClient = path.join(standaloneNodeModules, '.prisma');
  copyDir(prismaClientDir, destPrismaClient);

  // Copy @prisma/client
  const prismaClientPkg = path.join(ROOT, 'node_modules', '@prisma', 'client');
  if (fs.existsSync(prismaClientPkg)) {
    const destClientPkg = path.join(standaloneNodeModules, '@prisma', 'client');
    copyDir(prismaClientPkg, destClientPkg);
  }

  // Copy @prisma/engines
  const prismaEnginesDir = path.join(ROOT, 'node_modules', '@prisma', 'engines');
  if (fs.existsSync(prismaEnginesDir)) {
    const destEnginesDir = path.join(standaloneNodeModules, '@prisma', 'engines');
    copyDir(prismaEnginesDir, destEnginesDir);
  }

  // Copy prisma CLI (needed for runtime migrations)
  const prismaCliDir = path.join(ROOT, 'node_modules', 'prisma');
  if (fs.existsSync(prismaCliDir)) {
    const destCliDir = path.join(standaloneNodeModules, 'prisma');
    copyDir(prismaCliDir, destCliDir);
  }

  // Copy @prisma internals
  const prismaInternals = path.join(ROOT, 'node_modules', '@prisma', 'internals');
  if (fs.existsSync(prismaInternals)) {
    const destInternals = path.join(standaloneNodeModules, '@prisma', 'internals');
    copyDir(prismaInternals, destInternals);
  }

  success('Step 6: Prisma client + engines + CLI copied.');
} else {
  warn('Step 6: node_modules/.prisma not found — Prisma may not work at runtime.');
}

// ═══════════════════════════════════════════════════════════════════════════════
// Step 7: Copy prisma schema + migrations to standalone
// ═══════════════════════════════════════════════════════════════════════════════
const prismaDir = path.join(ROOT, 'prisma');
const standalonePrismaDir = path.join(standaloneDir, 'prisma');

log('Step 7: Copying prisma/ schema + migrations to standalone...');
if (fs.existsSync(prismaDir)) {
  copyDir(prismaDir, standalonePrismaDir);
  success('Step 7: Prisma schema + migrations copied.');
} else {
  warn('Step 7: prisma/ directory not found — runtime migrations will not work!');
}

// ═══════════════════════════════════════════════════════════════════════════════
// Step 8: Verify database
// ═══════════════════════════════════════════════════════════════════════════════
const dbDir = path.join(ROOT, 'db');
const standaloneDbDir = path.join(standaloneDir, 'db');

log('Step 8: Checking database...');
if (fs.existsSync(path.join(dbDir, 'production.db'))) {
  log('Step 8: Database found — copying to standalone output.');
  copyDir(dbDir, standaloneDbDir);
  success('Step 8: Database copied.');
} else if (fs.existsSync(path.join(dbDir, 'custom.db'))) {
  log('Step 8: Legacy database found — copying to standalone output.');
  copyDir(dbDir, standaloneDbDir);
  success('Step 8: Database copied.');
} else if (fs.existsSync(path.join(dbDir, 'dev.db'))) {
  log('Step 8: Development database found — copying to standalone output.');
  copyDir(dbDir, standaloneDbDir);
  success('Step 8: Development database copied.');
} else {
  warn('Step 8: No database file found in db/ — the app will create one on first run via auto-migration.');
  if (fs.existsSync(dbDir)) {
    copyDir(dbDir, standaloneDbDir);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Step 9: Prepare node.exe for Windows
// ═══════════════════════════════════════════════════════════════════════════════
const nodeResourcesDir = path.join(ROOT, 'node-resources');
const nodeExePath = path.join(nodeResourcesDir, 'node.exe');

log('Step 9: Checking for node.exe...');
if (fs.existsSync(nodeExePath)) {
  const nodeSize = getFileSize(nodeExePath);
  success(`Step 9: node.exe already exists (${formatBytes(nodeSize)})`);
} else {
  log('Step 9: node.exe not found — attempting to download or copy...');

  let found = false;
  try {
    const nodePath = execSync('where node 2>nul || which node 2>/dev/null', { encoding: 'utf-8' }).trim().split('\n')[0];
    if (nodePath && fs.existsSync(nodePath)) {
      ensureDir(nodeResourcesDir);
      fs.copyFileSync(nodePath, nodeExePath);
      success(`Step 9: Copied Node.js from PATH: ${nodePath}`);
      found = true;
    }
  } catch {
    // Not found in PATH
  }

  if (!found) {
    const NODE_VERSION = '20.11.1';
    const NODE_URL = `https://nodejs.org/dist/v${NODE_VERSION}/win-x64/node.exe`;

    log(`Step 9: Downloading node.exe v${NODE_VERSION} for Windows x64...`);
    try {
      ensureDir(nodeResourcesDir);
      // Download synchronously (blocking) — this is a build script, must complete
      const downloadSync = () => {
        return new Promise((resolve, reject) => {
          downloadFile(NODE_URL, nodeExePath).then(resolve).catch(reject);
        });
      };
      downloadSync().then(() => {
        success('Step 9: node.exe downloaded successfully.');
      }).catch((err) => {
        warn(`Step 9: Failed to download node.exe: ${err.message}`);
        warn('You must manually place node.exe at node-resources/node.exe for Windows builds.');
      });
    } catch (err) {
      warn(`Step 9: Download setup failed: ${err.message}`);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Step 10: Verify Rust toolchain
// ═══════════════════════════════════════════════════════════════════════════════
log('Step 10: Verifying Rust toolchain...');
try {
  const rustcVersion = execSync('rustc --version', { encoding: 'utf-8' }).trim();
  const cargoVersion = execSync('cargo --version', { encoding: 'utf-8' }).trim();
  success(`Step 10: Rust — ${rustcVersion}`);
  success(`Step 10: Cargo — ${cargoVersion}`);
} catch {
  error('Step 10: Rust toolchain not found!');
  error('Tauri requires Rust to compile. Install it from https://rustup.rs/');
  error('After installing Rust, re-run this build script.');
  process.exit(1);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Step 11: Production Build Summary
// ═══════════════════════════════════════════════════════════════════════════════
const BUILD_DURATION = ((Date.now() - BUILD_START) / 1000).toFixed(1);

log('═══════════════════════════════════════════════════════════════════════');
success('Build preparation complete!');
log('');
log(`  📦 Standalone output: ${standaloneDir}`);
log(`  🚀 Server entry:      server.js (${formatBytes(serverJsSize)})`);
log(`  ⏱️  Build time:        ${BUILD_DURATION}s`);
log('');
log('  Architecture: Next.js Standalone + Tauri Desktop');
log('  Mode:        Production (self-contained)');
log('  Database:    SQLite (auto-migration on launch)');
log('  Runtime:     Node.js bundled (node.exe)');
log('');
log('  Next: Run `npm run tauri:build` to create the .exe installer');
log('═══════════════════════════════════════════════════════════════════════');
