import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth, checkWriteAccess } from '@/lib/api-auth';
import { auditLog } from '@/lib/audit-log';

// GET /api/fiscal-periods - Fetch all fiscal periods
export async function GET() {
  try {
    const auth = await requireAuth(); if (!auth.authenticated) return auth.response;
    const periods = await db.fiscalPeriod.findMany({
      orderBy: { startDate: 'desc' },
    });
    return NextResponse.json(periods);
  } catch (error: any) {
    console.error('[GET /api/fiscal-periods]', error);
    return NextResponse.json({ error: 'فشل في جلب الفترات المالية' }, { status: 500 });
  }
}

// POST /api/fiscal-periods - Create new fiscal period or close existing
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(); if (!auth.authenticated) return auth.response;
    const writeCheck = checkWriteAccess(auth, 'settings'); if (!writeCheck.authenticated) return writeCheck.response;
    const body = await request.json();
    const { action, periodId, name, startDate, endDate } = body;

    if (action === 'close' && periodId) {
      // Close a fiscal period
      const period = await db.fiscalPeriod.findUnique({ where: { id: periodId } });
      if (!period) {
        return NextResponse.json({ error: 'الفترة غير موجودة' }, { status: 404 });
      }
      if (period.status === 'CLOSED') {
        return NextResponse.json({ error: 'الفترة مغلقة بالفعل' }, { status: 400 });
      }
      const updated = await db.fiscalPeriod.update({
        where: { id: periodId },
        data: { status: 'CLOSED' },
      });
      // AUDIT-9-18 — closing a fiscal period is a CRITICAL compliance action
      auditLog({
        action: 'CLOSE',
        entity: 'SETTING',
        entityId: periodId,
        entityNumber: period.name,
        description: `إقفال فترة مالية: ${period.name} (${period.startDate?.toISOString?.().slice(0,10)} → ${period.endDate?.toISOString?.().slice(0,10)})`,
        userId: auth.userId,
        userName: auth.email,
        userRole: auth.role,
        severity: 'CRITICAL',
        category: 'SETTINGS',
        details: { periodId, previousStatus: period.status, newStatus: 'CLOSED' },
      }).catch(() => {});
      return NextResponse.json(updated);
    }

    if (action === 'reopen' && periodId) {
      // Reopen a closed fiscal period
      const period = await db.fiscalPeriod.findUnique({ where: { id: periodId } });
      if (!period) {
        return NextResponse.json({ error: 'الفترة غير موجودة' }, { status: 404 });
      }
      if (period.status === 'OPEN') {
        return NextResponse.json({ error: 'الفترة مفتوحة بالفعل' }, { status: 400 });
      }
      const updated = await db.fiscalPeriod.update({
        where: { id: periodId },
        data: { status: 'OPEN' },
      });
      // AUDIT-9-18 — reopening a fiscal period is a CRITICAL compliance action
      auditLog({
        action: 'SETTINGS_CHANGE',
        entity: 'SETTING',
        entityId: periodId,
        entityNumber: period.name,
        description: `إعادة فتح فترة مالية مغلقة: ${period.name}`,
        userId: auth.userId,
        userName: auth.email,
        userRole: auth.role,
        severity: 'CRITICAL',
        category: 'SETTINGS',
        details: { periodId, previousStatus: period.status, newStatus: 'OPEN' },
      }).catch(() => {});
      return NextResponse.json(updated);
    }

    if (action === 'open') {
      // Open a new fiscal period
      const newPeriod = await db.fiscalPeriod.create({
        data: {
          name: name || 'فترة مالية جديدة',
          startDate: startDate ? new Date(startDate) : new Date(new Date().getFullYear(), 0, 1),
          endDate: endDate ? new Date(endDate) : new Date(new Date().getFullYear(), 11, 31),
          status: 'OPEN',
        },
      });
      // AUDIT-9-18 — opening a fiscal period
      auditLog({
        action: 'CREATE',
        entity: 'SETTING',
        entityId: newPeriod.id,
        entityNumber: newPeriod.name,
        description: `إنشاء فترة مالية: ${newPeriod.name}`,
        userId: auth.userId,
        userName: auth.email,
        userRole: auth.role,
        severity: 'WARNING',
        category: 'SETTINGS',
        details: { name: newPeriod.name, startDate, endDate },
      }).catch(() => {});
      return NextResponse.json(newPeriod);
    }

    return NextResponse.json({ error: 'إجراء غير معروف' }, { status: 400 });
  } catch (error: any) {
    console.error('[POST /api/fiscal-periods]', error);
    return NextResponse.json({ error: 'فشل في إدارة الفترات المالية' }, { status: 500 });
  }
}
