# Migration Report — Chinese Plate System

## Tauri Desktop → Next.js Web Migration

**Date:** March 2026  
**Status:** Complete  

---

## Summary

The Chinese Plate System was migrated from a Tauri desktop application (SQLite + local file system) to a Next.js web application (PostgreSQL + server-hosted). This report documents what was changed, removed, and added during the migration.

---

## What Was Migrated

| Component | Before (Desktop) | After (Web) |
|-----------|-------------------|-------------|
| **Framework** | Tauri (Rust + WebView) | Next.js 16 (Node.js) |
| **Database** | SQLite (local `.db` file) | PostgreSQL (Render-managed) |
| **ORM** | Prisma (SQLite provider) | Prisma (PostgreSQL provider) |
| **Auth** | None / local-only | NextAuth v4 (JWT-based, credentials provider) |
| **API Layer** | Tauri IPC commands | Next.js API Routes (`/api/...`) |
| **File System** | Direct `fs` access via Tauri | Server-only (no client file system access) |
| **Export/Import** | SQLite `.db` file copy | JSON export/import via API (version `2.0.0`, format `postgresql-json`) |
| **Backups** | Local `.db` file backup | Auto-backup via API (audit-logged, server-side JSON) |
| **Deployment** | Desktop installer (`.msi`/`.dmg`) | Render (cloud PaaS, Docker-based) |
| **Sessions** | None (single-user desktop) | JWT sessions (24-hour expiry, httpOnly cookies) |

### Core Features Retained

All business logic was preserved during migration:

- Chart of Accounts (hierarchical, multi-branch)
- Double-entry bookkeeping (journal entries, general ledger)
- Trial Balance, Income Statement, Cash Flow
- POS (Point of Sale) with table management
- Invoicing (create, finalize, returns, payments)
- Inventory management (stock takes, stock transfers)
- Customer and Supplier management
- Shift management (open/close with cash reconciliation)
- Multi-branch support with branch-level access control
- VAT handling and quarterly reports
- Audit logging
- Settings (company info, fiscal periods, currencies)
- User management with granular permissions
- Dashboard with KPIs

---

## What Was Removed

### Desktop Infrastructure

| Item | Reason |
|------|--------|
| `src-tauri/` directory | Tauri Rust backend — replaced by Next.js API routes |
| `src-tauri/Cargo.toml` | Rust dependencies — no longer needed |
| `src-tauri/src/` | Rust IPC handlers — replaced by `/api/` routes |
| Electron references | Hybrid Electron/Tauri support — web-only now |
| `.bat` launch scripts | Desktop-specific startup scripts |
| `dist-electron/` | Electron build output |
| `download/` | Desktop download assets |
| `Release/` and `Release_Source/` | Desktop release artifacts |
| `node-resources/` | Desktop resource bundling |

### Database & Storage

| Item | Reason |
|------|--------|
| SQLite `PRAGMA` statements | PostgreSQL doesn't use PRAGMAs |
| `process.cwd()` for DB path | No local file system access in web deployment |
| `.db` file backup/restore | Replaced by JSON export/import API |
| Local file system writes | Web apps cannot write to client file system |

### APIs & Libraries

| Item | Reason |
|------|--------|
| `window.__TAURI_API__` | Tauri-specific global — no desktop runtime |
| `isTauri` / `isTauriApp` / `isElectronApp` helpers | Replaced by `isWeb` flag |
| `fs` / `path` / `writeFile` / `readFile` in `src/` | No direct file system access in browser |
| `react-to-print` | Removed during TypeScript fix — print handled differently |
| `@mdxeditor/editor` | Unused dependency |
| `@reactuses/core` | Unused dependency |
| `react-markdown` | Unused dependency |
| `react-syntax-highlighter` | Unused dependency |
| `next-intl` | Unused dependency — custom i18n used instead |

---

## What Was Changed

### Authentication System

**Before:** No authentication. The desktop app was single-user with direct database access.

**After:** Full authentication system with:
- NextAuth v4 with Credentials provider
- JWT-based sessions (24-hour expiry)
- bcrypt password hashing (10-12 salt rounds)
- 4-role hierarchy: ADMIN → MANAGER → CASHIER → VIEWER
- 3-layer permission architecture:
  - Layer 1: Explicit user permissions (screen → access level)
  - Layer 2: Context permissions (POS context grants READ access to products/customers)
  - Layer 3: Business rules (branch access, shift status)
- First-run admin seeding secured with `ADMIN_SEED_TOKEN` (constant-time comparison)
- Rate limiting on auth endpoints (5 login attempts/minute per IP)

### Database

**Before:** SQLite with local `.db` file.

**After:** PostgreSQL with:
- Connection via `DATABASE_URL` environment variable
- Build-safe Prisma client (proxy during build phase, real client at runtime)
- Proper indexes on all frequently-queried columns
- `Decimal(15,2)` for all monetary fields
- Foreign key constraints with appropriate cascade rules
- Prisma migrations for schema versioning

### Export/Import

**Before:** Copy the SQLite `.db` file; restore by overwriting.

**After:** JSON-based export/import:
- Export: `GET /api/data/export` → JSON file download (admin-only)
- Import: `POST /api/data/import` → JSON file upload (admin-only)
- Backup format version `2.0.0` with `postgresql-json` format indicator
- Password hashes excluded from export for security
- File size validation (50MB max)
- Transaction-based restore respecting foreign key order
- Audit logging of all backup operations

### Backups

**Before:** Automatic local file backup of `.db` file with configurable retention.

**After:** Server-side auto-backup with:
- Backup settings stored in database (`auto_backup_*` settings keys)
- Backup history tracked via audit log (`EXPORT` action on `BACKUP` entity)
- Manual backup trigger via API
- Configurable interval (1-720 hours) and retention (1-30 copies)
- No local file system access — backups are server-side JSON exports

### Settings Screen

- `.db` file accept pattern changed from `.db` to `.json`
- Backup file extension changed from `.db` to `.json`
- Database info section now shows "PostgreSQL configured" status instead of SQLite file size
- Supervisor password is never exposed to the client (masked as `••••`)

---

## Security Hardening Applied

### Authentication & Authorization

1. **JWT Sessions**: Secure, httpOnly cookies with `sameSite: lax` and `secure` flag in production
2. **Password Hashing**: bcrypt with 10-12 salt rounds
3. **First-Run Security**: `ADMIN_SEED_TOKEN` with constant-time comparison (`crypto.timingSafeEqual`) prevents timing attacks
4. **Rate Limiting**: In-memory rate limiter on auth endpoints (5 req/min login, 3 req/min setup)
5. **3-Layer Permissions**: Explicit → Context → Business Rules, preventing permission escalation

### HTTP Security Headers (Middleware)

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `X-XSS-Protection: 1; mode=block`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`
- Content Security Policy (CSP):
  - `default-src 'self'`
  - `script-src 'self' 'unsafe-inline'` (required by Next.js)
  - `style-src 'self' 'unsafe-inline'` (required by Tailwind)
  - `img-src 'self' data: blob:`
  - `connect-src 'self'`
  - `frame-ancestors 'none'`

### API Security

- All mutating API routes require authentication (`requireAuth` / `requireRole`)
- Write operations require explicit permission check (`checkWriteAccess`)
- Input sanitization (`sanitizeHtml`, `sanitizeInput`) for XSS prevention
- Page size validation (`safePageSize`) to prevent DoS
- Password hashes excluded from data export
- Admin seed endpoints disabled after first admin exists (403 response)

### Next.js Configuration

- `reactStrictMode: false` (intentional — avoids double-render issues with complex state)
- API response headers: `Cache-Control: no-store, no-cache, must-revalidate`
- Images: `unoptimized: true` (simplifies deployment, no image optimization server needed)

---

## Performance Optimizations Applied

1. **Database Indexes**: All frequently-queried columns indexed (date, branch, status, foreign keys, composite indexes for date+branch queries)
2. **Prisma Client Singleton**: Single PrismaClient instance cached in `globalThis` during development (prevents hot-reload connection leaks)
3. **Build-Safe Proxy**: During `next build`, a no-op proxy prevents database connection attempts when `DATABASE_URL` isn't available
4. **Connection Pooling**: PostgreSQL connection managed by Prisma with appropriate pool settings for Render
5. **API Caching**: All API responses have `no-store` headers to prevent stale data in accounting system
6. **Optimized Queries**: Selective field inclusion (e.g., user export excludes password hashes; health check uses lightweight `SELECT 1`)
7. **Framer Motion Types**: Custom type augmentation (`src/types/framer-motion.d.ts`) applied via postinstall script, avoiding build-time type errors without runtime overhead

---

## Production Audit (Phase 2 — March 2026)

### Security Fixes Applied

| Issue | Severity | Fix |
|-------|----------|-----|
| Hardcoded admin credentials in `/api/system-recover` | CRITICAL | Now uses `DEFAULT_ADMIN_EMAIL`/`DEFAULT_ADMIN_PASSWORD` env vars; random password fallback; credentials no longer exposed in API response |
| Dev-mode auth bypass in `/api/admin/seed` and `/api/auth/ensure-admin` | CRITICAL | `ADMIN_SEED_TOKEN` now required in ALL environments (not just production) |
| Setup endpoint weak validation | CRITICAL | Added email format validation, min 8-char password, `sanitizeInput()` on all text inputs |
| Error message info leaks across 6 API routes | HIGH | Replaced `error.message` with generic Arabic error; server-side `console.error` retained |
| JWT secret non-null assertion | HIGH | Explicit null check for `NEXTAUTH_SECRET` before JWT encoding |
| `$executeRawUnsafe` SQL injection risk | MEDIUM | Replaced with `$executeRaw` tagged template literals in import/purge routes |

### Performance Fixes Applied

| Issue | Severity | Fix |
|-------|----------|-----|
| Sales Report unbounded query | CRITICAL | Added pagination (`page`/`take` params); summary/totals use aggregate, invoice list is paginated |
| POS Products no pagination | HIGH | Added `page`/`take` params (default 200); response includes `totalCount` |
| POS Categories nested include | HIGH | Added `summary=true` param using `_count`; default mode applies `take` limit on nested products |
| POS Invoices N+1 product lookup | HIGH | Batch product lookup via `findMany({ where: { id: { in: pids } } })` + Map |
| Transactions API deep nested include | HIGH | List view uses `_count` instead of full `lines: { include: { account: true } }` |

### Prisma Schema Indexes Added

| Model | Index | Purpose |
|-------|-------|---------|
| POSInvoice | `@@index([status, branch, createdAt])` | Sales report queries |
| POSInvoice | `@@index([customerId])` | Customer invoice queries |
| POSInvoice | `@@index([isReturn, createdAt])` | Return report queries |
| JournalLine | `@@index([accountId, journalEntryId])` | Aggregate join queries |
| Account | `@@index([type, isActive])` | Income statement queries |
| Transaction | `@@index([type, status])` | Dashboard expense queries |
| StockTransaction | `@@index([branch, type, createdAt])` | Stock reports |

### Files Removed

| File | Reason |
|------|--------|
| `src/lib/tauri-api.ts` | Dead code — Tauri desktop API stubs, not imported anywhere |
| `src/lib/database-path.ts` | Desktop remnant — inlined into `admin/diagnostics/route.ts` |

---

## Known Limitations

1. **In-Memory Rate Limiting**: The current rate limiter uses in-memory storage. On Render, this resets when the service restarts/spins down. For production with multiple instances, a Redis-backed store would be needed.

2. **Auto-Backup Execution**: The auto-backup feature stores settings and tracks backup history, but automated scheduled execution requires an external cron job or Render Cron Job to call `/api/data/auto-backup/execute`. The interval settings are advisory only without an external scheduler.

3. **File Uploads**: Images (logos, currency symbols) are stored as base64 in the `Setting` table. For large-scale use, an object storage service (S3, Cloudflare R2) would be more appropriate.

4. **Single Instance**: Render's Starter plan runs a single instance. The application is not designed for horizontal scaling with sticky sessions — the in-memory rate limiter and session state would need external stores for multi-instance deployment.

5. **Cold Starts**: On the Starter plan, the service spins down after 15 minutes of inactivity. The first request after spin-down takes 10-30 seconds. This is a Render platform limitation, not an application issue.

6. **No Offline Mode**: Unlike the desktop Tauri app, the web version requires an internet connection to the server. There is no offline capability or local data caching.

7. **Print/PDF Export**: The `react-to-print` library was removed during the migration. Receipt printing is handled via browser print dialog with the receipt HTML preview. Direct PDF generation would require a server-side PDF library.

8. **Database Migrations**: Schema changes require running `npx prisma migrate deploy` on the server. Render's `startCommand` handles this automatically, but manual intervention may be needed for complex migrations that require data transformation.

9. **Session Management**: JWT sessions have a fixed 24-hour expiry. There is no "remember me" feature or configurable session duration per user.

10. **No WebSocket/Real-Time**: The application uses standard HTTP request/response. Real-time features (e.g., live POS updates across terminals) would require WebSocket integration (examples provided in `examples/websocket/` but not production-integrated).
