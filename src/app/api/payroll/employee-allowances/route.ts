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

// GET /api/payroll/employee-allowances
// Query: employeeId, branchId, page, pageSize
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth();
    if (!auth.authenticated) return auth.response;
    const readCheck = checkReadAccess(auth, 'payroll');
    if (!readCheck.authenticated) return readCheck.response;

    const { searchParams } = new URL(request.url);
    const employeeId = searchParams.get('employeeId');
    const branchId = searchParams.get('branchId');
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = safePageSize(parseInt(searchParams.get('pageSize') || '100'));

    const where: any = {};
    if (employeeId) where.employeeId = employeeId;
    if (branchId) {
      where.employee = { branchId };
    }

    const [records, total] = await Promise.all([
      db.employeeAllowance.findMany({
        where,
        include: {
          employee: { select: { id: true, code: true, name: true, branchId: true } },
          allowanceType: { select: { id: true, code: true, name: true, category: true, isPercentage: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.employeeAllowance.count({ where }),
    ]);

    return NextResponse.json({
      allowances: records.map((r) => ({
        id: r.id,
        employeeId: r.employeeId,
        employeeCode: r.employee?.code,
        employeeName: r.employee?.name,
        allowanceTypeId: r.allowanceTypeId,
        allowanceTypeCode: r.allowanceType?.code,
        allowanceTypeName: r.allowanceType?.name,
        category: r.allowanceType?.category,
        isPercentage: r.allowanceType?.isPercentage,
        amount: Number(r.amount),
        isActive: r.isActive,
        effectiveFrom: r.effectiveFrom.toISOString(),
        effectiveTo: r.effectiveTo?.toISOString() || null,
        notes: r.notes,
      })),
      total,
      page,
      pageSize,
    });
  } catch (error: any) {
    console.error('[GET /api/payroll/employee-allowances]', error);
    return NextResponse.json({ error: 'فشل في جلب بدلات الموظفين' }, { status: 500 });
  }
}

// POST /api/payroll/employee-allowances — assign a recurring allowance to an employee
// Body: { employeeId, allowanceTypeId, amount, effectiveFrom?, effectiveTo?, notes? }
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth();
    if (!auth.authenticated) return auth.response;
    const writeCheck = checkWriteAccess(auth, 'payroll');
    if (!writeCheck.authenticated) return writeCheck.response;

    const body = await request.json();
    const { employeeId, allowanceTypeId } = body;
    if (!employeeId || !allowanceTypeId) {
      return NextResponse.json({ error: 'الموظف ونوع البدل مطلوبان' }, { status: 400 });
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

    const allowanceType = await db.allowanceType.findUnique({
      where: { id: allowanceTypeId },
    });
    if (!allowanceType) {
      return NextResponse.json({ error: 'نوع البدل غير موجود' }, { status: 404 });
    }
    // The allowance type must belong to the same branch as the employee
    if (allowanceType.branchId !== employee.branchId) {
      return NextResponse.json(
        { error: 'نوع البدل لا ينتمي لنفس فرع الموظف' },
        { status: 400 }
      );
    }

    // Prevent duplicates
    const existing = await db.employeeAllowance.findUnique({
      where: { employeeId_allowanceTypeId: { employeeId, allowanceTypeId } },
    });
    if (existing) {
      return NextResponse.json(
        { error: 'هذا الموظف لديه بالفعل هذا البدل. استخدم التعديل بدلاً من ذلك.' },
        { status: 409 }
      );
    }

    const created = await db.employeeAllowance.create({
      data: {
        employeeId,
        allowanceTypeId,
        amount: Number(body.amount || 0),
        isActive: body.isActive !== false,
        effectiveFrom: body.effectiveFrom ? new Date(body.effectiveFrom) : new Date(),
        effectiveTo: body.effectiveTo ? new Date(body.effectiveTo) : null,
        notes: body.notes ? sanitizeInput(body.notes) : null,
      },
      include: {
        allowanceType: { select: { code: true, name: true, category: true, isPercentage: true } },
      },
    });

    return NextResponse.json({
      id: created.id,
      employeeId: created.employeeId,
      allowanceTypeId: created.allowanceTypeId,
      allowanceTypeCode: created.allowanceType?.code,
      allowanceTypeName: created.allowanceType?.name,
      amount: Number(created.amount),
      isActive: created.isActive,
      effectiveFrom: created.effectiveFrom.toISOString(),
      effectiveTo: created.effectiveTo?.toISOString() || null,
      notes: created.notes,
    });
  } catch (error: any) {
    console.error('[POST /api/payroll/employee-allowances]', error);
    return NextResponse.json({ error: 'فشل في إنشاء بدل موظف' }, { status: 500 });
  }
}
