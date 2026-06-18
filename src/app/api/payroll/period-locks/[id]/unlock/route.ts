import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  requireAuth,
  assertBranchAccess,
  sanitizeInput,
} from '@/lib/api-auth';
import { logPayrollAction } from '@/lib/payroll-engine';

// POST /api/payroll/period-locks/[id]/unlock — unlock a locked period
// PERMISSIONS (Section 10): ADMIN ONLY
// Body: { reason: string }  — MANDATORY reason for audit trail
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth();
    if (!auth.authenticated) return auth.response;

    // ── ADMIN ONLY ──
    if (auth.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'صلاحية غير كافية — إعادة فتح الفترة يتطلب صلاحية مدير النظام (ADMIN)' },
        { status: 403 }
      );
    }

    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const reason = body.reason ? sanitizeInput(body.reason) : null;
    if (!reason) {
      return NextResponse.json(
        { error: 'سبب إعادة فتح الفترة مطلوب (للسجل التدقيقي)' },
        { status: 400 }
      );
    }

    const lock = await db.payrollPeriodLock.findUnique({
      where: { id },
    });
    if (!lock) {
      return NextResponse.json({ error: 'القفل غير موجود' }, { status: 404 });
    }
    if (!lock.isActive) {
      return NextResponse.json({ error: 'الفترة غير مقفلة بالفعل' }, { status: 400 });
    }

    const branchCheck = assertBranchAccess(auth, lock.branchId);
    if (!branchCheck.authenticated) return branchCheck.response;

    const updated = await db.payrollPeriodLock.update({
      where: { id },
      data: {
        isActive: false,
        unlockedAt: new Date(),
        unlockedBy: auth.userId,
        unlockedByName: auth.email,
        unlockReason: reason,
      },
    });

    await logPayrollAction({
      action: 'UNLOCK_PAYROLL_PERIOD',
      entity: 'PayrollPeriodLock',
      entityId: id,
      description: `إعادة فتح فترة الرواتب ${lock.month}/${lock.year} - السبب: ${reason}`,
      details: { branchId: lock.branchId, month: lock.month, year: lock.year, reason },
      userId: auth.userId,
      userName: auth.email,
      userRole: auth.role,
      branchId: lock.branchId,
      severity: 'CRITICAL',
    });

    return NextResponse.json({
      id: updated.id,
      branchId: updated.branchId,
      month: updated.month,
      year: updated.year,
      isActive: updated.isActive,
      unlockedAt: updated.unlockedAt?.toISOString(),
      unlockedBy: updated.unlockedBy,
      unlockedByName: updated.unlockedByName,
      unlockReason: updated.unlockReason,
    });
  } catch (error: any) {
    console.error('[POST /api/payroll/period-locks/[id]/unlock]', error);
    return NextResponse.json({ error: 'فشل في فك قفل الفترة' }, { status: 500 });
  }
}
