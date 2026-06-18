import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  requireAuth,
  checkReadAccess,
  checkWriteAccess,
  assertBranchAccess,
  safePageSize,
  sanitizeInput,
} from '@/lib/api-auth';

// GET /api/payroll/attendance
// Query: employeeId, branchId, dateFrom, dateTo, status, page, pageSize
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth();
    if (!auth.authenticated) return auth.response;
    const readCheck = checkReadAccess(auth, 'payroll');
    if (!readCheck.authenticated) return readCheck.response;

    const { searchParams } = new URL(request.url);
    const employeeId = searchParams.get('employeeId');
    const branchId = searchParams.get('branchId');
    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');
    const status = searchParams.get('status');
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = safePageSize(parseInt(searchParams.get('pageSize') || '100'));

    const where: any = {};
    if (employeeId) where.employeeId = employeeId;
    if (branchId) where.employee = { branchId };
    if (status) where.status = status;
    if (dateFrom || dateTo) {
      where.date = {
        ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
        ...(dateTo ? { lte: new Date(dateTo) } : {}),
      };
    }

    const [records, total] = await Promise.all([
      db.attendance.findMany({
        where,
        include: {
          employee: { select: { id: true, code: true, name: true, nameEn: true, position: true, branchId: true } },
        },
        orderBy: [{ date: 'desc' }, { employee: { code: 'asc' } }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.attendance.count({ where }),
    ]);

    // Aggregate summary
    const summary = await db.attendance.aggregate({
      where,
      _count: { id: true },
      _sum: { lateHours: true, overtimeHours: true, workHours: true },
    });

    return NextResponse.json({
      attendance: records.map((r) => ({
        id: r.id,
        employeeId: r.employeeId,
        employeeCode: r.employee?.code,
        employeeName: r.employee?.name,
        employeeNameEn: r.employee?.nameEn,
        employeePosition: r.employee?.position,
        date: r.date.toISOString(),
        status: r.status,
        checkIn: r.checkIn?.toISOString() || null,
        checkOut: r.checkOut?.toISOString() || null,
        workHours: Number(r.workHours),
        lateHours: Number(r.lateHours),
        overtimeHours: Number(r.overtimeHours),
        notes: r.notes,
      })),
      total,
      page,
      pageSize,
      summary: {
        count: summary._count.id || 0,
        totalLateHours: Number(summary._sum.lateHours || 0),
        totalOvertimeHours: Number(summary._sum.overtimeHours || 0),
        totalWorkHours: Number(summary._sum.workHours || 0),
      },
    });
  } catch (error: any) {
    console.error('[GET /api/payroll/attendance]', error);
    return NextResponse.json({ error: 'فشل في جلب الحضور' }, { status: 500 });
  }
}

// POST /api/payroll/attendance — create or upsert attendance for a single day
// Body: { employeeId, date, status, checkIn?, checkOut?, workHours, lateHours, overtimeHours, notes? }
// If a record exists for the same employeeId+date, it is updated.
const VALID_STATUSES = ['PRESENT', 'ABSENT', 'LATE', 'HALF_DAY', 'OFF'];

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth();
    if (!auth.authenticated) return auth.response;
    const writeCheck = checkWriteAccess(auth, 'payroll');
    if (!writeCheck.authenticated) return writeCheck.response;

    const body = await request.json();
    const { employeeId, date, status } = body;
    if (!employeeId || !date || !status) {
      return NextResponse.json({ error: 'الموظف، التاريخ، والحالة مطلوبة' }, { status: 400 });
    }
    if (!VALID_STATUSES.includes(status)) {
      return NextResponse.json({ error: `حالة غير صحيحة (${VALID_STATUSES.join(', ')})` }, { status: 400 });
    }

    const employee = await db.employee.findUnique({
      where: { id: employeeId },
      select: { id: true, branchId: true, name: true },
    });
    if (!employee) {
      return NextResponse.json({ error: 'الموظف غير موجود' }, { status: 404 });
    }
    const branchCheck = assertBranchAccess(auth, employee.branchId);
    if (!branchCheck.authenticated) return branchCheck.response;

    const day = new Date(date);
    const checkIn = body.checkIn ? new Date(body.checkIn) : null;
    const checkOut = body.checkOut ? new Date(body.checkOut) : null;
    const workHours = Number(body.workHours || 0);
    const lateHours = Number(body.lateHours || 0);
    const overtimeHours = Number(body.overtimeHours || 0);
    const notes = body.notes ? sanitizeInput(body.notes) : null;

    // Upsert (unique constraint on employeeId+date)
    const upserted = await db.attendance.upsert({
      where: { employeeId_date: { employeeId, date: day } },
      update: { status, checkIn, checkOut, workHours, lateHours, overtimeHours, notes },
      create: {
        employeeId,
        date: day,
        status,
        checkIn,
        checkOut,
        workHours,
        lateHours,
        overtimeHours,
        notes,
      },
    });

    return NextResponse.json({
      id: upserted.id,
      employeeId: upserted.employeeId,
      date: upserted.date.toISOString(),
      status: upserted.status,
      checkIn: upserted.checkIn?.toISOString() || null,
      checkOut: upserted.checkOut?.toISOString() || null,
      workHours: Number(upserted.workHours),
      lateHours: Number(upserted.lateHours),
      overtimeHours: Number(upserted.overtimeHours),
      notes: upserted.notes,
    });
  } catch (error: any) {
    console.error('[POST /api/payroll/attendance]', error);
    return NextResponse.json({ error: 'فشل في تسجيل الحضور' }, { status: 500 });
  }
}
