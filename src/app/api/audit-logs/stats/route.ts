import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireRole } from '@/lib/api-auth';

// GET /api/audit-logs/stats - Get audit log statistics
export async function GET(request: NextRequest) {
  try {
    const auth = await requireRole('MANAGER', request);
    if (!auth.authenticated) return auth.response;

    const { searchParams } = new URL(request.url);
    const days = parseInt(searchParams.get('days') || '30');

    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - days);

    const [totalEvents, criticalEvents, warningEvents, recentActivity] = await Promise.all([
      // Total events in the period
      db.auditLog.count({
        where: { createdAt: { gte: sinceDate } },
      }),
      // Critical events
      db.auditLog.count({
        where: {
          createdAt: { gte: sinceDate },
          severity: 'CRITICAL',
        },
      }),
      // Warning events
      db.auditLog.count({
        where: {
          createdAt: { gte: sinceDate },
          severity: 'WARNING',
        },
      }),
      // Recent activity (last 24 hours)
      db.auditLog.count({
        where: {
          createdAt: {
            gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
          },
        },
      }),
    ]);

    return NextResponse.json({
      totalEvents,
      criticalEvents,
      warningEvents,
      recentActivity,
    });
  } catch (error: any) {
    console.error('[audit-logs/stats] Error fetching stats:', error);
    return NextResponse.json(
      { error: 'فشل في جلب إحصائيات التدقيق / Failed to fetch audit stats' },
      { status: 500 }
    );
  }
}
