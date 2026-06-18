# Deployment Guide — Chinese Plate System

This guide covers deploying the Chinese Plate System to [Render](https://render.com).

---

## Prerequisites

- A [Render](https://render.com) account (free tier works for the database; Starter plan recommended for the web service)
- Git repository with the project pushed (Render deploys from Git)
- Node.js >= 18.0.0 (for local development/testing)
- PostgreSQL client (optional, for local development)

---

## Render Deployment Steps

### 1. Push to Git

Ensure your project is committed and pushed to a Git repository (GitHub, GitLab, etc.) that Render can access.

### 2. Create a New Render Blueprint

1. Go to the [Render Dashboard](https://dashboard.render.com)
2. Click **New** → **Blueprint**
3. Connect your Git repository
4. Render will detect `render.yaml` at the project root and propose the services defined in it

### 3. Review the Blueprint

The `render.yaml` defines two services:

| Service | Type | Plan | Purpose |
|---------|------|------|---------|
| `chinese-plate-system` | Web Service | Starter | Next.js application |
| `chinese-plate-db` | PostgreSQL | Starter | Database |

Verify the proposed configuration matches your needs, then click **Apply**.

### 4. Configure Environment Variables

After the blueprint is applied, review the environment variables in the Render Dashboard for the web service. The following are set automatically by `render.yaml`:

| Variable | Source | Description |
|----------|--------|-------------|
| `NODE_ENV` | Static: `production` | Application environment |
| `DATABASE_URL` | From `chinese-plate-db` | PostgreSQL connection string (auto-linked) |
| `NEXTAUTH_SECRET` | Auto-generated | JWT signing secret |
| `NEXTAUTH_URL` | From web service | Public URL of the app |
| `DEFAULT_ADMIN_EMAIL` | Static: `admin@example.com` | Default admin email for first-run |
| `DEFAULT_ADMIN_PASSWORD` | Auto-generated | Default admin password for first-run |
| `ADMIN_SEED_TOKEN` | Auto-generated | Cryptographic token for first-run auto-login |
| `PORT` | Static: `10000` | Application port |

> **Important:** After the first deploy, note the auto-generated values for `DEFAULT_ADMIN_PASSWORD` and `ADMIN_SEED_TOKEN` from the Render Dashboard. You will need these for the first-run setup.

### 5. First Deploy

Render will automatically:
1. Install dependencies (`npm install`)
2. Generate the Prisma client (`npx prisma generate`)
3. Build the Next.js app (`npm run build`)
4. Run database migrations (`npx prisma migrate deploy`)
5. Start the application (`npm start`)

The first deploy typically takes 3-5 minutes.

---

## Environment Variables Reference

### Required Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string. Auto-provisioned by Render when linked to the database service. |
| `NEXTAUTH_SECRET` | Yes | Secret key for JWT token signing. Minimum 32 characters. Generate with `openssl rand -base64 32`. |
| `NEXTAUTH_URL` | Yes | Public URL of the application. Render auto-fills this from the web service URL. |
| `DEFAULT_ADMIN_PASSWORD` | Yes | Password for the initial admin user. Must be set before first deploy. |
| `ADMIN_SEED_TOKEN` | Yes (production) | Cryptographic token securing the first-run admin seed endpoint. Generate with `openssl rand -hex 32`. |

### Optional Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | `development` | Application environment. Set to `production` on Render. |
| `DEFAULT_ADMIN_EMAIL` | `admin@example.com` | Email for the initial admin user. |
| `PORT` | `3000` (local) / `10000` (Render) | Application listening port. Render provides this automatically. |

---

## First-Run Setup (Admin Credentials)

When the application starts for the first time with an empty database:

1. **Database migrations** run automatically via `npx prisma migrate deploy`
2. **No admin user exists** yet — the login page will appear

### Creating the Initial Admin User

There are two ways to create the first admin:

#### Option A: Via the Admin Seed API (Recommended for Render)

```bash
# Replace with your actual Render URL and the ADMIN_SEED_TOKEN from the dashboard
curl -X POST https://your-app.onrender.com/api/admin/seed \
  -H "Content-Type: application/json" \
  -d '{"seedToken": "YOUR_ADMIN_SEED_TOKEN_HERE"}'
```

This creates an admin user using `DEFAULT_ADMIN_EMAIL` and `DEFAULT_ADMIN_PASSWORD` from the environment variables.

#### Option B: Via the Auto-Login API

```bash
# Replace with your actual Render URL and the ADMIN_SEED_TOKEN
curl -X POST https://your-app.onrender.com/api/auth/auto-login \
  -H "Content-Type: application/json" \
  -d '{"seedToken": "YOUR_ADMIN_SEED_TOKEN_HERE"}'
```

This creates the admin user AND returns a JWT token for immediate login.

### After First Admin Creation

- The seed and auto-login endpoints **return 403** after an admin user exists
- Subsequent users must be created through the application's Users & Permissions screen
- **Change the default admin password** immediately after first login via Settings

### Default Admin Credentials

| Field | Value |
|-------|-------|
| Email | `DEFAULT_ADMIN_EMAIL` env var (defaults to `admin@example.com`) |
| Password | `DEFAULT_ADMIN_PASSWORD` env var (auto-generated on Render) |
| Role | ADMIN (full access to all screens) |

> **Security Warning:** Retrieve the auto-generated password from the Render Dashboard → Environment tab. Change it immediately after first login.

---

## Post-Deployment Verification

After the deployment completes:

### 1. Health Check

```bash
curl https://your-app.onrender.com/api/health
```

Expected response (unauthenticated):
```json
{ "status": "ok" }
```

If you get `503` or `{ "status": "error" }`, the database connection has failed — check `DATABASE_URL`.

### 2. Application Load

Open `https://your-app.onrender.com` in a browser. You should see the login page.

### 3. Admin Login

Log in with the admin credentials (see First-Run Setup above).

### 4. Dashboard Verification

After login, verify:
- Dashboard loads with no errors
- Chart of Accounts screen is accessible
- POS screen is accessible
- Settings screen shows PostgreSQL as the database provider

### 5. Create Additional Users

Go to Users & Permissions and create at least one additional user with restricted permissions. This confirms the permission system is working.

---

## Troubleshooting Common Issues

### Build Fails: `prisma generate` Error

**Symptom:** Build log shows `PrismaClient could not be generated`.

**Fix:**
- Ensure `prisma/schema.prisma` is committed to the repository
- Verify the `buildCommand` in `render.yaml` includes `npx prisma generate`
- Check that `@prisma/client` is in `package.json` dependencies

### Build Fails: TypeScript Errors

**Symptom:** `next build` fails with TypeScript type errors.

**Fix:**
- Run `npx tsc --noEmit` locally to reproduce
- The project includes a `postinstall` script that patches framer-motion types
- If custom type errors appear, check `src/types/framer-motion.d.ts` exists

### Start Fails: `DATABASE_URL` Not Set

**Symptom:** Application crashes on start with database connection error.

**Fix:**
- In the Render Dashboard, verify the web service has `DATABASE_URL` linked to the PostgreSQL database
- The `render.yaml` uses `fromDatabase` to auto-link — ensure the database name matches (`chinese-plate-db`)

### Start Fails: Migration Error

**Symptom:** `npx prisma migrate deploy` fails with migration errors.

**Fix:**
- Ensure `prisma/migrations/` directory is committed to the repository
- If the database already has conflicting data, you may need to reset: `npx prisma migrate reset` (⚠️ destroys data)
- Check that the PostgreSQL plan has sufficient capacity

### Health Check Returns 503

**Symptom:** Render marks the service as unhealthy; `/api/health` returns 503.

**Fix:**
- The health check endpoint tests the database connection with `SELECT 1`
- Verify `DATABASE_URL` is correct and the PostgreSQL instance is running
- Check Render logs for connection timeout errors
- Ensure the database is in the same region as the web service

### Login Returns 401

**Symptom:** Cannot log in even with correct credentials.

**Fix:**
- Verify `NEXTAUTH_SECRET` is set (auto-generated by `render.yaml`)
- Verify `NEXTAUTH_URL` matches your actual app URL (auto-linked by `render.yaml`)
- If you changed the app URL (custom domain), update `NEXTAUTH_URL` manually
- Clear browser cookies and try again

### Admin Seed Returns 403

**Symptom:** `/api/admin/seed` or `/api/auth/auto-login` returns 403.

**Possible causes:**
1. **Admin already exists:** These endpoints only work when no admin exists. If an admin was already created, they return 403 by design.
2. **`ADMIN_SEED_TOKEN` not set:** The env var must be configured in production.
3. **Wrong token:** The `seedToken` in the request body must exactly match the `ADMIN_SEED_TOKEN` env var.

### Application Is Slow on First Request

**Symptom:** First page load takes 10-30 seconds.

**Cause:** Render's Starter plan spins down after 15 minutes of inactivity. The first request after spin-down triggers a cold start.

**Fix:** This is expected behavior on the Starter plan. Upgrade to a paid plan for always-on instances, or use a cron job to ping the health check endpoint periodically.

### Rate Limiting (429 Errors)

**Symptom:** API requests return `429 Too Many Requests`.

**Cause:** The application has built-in rate limiting on authentication endpoints:
- Login: 5 requests/minute per IP
- Admin login: 5 requests/minute per IP
- Setup: 3 requests/minute per IP

**Fix:** Wait 60 seconds and retry. If you need higher limits for legitimate use, modify the rate limits in `src/middleware.ts`.

### Custom Domain Setup

1. In the Render Dashboard, go to your web service → Settings
2. Add your custom domain
3. Render will provide a CNAME record to add to your DNS
4. **Important:** Update the `NEXTAUTH_URL` environment variable to your custom domain URL
5. Redeploy for the change to take effect

---

## Local Development

For local development with PostgreSQL:

```bash
# 1. Copy environment file
cp .env.example .env

# 2. Edit .env with your local PostgreSQL connection
# DATABASE_URL="postgresql://user:password@localhost:5432/chinese_plate"

# 3. Run migrations
npx prisma migrate dev

# 4. Start development server
npm run dev
```

The application will be available at `http://localhost:3000`.
