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

// GET /api/payroll/leaves
// Query: employeeId, type, status, branchId, dateFrom, dateTo, page, pageSize
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth();
    if (!auth.authenticated) return auth.response;
    const readCheck = checkReadAccess(auth, 'payroll');
    if (!readCheck.authenticated) return readCheck.response;

    const { searchParams } = new URL(request.url);
    const employeeId = searchParams.get('employeeId');
    const type = searchParams.get('type');
    const status = searchParams.get('status');
    const branchId = searchParams.get('branchId');
    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = safePageSize(parseInt(searchParams.get('pageSize') || '50'));

    const where: any = {};
    if (employeeId) where.employeeId = employeeId;
    if (type) where.type = type;
    if (status) where.status = status;
    if (branchId) where.employee = { branchId };
    if (dateFrom || dateTo) {
      where.OR = [
        { startDate: { gte: dateFrom ? new Date(dateFrom) : undefined } },
        { endDate: { lte: dateTo ? new Date(dateTo) : undefined } },
      ];
    }

    const [leaves, total] = await Promise.all([
      db.leave.findMany({
        where,
        include: {
          employee: {
            select: { id: true, code: true, name: true, nameEn: true, position: true, branchId: true },
          },
        },
        orderBy: { startDate: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.leave.count({ where }),
    ]);

    return NextResponse.json({
      leaves: leaves.map((l) => ({
        id: l.id,
        employeeId: l.employeeId,
        employeeCode: l.employee?.code,
        employeeName: l.employee?.name,
        employeeNameEn: l.employee?.nameEn,
        employeePosition: l.employee?.position,
        type: l.type,
        startDate: l.startDate.toISOString(),
        endDate: l.endDate.toISOString(),
        days: Number(l.days),
        isPaid: l.isPaid,
        reason: l.reason,
        status: l.status,
        createdAt: l.createdAt.toISOString(),
      })),
      total,
      page,
      pageSize,
    });
  } catch (error: any) {
    console.error('[GET /api/payroll/leaves]', error);
    return NextResponse.json({ error: 'فشل في جلب الإجازات' }, { status: 500 });
  }
}

// POST /api/payroll/leaves — create a leave record
// Body: { employeeId, type, startDate, endDate, isPaid, reason, status? }
const VALID_LEAVE_TYPES = ['ANNUAL', 'SICK', 'UNPAID', 'MATERNITY', 'HAJJ', 'EMERGENCY'];

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth();
    if (!auth.authenticated) return auth.response;
    const writeCheck = checkWriteAccess(auth, 'payroll');
    if (!writeCheck.authenticated) return writeCheck.response;

    const body = await request.json();
    const { employeeId, type, startDate, endDate } = body;
    if (!employeeId || !type || !startDate || !endDate) {
      return NextResponse.json({ error: 'الموظف، النوع، تاريخ البداية والنهاية مطلوبة' }, { status: 400 });
    }
    if (!VALID_LEAVE_TYPES.includes(type)) {
      return NextResponse.json({ error: `نوع الإجازة غير صحيح (${VALID_LEAVE_TYPES.join(', ')})` }, { status: 400 });
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

    const start = new Date(startDate);
    const end = new Date(endDate);
    if (end < start) {
      return NextResponse.json({ error: 'تاريخ النهاية يجب أن يكون بعد تاريخ البداية' }, { status: 400 });
    }
    // Compute days (inclusive)
    const days = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;

    const created = await db.leave.create({
      data: {
        employeeId,
        type,
        startDate: start,
        endDate: end,
        days,
        isPaid: body.isPaid !== false,
        reason: body.reason ? sanitizeInput(body.reason) : null,
        status: body.status || 'APPROVED',
      },
      include: { employee: { select: { code: true, name: true, nameEn: true, position: true } } },
    });

    return NextResponse.json({
      id: created.id,
      employeeId: created.employeeId,
      employeeCode: created.employee?.code,
      employeeName: created.employee?.name,
      type: created.type,
      startDate: created.startDate.toISOString(),
      endDate: created.endDate.toISOString(),
      days: Number(created.days),
      isPaid: created.isPaid,
      reason: created.reason,
      status: created.status,
    });
  } catch (error: any) {
    console.error('[POST /api/payroll/leaves]', error);
    return NextResponse.json({ error: 'فشل في إنشاء الإجازة' }, { status: 500 });
  }
}
