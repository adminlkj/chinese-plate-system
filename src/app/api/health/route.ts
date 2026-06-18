import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/api-auth';

/**
 * Health check endpoint — REQUIRES AUTHENTICATION
 *
 * SECURITY: Returns system health status for authenticated users only.
 * Unauthenticated requests get a simple 200/503 response.
 */
export async function GET(request: NextRequest) {
  // Simple health check without auth — for load balancers/monitoring
  const auth = await requireAuth(request);
  if (!auth.authenticated) {
    // Unauthenticated: return only basic status (for Render health check)
    try {
      await db.$queryRaw`SELECT 1`;
      return NextResponse.json({ status: 'ok' }, { status: 200 });
    } catch {
      return NextResponse.json({ status: 'error' }, { status: 503 });
    }
  }

  // Authenticated: return detailed health info
  const checks: Record<string, { status: string; details?: string }> = {};
  let overallStatus = 'ok';

  try {
    await db.$queryRaw`SELECT 1`;
    checks.database = { status: 'ok' };
  } catch (error: unknown) {
    checks.database = { status: 'error', details: 'Connection failed' };
    overallStatus = 'error';
  }

  try {
    const settingsCount = await db.setting.count();
    checks.settings = { status: 'ok', details: `${settingsCount} settings` };
  } catch {
    checks.settings = { status: 'error' };
  }

  try {
    const branchCount = await db.branch.count();
    checks.branches = { status: 'ok', details: `${branchCount} branches` };
  } catch {
    checks.branches = { status: 'error' };
  }

  try {
    const catCount = await db.productCategory.count();
    checks.categories = { status: 'ok', details: `${catCount} categories` };
  } catch {
    checks.categories = { status: 'error' };
  }

  try {
    const adminCount = await db.user.count({ where: { role: 'ADMIN' } });
    checks.adminUser = {
      status: adminCount > 0 ? 'ok' : 'warning',
      details: adminCount > 0 ? `${adminCount} admin users` : 'No admin user found'
    };
    if (adminCount === 0) overallStatus = 'degraded';
  } catch {
    checks.adminUser = { status: 'error' };
  }

  try {
    const accountCount = await db.account.count();
    checks.chartOfAccounts = {
      status: accountCount > 0 ? 'ok' : 'warning',
      details: accountCount > 0 ? `${accountCount} accounts` : 'No accounts found'
    };
    if (accountCount === 0 && overallStatus === 'ok') overallStatus = 'degraded';
  } catch {
    checks.chartOfAccounts = { status: 'error' };
  }

  // Don't expose DATABASE_URL — just indicate the provider type
  const dbUrl = process.env.DATABASE_URL || '';
  const isPostgreSQL = dbUrl.startsWith('postgresql://') || dbUrl.startsWith('postgres://');
  checks.dbProvider = { status: 'ok', details: isPostgreSQL ? 'PostgreSQL' : 'unknown' };

  return NextResponse.json({
    status: overallStatus,
    timestamp: new Date().toISOString(),
    checks,
  }, { status: overallStatus === 'error' ? 503 : 200 });
}
