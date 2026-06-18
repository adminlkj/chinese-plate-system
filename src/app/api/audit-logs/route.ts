import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireRole, checkReadAccess } from '@/lib/api-auth';
import { safePageSize } from '@/lib/api-auth';

// GET /api/audit-logs - List audit logs with filters and pagination
export async function GET(request: NextRequest) {
  try {
    const auth = await requireRole('MANAGER', request);
    if (!auth.authenticated) return auth.response;
    const readCheck = checkReadAccess(auth, 'audit-log'); if (!readCheck.authenticated) return readCheck.response;

    const { searchParams } = new URL(request.url);

    // Pagination
    const limit = safePageSize(parseInt(searchParams.get('limit') || '50'), 200, 50);
    const offset = parseInt(searchParams.get('offset') || '0') || 0;

    // Filters
    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');
    const action = searchParams.get('action');
    const entity = searchParams.get('entity');
    const category = searchParams.get('category');
    const severity = searchParams.get('severity');
    const search = searchParams.get('search');

    // Build where clause
    const where: Record<string, unknown> = {};

    if (dateFrom || dateTo) {
      where.createdAt = {
        ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
        ...(dateTo ? { lte: new Date(dateTo + 'T23:59:59.999Z') } : {}),
      };
    }

    if (action) where.action = action;
    if (entity) where.entity = entity;
    if (category) where.category = category;
    if (severity) where.severity = severity;

    if (search) {
      where.OR = [
        { description: { contains: search } },
        { entityNumber: { contains: search } },
        { userName: { contains: search } },
      ];
    }

    const [logs, total] = await Promise.all([
      db.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      db.auditLog.count({ where }),
    ]);

    // Parse details JSON for each log (safe-parse to avoid 500 on malformed rows)
    const parsedLogs = logs.map((log) => {
      let parsedDetails: unknown = null;
      if (log.details) {
        try {
          parsedDetails = JSON.parse(log.details);
        } catch {
          // Malformed JSON in DB row — keep raw string so the audit log entry is still visible
          parsedDetails = log.details;
        }
      }
      return { ...log, details: parsedDetails };
    });

    return NextResponse.json({
      logs: parsedLogs,
      total,
    });
  } catch (error: any) {
    console.error('[audit-logs] Error fetching logs:', error);
    return NextResponse.json(
      { error: 'فشل في جلب سجلات التدقيق / Failed to fetch audit logs' },
      { status: 500 }
    );
  }
}
