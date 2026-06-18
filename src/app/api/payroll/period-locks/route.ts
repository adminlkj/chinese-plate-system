import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  requireAuth,
  checkReadAccess,
  assertBranchAccess,
  safePageSize,
  sanitizeInput,
  getUserAllowedBranches,
} from '@/lib/api-auth';
import { resolveBranchIdOrNull } from '@/lib/branch-resolver';
import { logPayrollAction } from '@/lib/payroll-engine';

// GET /api/payroll/period-locks
// Query: branchId, year, month, isActive, page, pageSize
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth();
    if (!auth.authenticated) return auth.response;
    const readCheck = checkReadAccess(auth, 'payroll');
    if (!readCheck.authenticated) return readCheck.response;

    const { searchParams } = new URL(request.url);
    const branchInput = searchParams.get('branch') || searchParams.get('branchId');
    const year = searchParams.get('year');
    const month = searchParams.get('month');
    const isActive = searchParams.get('isActive');
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = safePageSize(parseInt(searchParams.get('pageSize') || '100'));

    const where: any = {};
    const allowedBranches = getUserAllowedBranches(auth);
    if (allowedBranches) {
      where.branchId = { in: allowedBranches };
    }
    if (branchInput && branchInput !== 'all') {
      const branchId = await resolveBranchIdOrNull(branchInput);
      if (branchId) {
        const branchCheck = assertBranchAccess(auth, branchId);
        if (!branchCheck.authenticated) return branchCheck.response;
        where.branchId = branchId;
      }
    }
    if (year) where.year = parseInt(year);
    if (month) where.month = parseInt(month);
    if (isActive === 'true') where.isActive = true;
    if (isActive === 'false') where.isActive = false;

    const [locks, total] = await Promise.all([
      db.payrollPeriodLock.findMany({
        where,
        include: { branch: { select: { id: true, name: true, nameEn: true, code: true } } },
        orderBy: [{ year: 'desc' }, { month: 'desc' }, { lockedAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.payrollPeriodLock.count({ where }),
    ]);

    return NextResponse.json({
      locks: locks.map((l) => ({
        id: l.id,
        branchId: l.branchId,
        branchName: l.branch?.name,
        branchNameEn: l.branch?.nameEn,
        branchCode: l.branch?.code,
        month: l.month,
        year: l.year,
        lockedAt: l.lockedAt.toISOString(),
        lockedBy: l.lockedBy,
        lockedByName: l.lockedByName,
        reason: l.reason,
        unlockedAt: l.unlockedAt?.toISOString() || null,
        unlockedBy: l.unlockedBy,
        unlockedByName: l.unlockedByName,
        unlockReason: l.unlockReason,
        isActive: l.isActive,
      })),
      total,
      page,
      pageSize,
    });
  } catch (error: any) {
    console.error('[GET /api/payroll/period-locks]', error);
    return NextResponse.json({ error: 'فشل في جلب أقفال الفترات' }, { status: 500 });
  }
}

// POST /api/payroll/period-locks — lock a period
// PERMISSIONS (Section 10): ADMIN ONLY
// Body: { branchId, month, year, reason? }
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth();
    if (!auth.authenticated) return auth.response;

    // ── ADMIN ONLY ──
    if (auth.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'صلاحية غير كافية — إقفال الفترة يتطلب صلاحية مدير النظام (ADMIN)' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const branchId = await resolveBranchIdOrNull(body.branchId || body.branch);
    if (!branchId) {
      return NextResponse.json({ error: 'الفرع مطلوب' }, { status: 400 });
    }
    const branchCheck = assertBranchAccess(auth, branchId);
    if (!branchCheck.authenticated) return branchCheck.response;

    const month = parseInt(body.month);
    const year = parseInt(body.year);
    if (!month || month < 1 || month > 12) {
      return NextResponse.json({ error: 'الشهر غير صحيح' }, { status: 400 });
    }
    if (!year || year < 2000 || year > 2100) {
      return NextResponse.json({ error: 'السنة غير صحيحة' }, { status: 400 });
    }

    // Check if already locked (active)
    const existing = await db.payrollPeriodLock.findUnique({
      where: { branchId_month_year: { branchId, month, year } },
    });
    if (existing && existing.isActive) {
      return NextResponse.json(
        { error: `الفترة ${month}/${year} مقفلة بالفعل` },
        { status: 409 }
      );
    }

    // If exists but was unlocked (isActive=false), re-lock it
    const lock = existing
      ? await db.payrollPeriodLock.update({
          where: { id: existing.id },
          data: {
            isActive: true,
            lockedAt: new Date(),
            lockedBy: auth.userId,
            lockedByName: auth.email,
            reason: body.reason ? sanitizeInput(body.reason) : null,
            // Clear unlock audit
            unlockedAt: null,
            unlockedBy: null,
            unlockedByName: null,
            unlockReason: null,
          },
        })
      : await db.payrollPeriodLock.create({
          data: {
            branchId,
            month,
            year,
            lockedAt: new Date(),
            lockedBy: auth.userId,
            lockedByName: auth.email,
            reason: body.reason ? sanitizeInput(body.reason) : null,
            isActive: true,
          },
        });

    await logPayrollAction({
      action: 'LOCK_PAYROLL_PERIOD',
      entity: 'PayrollPeriodLock',
      entityId: lock.id,
      description: `إقفال فترة الرواتب ${month}/${year} للفرع ${branchId}`,
      details: { branchId, month, year, reason: body.reason },
      userId: auth.userId,
      userName: auth.email,
      userRole: auth.role,
      branchId,
      severity: 'WARN',
    });

    return NextResponse.json({
      id: lock.id,
      branchId,
      month,
      year,
      lockedAt: lock.lockedAt.toISOString(),
      lockedBy: lock.lockedBy,
      lockedByName: lock.lockedByName,
      reason: lock.reason,
      isActive: lock.isActive,
    });
  } catch (error: any) {
    console.error('[POST /api/payroll/period-locks]', error);
    const isConflict = error?.code === 'P2002';
    return NextResponse.json(
      { error: isConflict ? 'الفترة مقفلة بالفعل' : 'فشل في قفل الفترة' },
      { status: isConflict ? 409 : 500 }
    );
  }
}
