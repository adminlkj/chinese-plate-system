import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  requireAuth,
  assertBranchAccess,
} from '@/lib/api-auth';
import { logPayrollAction } from '@/lib/payroll-engine';

// DELETE /api/payroll/period-locks/[id] — permanently remove a lock record
// ADMIN ONLY — use sparingly; prefer unlock (POST /api/payroll/period-locks/[id]/unlock)
// which preserves the audit trail.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth();
    if (!auth.authenticated) return auth.response;
    if (auth.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'صلاحية غير كافية — يتطلب صلاحية مدير النظام (ADMIN)' },
        { status: 403 }
      );
    }

    const { id } = await params;
    const lock = await db.payrollPeriodLock.findUnique({ where: { id } });
    if (!lock) {
      return NextResponse.json({ error: 'القفل غير موجود' }, { status: 404 });
    }
    const branchCheck = assertBranchAccess(auth, lock.branchId);
    if (!branchCheck.authenticated) return branchCheck.response;

    await db.payrollPeriodLock.delete({ where: { id } });

    await logPayrollAction({
      action: 'DELETE_PAYROLL_PERIOD_LOCK',
      entity: 'PayrollPeriodLock',
      entityId: id,
      description: `حذف قفل فترة الرواتب ${lock.month}/${lock.year}`,
      details: { branchId: lock.branchId, month: lock.month, year: lock.year },
      userId: auth.userId,
      userName: auth.email,
      userRole: auth.role,
      branchId: lock.branchId,
      severity: 'CRITICAL',
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[DELETE /api/payroll/period-locks/[id]]', error);
    return NextResponse.json({ error: 'فشل في حذف قفل الفترة' }, { status: 500 });
  }
}
