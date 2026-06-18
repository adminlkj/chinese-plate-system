import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { toNumber } from '@/lib/decimal';
import {
  requireAuth,
  checkReadAccess,
  checkWriteAccess,
  assertBranchAccess,
  safePageSize,
  sanitizeInput,
  getUserAllowedBranches,
} from '@/lib/api-auth';
import { resolveBranchId, resolveBranchIdOrNull } from '@/lib/branch-resolver';
import { generateEmployeeCode, logPayrollAction } from '@/lib/payroll-engine';

// GET /api/payroll/employees
// Query params: branch, status, search, page, pageSize
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth();
    if (!auth.authenticated) return auth.response;
    const readCheck = checkReadAccess(auth, 'payroll');
    if (!readCheck.authenticated) return readCheck.response;

    const { searchParams } = new URL(request.url);
    const branchInput = searchParams.get('branch') || searchParams.get('branchId');
    const status = searchParams.get('status');
    const search = searchParams.get('search');
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = safePageSize(parseInt(searchParams.get('pageSize') || '50'));

    const where: any = {};

    // Branch scoping — enforce user's allowed branches (Layer 3)
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

    if (status) where.status = status;

    if (search && search.trim()) {
      const q = search.trim();
      where.OR = [
        { name: { contains: q } },
        { nameEn: { contains: q } },
        { code: { contains: q } },
        { iqamaNumber: { contains: q } },
        { phone: { contains: q } },
        { position: { contains: q } },
      ];
    }

    const [employees, total] = await Promise.all([
      db.employee.findMany({
        where,
        include: {
          branch: { select: { id: true, name: true, nameEn: true, code: true } },
        },
        orderBy: [{ branchId: 'asc' }, { code: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.employee.count({ where }),
    ]);

    return NextResponse.json({
      employees: employees.map((e) => ({
        id: e.id,
        code: e.code,
        name: e.name,
        nameEn: e.nameEn,
        iqamaNumber: e.iqamaNumber,
        phone: e.phone,
        email: e.email,
        position: e.position,
        salaryType: e.salaryType,
        baseSalary: toNumber(e.baseSalary),
        status: e.status,
        hireDate: e.hireDate.toISOString(),
        branchId: e.branchId,
        branchName: e.branch?.name,
        branchNameEn: e.branch?.nameEn,
        branchCode: e.branch?.code,
        notes: e.notes,
        createdAt: e.createdAt.toISOString(),
      })),
      total,
      page,
      pageSize,
    });
  } catch (error: any) {
    console.error('[GET /api/payroll/employees]', error);
    return NextResponse.json(
      { error: 'فشل في تحميل الموظفين' },
      { status: 500 }
    );
  }
}

// POST /api/payroll/employees — create a new employee
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth();
    if (!auth.authenticated) return auth.response;
    const writeCheck = checkWriteAccess(auth, 'payroll');
    if (!writeCheck.authenticated) return writeCheck.response;

    const body = await request.json();

    // MANDATORY: branchId — no employee can exist without a branch
    const branchId = await resolveBranchId(body.branchId || body.branch);
    if (!branchId) {
      return NextResponse.json(
        { error: 'الفرع مطلوب — لا يمكن إنشاء موظف بدون فرع' },
        { status: 400 }
      );
    }
    const branchCheck = assertBranchAccess(auth, branchId);
    if (!branchCheck.authenticated) return branchCheck.response;

    // Validate required fields
    const name = sanitizeInput(body.name);
    if (!name) {
      return NextResponse.json({ error: 'اسم الموظف مطلوب' }, { status: 400 });
    }

    const salaryType = body.salaryType === 'HOURLY' ? 'HOURLY' : 'MONTHLY';
    const baseSalary = Number(body.baseSalary) || 0;
    if (baseSalary < 0) {
      return NextResponse.json(
        { error: 'الراتب الأساسي يجب أن يكون موجباً' },
        { status: 400 }
      );
    }

    const code = await generateEmployeeCode();

    const employee = await db.employee.create({
      data: {
        code,
        name,
        nameEn: body.nameEn ? sanitizeInput(body.nameEn) : null,
        iqamaNumber: body.iqamaNumber ? sanitizeInput(body.iqamaNumber) : null,
        phone: body.phone ? sanitizeInput(body.phone) : null,
        email: body.email ? sanitizeInput(body.email) : null,
        position: body.position ? sanitizeInput(body.position) : null,
        salaryType,
        baseSalary,
        status: body.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
        hireDate: body.hireDate ? new Date(body.hireDate) : new Date(),
        branchId,
        notes: body.notes ? sanitizeInput(body.notes) : null,
      },
      include: {
        branch: { select: { id: true, name: true, nameEn: true, code: true } },
      },
    });

    await logPayrollAction({
      action: 'CREATE_EMPLOYEE',
      entity: 'Employee',
      entityId: employee.id,
      entityNumber: employee.code,
      description: `إنشاء موظف: ${employee.name} (${employee.code})`,
      details: { name, salaryType, baseSalary, branchId },
      userId: auth.userId,
      userName: auth.email,
      userRole: auth.role,
      branchId,
    });

    return NextResponse.json({
      id: employee.id,
      code: employee.code,
      name: employee.name,
      nameEn: employee.nameEn,
      iqamaNumber: employee.iqamaNumber,
      phone: employee.phone,
      email: employee.email,
      position: employee.position,
      salaryType: employee.salaryType,
      baseSalary: toNumber(employee.baseSalary),
      status: employee.status,
      hireDate: employee.hireDate.toISOString(),
      branchId: employee.branchId,
      branchName: employee.branch?.name,
      branchNameEn: employee.branch?.nameEn,
      branchCode: employee.branch?.code,
      notes: employee.notes,
      createdAt: employee.createdAt.toISOString(),
    });
  } catch (error: any) {
    console.error('[POST /api/payroll/employees]', error);
    return NextResponse.json(
      { error: 'فشل في إنشاء الموظف' },
      { status: 500 }
    );
  }
}
