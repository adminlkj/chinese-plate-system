import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { toNumber } from '@/lib/decimal';
import {
  requireAuth,
  checkReadAccess,
  checkWriteAccess,
  assertBranchAccess,
  sanitizeInput,
} from '@/lib/api-auth';
import { resolveBranchId, resolveBranchIdOrNull } from '@/lib/branch-resolver';
import { logPayrollAction } from '@/lib/payroll-engine';

// GET /api/payroll/employees/[id]
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth();
    if (!auth.authenticated) return auth.response;
    const readCheck = checkReadAccess(auth, 'payroll');
    if (!readCheck.authenticated) return readCheck.response;

    const { id } = await params;
    const employee = await db.employee.findUnique({
      where: { id },
      include: {
        branch: { select: { id: true, name: true, nameEn: true, code: true } },
        salaryAdvances: {
          orderBy: { date: 'desc' },
          take: 50,
          select: {
            id: true,
            number: true,
            amount: true,
            date: true,
            reason: true,
            status: true,
            settledAmount: true,
          },
        },
        payrollItems: {
          orderBy: { createdAt: 'desc' },
          take: 20,
          include: {
            payrollRun: {
              select: {
                id: true,
                number: true,
                month: true,
                year: true,
                status: true,
              },
            },
          },
        },
      },
    });

    if (!employee) {
      return NextResponse.json({ error: 'الموظف غير موجود' }, { status: 404 });
    }

    const branchCheck = assertBranchAccess(auth, employee.branchId);
    if (!branchCheck.authenticated) return branchCheck.response;

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
      // Recent advances (outstanding + settled history)
      advances: employee.salaryAdvances.map((a) => ({
        id: a.id,
        number: a.number,
        amount: toNumber(a.amount),
        date: a.date.toISOString(),
        reason: a.reason,
        status: a.status,
        settledAmount: toNumber(a.settledAmount),
        remaining: toNumber(a.amount) - toNumber(a.settledAmount),
      })),
      // Recent payroll items (history of past runs)
      payrollHistory: employee.payrollItems.map((pi) => ({
        id: pi.id,
        runId: pi.payrollRun.id,
        runNumber: pi.payrollRun.number,
        month: pi.payrollRun.month,
        year: pi.payrollRun.year,
        runStatus: pi.payrollRun.status,
        baseAmount: toNumber(pi.baseAmount),
        allowances: toNumber(pi.allowances),
        deductions: toNumber(pi.deductions),
        advanceAmount: toNumber(pi.advanceAmount),
        grossAmount: toNumber(pi.grossAmount),
        netAmount: toNumber(pi.netAmount),
        workDays: toNumber(pi.workDays),
        workHours: toNumber(pi.workHours),
      })),
    });
  } catch (error: any) {
    console.error('[GET /api/payroll/employees/[id]]', error);
    return NextResponse.json(
      { error: 'فشل في تحميل بيانات الموظف' },
      { status: 500 }
    );
  }
}

// PUT /api/payroll/employees/[id] — update employee
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth();
    if (!auth.authenticated) return auth.response;
    const writeCheck = checkWriteAccess(auth, 'payroll');
    if (!writeCheck.authenticated) return writeCheck.response;

    const { id } = await params;
    const body = await request.json();

    const existing = await db.employee.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: 'الموظف غير موجود' }, { status: 404 });
    }

    const branchCheck = assertBranchAccess(auth, existing.branchId);
    if (!branchCheck.authenticated) return branchCheck.response;

    // If branchId is being changed, resolve + assert access to the new branch
    let newBranchId = existing.branchId;
    if (body.branchId || body.branch) {
      newBranchId = await resolveBranchId(body.branchId || body.branch);
      const newBranchCheck = assertBranchAccess(auth, newBranchId);
      if (!newBranchCheck.authenticated) return newBranchCheck.response;
    }

    const name = body.name !== undefined ? sanitizeInput(body.name) : existing.name;
    if (!name) {
      return NextResponse.json({ error: 'اسم الموظف مطلوب' }, { status: 400 });
    }

    const salaryType =
      body.salaryType !== undefined
        ? body.salaryType === 'HOURLY' ? 'HOURLY' : 'MONTHLY'
        : existing.salaryType;
    const baseSalary =
      body.baseSalary !== undefined ? Number(body.baseSalary) : toNumber(existing.baseSalary);
    if (baseSalary < 0) {
      return NextResponse.json(
        { error: 'الراتب الأساسي يجب أن يكون موجباً' },
        { status: 400 }
      );
    }

    const updated = await db.employee.update({
      where: { id },
      data: {
        name,
        nameEn: body.nameEn !== undefined ? (body.nameEn ? sanitizeInput(body.nameEn) : null) : existing.nameEn,
        iqamaNumber:
          body.iqamaNumber !== undefined
            ? body.iqamaNumber ? sanitizeInput(body.iqamaNumber) : null
            : existing.iqamaNumber,
        phone: body.phone !== undefined ? (body.phone ? sanitizeInput(body.phone) : null) : existing.phone,
        email: body.email !== undefined ? (body.email ? sanitizeInput(body.email) : null) : existing.email,
        position: body.position !== undefined ? (body.position ? sanitizeInput(body.position) : null) : existing.position,
        salaryType,
        baseSalary,
        status: body.status !== undefined ? (body.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE') : existing.status,
        hireDate: body.hireDate ? new Date(body.hireDate) : existing.hireDate,
        branchId: newBranchId,
        notes: body.notes !== undefined ? (body.notes ? sanitizeInput(body.notes) : null) : existing.notes,
      },
      include: {
        branch: { select: { id: true, name: true, nameEn: true, code: true } },
      },
    });

    await logPayrollAction({
      action: 'UPDATE_EMPLOYEE',
      entity: 'Employee',
      entityId: updated.id,
      entityNumber: updated.code,
      description: `تعديل موظف: ${updated.name} (${updated.code})`,
      details: { before: existing, after: updated },
      userId: auth.userId,
      userName: auth.email,
      userRole: auth.role,
      branchId: newBranchId,
    });

    return NextResponse.json({
      id: updated.id,
      code: updated.code,
      name: updated.name,
      nameEn: updated.nameEn,
      iqamaNumber: updated.iqamaNumber,
      phone: updated.phone,
      email: updated.email,
      position: updated.position,
      salaryType: updated.salaryType,
      baseSalary: toNumber(updated.baseSalary),
      status: updated.status,
      hireDate: updated.hireDate.toISOString(),
      branchId: updated.branchId,
      branchName: updated.branch?.name,
      branchNameEn: updated.branch?.nameEn,
      branchCode: updated.branch?.code,
      notes: updated.notes,
      createdAt: updated.createdAt.toISOString(),
    });
  } catch (error: any) {
    console.error('[PUT /api/payroll/employees/[id]]', error);
    return NextResponse.json(
      { error: 'فشل في تعديل الموظف' },
      { status: 500 }
    );
  }
}

// DELETE /api/payroll/employees/[id] — deactivate (soft delete)
// We never hard-delete employees because they may be referenced by payroll runs.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth();
    if (!auth.authenticated) return auth.response;
    const writeCheck = checkWriteAccess(auth, 'payroll');
    if (!writeCheck.authenticated) return writeCheck.response;

    const { id } = await params;
    const existing = await db.employee.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: 'الموظف غير موجود' }, { status: 404 });
    }

    const branchCheck = assertBranchAccess(auth, existing.branchId);
    if (!branchCheck.authenticated) return branchCheck.response;

    // Check if the employee is referenced by any payroll item
    const payrollItemCount = await db.payrollItem.count({
      where: { employeeId: id },
    });

    if (payrollItemCount > 0) {
      // Soft-deactivate instead of hard delete to preserve historical payroll records
      const updated = await db.employee.update({
        where: { id },
        data: { status: 'INACTIVE' },
      });
      await logPayrollAction({
        action: 'DEACTIVATE_EMPLOYEE',
        entity: 'Employee',
        entityId: id,
        entityNumber: existing.code,
        description: `تعطيل موظف (لديه سجل رواتب): ${existing.name} (${existing.code})`,
        details: { payrollItemCount },
        userId: auth.userId,
        userName: auth.email,
        userRole: auth.role,
        branchId: existing.branchId,
        severity: 'WARN',
      });
      return NextResponse.json({
        success: true,
        softDeleted: true,
        message: 'تم تعطيل الموظف لأنه لديه سجل رواتب سابق — لا يمكن حذفه نهائياً',
      });
    }

    // No payroll history — safe to hard delete
    await db.employee.delete({ where: { id } });
    await logPayrollAction({
      action: 'DELETE_EMPLOYEE',
      entity: 'Employee',
      entityId: id,
      entityNumber: existing.code,
      description: `حذف موظف: ${existing.name} (${existing.code})`,
      userId: auth.userId,
      userName: auth.email,
      userRole: auth.role,
      branchId: existing.branchId,
      severity: 'WARN',
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[DELETE /api/payroll/employees/[id]]', error);
    return NextResponse.json(
      { error: 'فشل في حذف الموظف' },
      { status: 500 }
    );
  }
}
