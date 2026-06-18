/**
 * start-server.js — Production Server Wrapper
 *
 * This script runs BEFORE starting the Next.js standalone server.
 * It ensures the database schema is up to date by running prisma db push.
 *
 * Flow:
 * 1. Read DATABASE_URL from environment (set by lib.rs)
 * 2. Read PRISMA_SCHEMA_PATH from environment (set by lib.rs)
 * 3. Run prisma db push to create/update tables
 * 4. Start the Next.js server (require server.js)
 *
 * This file lives in .next/standalone/ alongside server.js.
 * lib.rs spawns: node start-server.js (instead of node server.js)
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const DB_URL = process.env.DATABASE_URL || '';
const SCHEMA_PATH = process.env.PRISMA_SCHEMA_PATH || '';

console.log('[start-server] Initializing...');
console.log('[start-server] DATABASE_URL:', DB_URL ? DB_URL.substring(0, 50) + '...' : '(not set)');
console.log('[start-server] PRISMA_SCHEMA_PATH:', SCHEMA_PATH || '(not set)');
console.log('[start-server] CWD:', process.cwd());

// ── Step 1: Run Prisma schema push (if schema is available) ──────────────────
if (SCHEMA_PATH && fs.existsSync(SCHEMA_PATH)) {
  console.log('[start-server] Running prisma db push...');

  try {
    // Find the bundled prisma CLI
    const prismaCliPath = path.join(__dirname, 'node_modules', 'prisma', 'build', 'index.js');

    if (fs.existsSync(prismaCliPath)) {
      execSync(`node "${prismaCliPath}" db push --schema="${SCHEMA_PATH}" --accept-data-loss`, {
        stdio: 'inherit',
        env: {
          ...process.env,
          DATABASE_URL: DB_URL,
        },
        timeout: 30000, // 30 second timeout
      });
      console.log('[start-server] Prisma db push completed.');
    } else {
      console.warn('[start-server] Prisma CLI not found at', prismaCliPath);
      console.warn('[start-server] Skipping schema push. Tables should already exist from seed DB.');
    }
  } catch (err) {
    console.error('[start-server] Prisma db push failed:', err.message);
    console.warn('[start-server] Continuing anyway — tables may already exist.');
  }
} else {
  console.warn('[start-server] No PRISMA_SCHEMA_PATH set or file not found.');
  console.warn('[start-server] Skipping schema push. Tables should already exist from seed DB.');
}

// ── Step 2: Verify DATABASE_URL points to an accessible file ──────────────────
if (DB_URL) {
  const dbFilePath = DB_URL.replace(/^file:/, '').replace(/\\/g, '/');
  if (fs.existsSync(dbFilePath)) {
    const stats = fs.statSync(dbFilePath);
    console.log('[start-server] Database file verified:', dbFilePath, '(' + stats.size + ' bytes)');
  } else {
    console.warn('[start-server] WARNING: Database file not found:', dbFilePath);
    console.warn('[start-server] The server may fail with Prisma Error 14.');
    // Try to create the directory and an empty file
    const dbDir = path.dirname(dbFilePath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
      console.log('[start-server] Created database directory:', dbDir);
    }
    if (!fs.existsSync(dbFilePath)) {
      fs.writeFileSync(dbFilePath, '');
      console.log('[start-server] Created empty database file:', dbFilePath);
    }
  }
} else {
  console.warn('[start-server] WARNING: DATABASE_URL not set!');
}

// ── Step 3: Start the Next.js server ─────────────────────────────────────────
console.log('[start-server] Starting Next.js server...');
try {
  require('./server.js');
} catch (err) {
  console.error('[start-server] Failed to start server:', err.message);
  process.exit(1);
}
