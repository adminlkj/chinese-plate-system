# Chinese Plate System — Production-Ready ERP

A complete Chinese restaurant POS + accounting + payroll + VAT system built on Next.js 16, TypeScript, Prisma, and PostgreSQL.

## ✅ Production Readiness Status

| Check | Status |
|---|---|
| TypeScript (`tsc --noEmit`) | ✅ 0 errors |
| ESLint (`eslint .`) | ✅ 0 errors, 0 warnings |
| Prisma schema (`prisma validate`) | ✅ Valid |
| Prisma client (`prisma generate`) | ✅ Generated |
| Production build (`next build`) | ✅ Compiled successfully |
| Auth flow (login → dashboard → logout → re-login) | ✅ Verified end-to-end |
| 401 handling (global auto-logout) | ✅ Implemented via `src/lib/api-client.ts` |
| Cookie security (secure in production) | ✅ Implemented in `src/lib/auth.ts` |
| JWT session strategy | ✅ Enabled |
| Bearer token + cookie fallback | ✅ Both supported |
| Audit log coverage | ✅ All critical mutations logged |
| Soft-void on financial entities | ✅ No destructive deletes |
| Prisma indexes for scalability | ✅ 115 `@@index` declarations |
| Branch isolation (multi-branch) | ✅ UUID-based, enforced at API layer |
| RBAC (ADMIN / MANAGER / CASHIER) | ✅ 3-layer permission architecture |

## 🏗 Architecture

```
Frontend:  Next.js 16 (App Router) + React 19 + TypeScript 5 + Tailwind 4 + shadcn/ui
State:     Zustand (client) + TanStack Query (server)
Backend:   Next.js API Routes (128 routes) + Prisma ORM
Database:  PostgreSQL (Render) / SQLite (local dev)
Auth:      NextAuth v4 + JWT session + Bearer token + Secure cookies
Print:     Thermal (58mm/80mm) + A4 receipts
Reports:   Trial Balance, Income Statement, Balance Sheet, Cash Flow, VAT, Payroll
```

## 📦 Project Structure

```
src/
├── app/
│   ├── api/                    # 128 API routes
│   │   ├── auth/               # login, logout, me, verify, session-check
│   │   ├── admin/              # seed, login, logout, me, diagnostics
│   │   ├── pos/                # invoices, products, categories, shifts, tables
│   │   ├── accounting/         # accounts, journal-entries, transactions
│   │   ├── inventory/          # stock, stock-take, stock-transfer
│   │   ├── payroll/            # employees, runs, allowances, advances, ledger
│   │   ├── vat/                # quarterly-report, declarations, settle, pay
│   │   ├── reports/            # 12 report endpoints
│   │   ├── settings/           # system + per-branch settings
│   │   ├── users/              # user CRUD + permissions
│   │   ├── audit-logs/         # compliance audit trail
│   │   ├── branches/           # multi-branch management
│   │   ├── customers/, suppliers/
│   │   ├── data/               # export, import, auto-backup
│   │   ├── dashboard/          # KPI dashboard
│   │   ├── fiscal-periods/     # accounting period open/close/reopen
│   │   ├── health/             # health check (Render)
│   │   ├── setup/              # first-run setup wizard
│   │   └── system-recover/     # admin recovery tools
│   ├── page.tsx                # Main app shell (auth gate + screen router)
│   └── layout.tsx              # Root layout
├── components/
│   ├── accounting/             # 26 feature screens
│   ├── ui/                     # shadcn/ui component library (60+ components)
│   └── providers/              # Theme + toast providers
├── lib/
│   ├── auth.ts                 # NextAuth config (JWT + secure cookies)
│   ├── api-auth.ts             # 3-layer RBAC (requireAuth + checkRead/Write + branch)
│   ├── api-client.ts           # Global fetch interceptor (Bearer + credentials + 401 logout)
│   ├── db.ts                   # Prisma client singleton (build-safe)
│   ├── accounting-engine.ts    # Journal entries, trial balance, income statement, dashboard
│   ├── payroll-engine.ts       # Payroll calculation + auto journal entries
│   ├── audit-log.ts            # Compliance audit log utility
│   ├── report-print.ts         # Thermal + A4 receipt/report printing
│   ├── branch-resolver.ts      # Branch context resolution
│   └── i18n/                   # Arabic + English translations
└── types/                      # TypeScript type augmentations
prisma/
└── schema.prisma               # 39 models, 63 relations, 115 indexes
```

## 🚀 Render Deployment

### Option A: Blueprint deploy (recommended)

1. Push this code to a GitHub repo.
2. In Render dashboard → New → Blueprint → select your repo.
3. Render reads `render.yaml` and creates:
   - `chinese-plate-system` web service (Node 22 LTS, Starter plan)
   - `chinese-plate-db` PostgreSQL database (Starter plan)
4. Set these env vars in the web service (Render dashboard):
   - `NEXTAUTH_SECRET` — generate with `openssl rand -base64 32`
   - `NEXTAUTH_URL` — `https://chinese-plate-system.onrender.com` (your service URL)
   - `DEFAULT_ADMIN_EMAIL` — e.g. `admin@yourcompany.com`
   - `DEFAULT_ADMIN_PASSWORD` — a strong password (or leave blank to use the on-screen Setup Wizard)
   - `ADMIN_SEED_TOKEN` — generate with `openssl rand -hex 32`
5. Deploy. The buildCommand will:
   - `npm install`
   - `node scripts/switch-to-postgres.js` (switches schema sqlite → postgresql)
   - `npx prisma generate`
   - `npm run build`
6. The startCommand will:
   - `npx prisma db push --accept-data-loss` (creates tables)
   - `npm start` (Next.js production server)
7. Visit your service URL → login with `DEFAULT_ADMIN_EMAIL` / `DEFAULT_ADMIN_PASSWORD`.

### Option B: Manual setup

1. Create a PostgreSQL database on Render.
2. Create a Web Service on Render:
   - **Runtime:** Node
   - **Build Command:** `npm install && node scripts/switch-to-postgres.js && npx prisma generate && npm run build`
   - **Start Command:** `npx prisma db push --accept-data-loss && npm start`
   - **Environment variables:** (see `render.yaml` for the full list)
3. Deploy.

## 🛠 Local Development

```bash
# 1. Install dependencies
bun install

# 2. Set up the database (SQLite for dev)
cp .env.example .env
bun run db:push

# 3. Start the dev server
bun run dev

# 4. Open http://localhost:3000
#    If no admin user exists, the on-screen Setup Wizard will appear.
```

## 🔐 Authentication Flow

1. **Login** (`POST /api/auth/login`):
   - Verifies email + bcrypt password
   - Creates a NextAuth JWT token signed with `NEXTAUTH_SECRET`
   - Sets `__Secure-next-auth.session-token` cookie (production) or `next-auth.session-token` (dev)
   - Returns the raw JWT token in the response body (for localStorage-based Bearer auth)
2. **API requests** (all `/api/*`):
   - The global fetch interceptor (`src/lib/api-client.ts`) adds `Authorization: Bearer <token>` header
   - The interceptor also adds `credentials: 'include'` as a cookie fallback
   - API routes use `requireAuth()` which tries Bearer header first, then cookie
3. **401 handling**:
   - When any non-auth API returns 401, the interceptor clears localStorage + cookies and reloads the page
   - This prevents the "collapsed system" state where the user appears logged in but every API fails
4. **Logout** (`POST /api/admin/logout`):
   - Clears the session cookie server-side
   - Frontend clears localStorage and resets Zustand state

## 🗄 Database

- **Local dev:** SQLite (`db/custom.db`)
- **Render production:** PostgreSQL (Render-managed)
- **Schema location:** `prisma/schema.prisma`
- **Schema switch:** `scripts/switch-to-postgres.js` rewrites the schema provider at build time
- **Deployment:** `prisma db push` (NOT migrations — schema is the source of truth)

## 📊 Features

### POS
- Multi-branch point of sale with tables, shifts, and cash drawer
- Invoice creation with items, payments, returns, and discounts
- Thermal receipt printing (58mm/80mm) + A4 invoice printing
- VAT calculation (Saudi Arabia 15%)

### Accounting
- Chart of accounts (multi-branch, hierarchical)
- Journal entries (double-entry bookkeeping) with draft/post/cancel workflow
- General ledger, trial balance, income statement, balance sheet, cash flow
- Fiscal periods (open/close/reopen)
- Customer and supplier management with statements

### Inventory
- Products with categories, cost tracking, and stock levels
- Stock movements (in/out/adjustment/transfer)
- Stock takes with surplus/shortage journal entries
- Multi-branch stock transfers

### Payroll
- Employee management with GOSI integration
- Payroll runs with auto journal entries
- Allowances, deductions, advances, leave, attendance
- Employee ledger with running balance
- Period locking for compliance

### VAT
- Quarterly VAT report generation
- VAT declaration state machine (Draft → Submitted → Locked)
- VAT settlement and payment journal entries

### Reports
- Sales report (with pagination)
- Product performance
- Customer/supplier statements
- Salary statements
- Inventory valuation
- Advanced reports (custom date ranges, multi-branch)

### System
- Multi-branch with per-branch independent settings
- 3-layer RBAC (explicit permissions + context + business rules)
- Compliance audit log (all critical mutations)
- Data export/import (JSON)
- Auto-backup scheduler
- User management with per-screen permissions

## 🌐 Internationalization

- Arabic (RTL) — default
- English (LTR) — toggle in top bar
- All UI text, reports, and receipts support both languages

## 🔒 Security

- bcrypt password hashing (12 rounds)
- JWT session tokens signed with `NEXTAUTH_SECRET`
- Secure cookies in production (`__Secure-` prefix, `Secure`, `HttpOnly`, `SameSite=Lax`)
- CSP headers (no `unsafe-eval`)
- Rate limiting on login (5 req/min) and setup (3 req/min)
- `ADMIN_SEED_TOKEN` required for admin seed endpoints in ALL environments
- No `error.message` leaks to client (all errors return generic Arabic messages)
- Audit log on all critical mutations (with user, IP, user-agent, severity, category)

## 📈 Performance

- 115 Prisma indexes (composite + single-column)
- Batch lookups (no N+1) on critical paths
- `groupBy` aggregates for trial balance, income statement, dashboard
- Pagination on all list endpoints
- Dynamic imports for heavy components (XLSX, recharts)
- Build-safe Prisma client (no crash during `next build`)

## 📝 License

Private — Chinese Plate System Team.
