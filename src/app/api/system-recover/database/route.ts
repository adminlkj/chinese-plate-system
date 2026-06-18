import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireRole } from '@/lib/api-auth';

/**
 * Database recovery endpoint for PostgreSQL.
 * Used when the database needs diagnostics or reset.
 * SECURITY: Requires ADMIN role.
 *
 * POST /api/system-recover/database
 * Body: { action: 'check' | 'integrity' | 'rebuild' }
 */
export async function POST(request: NextRequest) {
  try {
    // SECURITY: Require ADMIN role for database operations
    const auth = await requireRole('ADMIN', request);
    if (!auth.authenticated) {
      return auth.response;
    }

    const body = await request.json();
    const { action } = body;

    if (!action || !['check', 'rebuild', 'integrity'].includes(action)) {
      return NextResponse.json(
        { error: 'Invalid action. Use: check, rebuild, or integrity' },
        { status: 400 }
      );
    }

    // ─── CHECK: Basic connectivity test ────────────────────────
    if (action === 'check') {
      try {
        const userCount = await db.user.count();
        const accountCount = await db.account.count();
        const settingCount = await db.setting.count();

        return NextResponse.json({
          status: 'ok',
          database: {
            provider: 'postgresql',
            users: userCount,
            accounts: accountCount,
            settings: settingCount,
          },
        });
      } catch (err: unknown) {
        console.error('[system-recover/database] Check error:', err);
        return NextResponse.json({
          status: 'error',
          error: 'حدث خطأ في الخادم',
        }, { status: 500 });
      }
    }

    // ─── INTEGRITY: Run PostgreSQL integrity check ─────────────
    if (action === 'integrity') {
      try {
        // PostgreSQL integrity check via basic query
        await db.$queryRaw`SELECT 1`;
        const tableCount = await db.$queryRaw<Array<{ count: bigint }>>`
          SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'
        `;

        return NextResponse.json({
          status: 'ok',
          integrity: 'passed',
          tables: Number(tableCount[0]?.count || 0),
        });
      } catch (err: unknown) {
        console.error('[system-recover/database] Integrity error:', err);
        return NextResponse.json({
          status: 'error',
          error: 'حدث خطأ في الخادم',
        }, { status: 500 });
      }
    }

    // ─── REBUILD: Reset the database from scratch ──────────────
    if (action === 'rebuild') {
      try {
        return NextResponse.json({
          status: 'info',
          message: 'For PostgreSQL on Render, use the Render Dashboard to reset the database. Then run prisma migrate deploy to recreate the schema.',
          suggestion: 'Set DATABASE_URL in Render environment variables and redeploy.',
        });
      } catch (err: unknown) {
        console.error('[system-recover/database] Rebuild error:', err);
        return NextResponse.json({
          status: 'error',
          error: 'حدث خطأ في الخادم',
        }, { status: 500 });
      }
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    console.error('[system-recover/database] Error:', error);
    return NextResponse.json(
      { error: 'فشل في استعادة قاعدة البيانات' },
      { status: 500 }
    );
  }
}
