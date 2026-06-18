import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  requireAuth,
  checkWriteAccess,
  assertBranchAccess,
  sanitizeInput,
} from '@/lib/api-auth';

// PUT /api/payroll/employee-allowances/[id]
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

    const existing = await db.employeeAllowance.findUnique({
      where: { id },
      include: { employee: { select: { branchId: true } } },
    });
    if (!existing) {
      return NextResponse.json({ error: 'غير موجود' }, { status: 404 });
    }
    const branchCheck = assertBranchAccess(auth, existing.employee.branchId);
    if (!branchCheck.authenticated) return branchCheck.response;

    const updated = await db.employeeAllowance.update({
      where: { id },
      data: {
        amount: body.amount !== undefined ? Number(body.amount) : existing.amount,
        isActive: body.isActive !== undefined ? !!body.isActive : existing.isActive,
        effectiveFrom: body.effectiveFrom ? new Date(body.effectiveFrom) : existing.effectiveFrom,
        effectiveTo: body.effectiveTo !== undefined ? (body.effectiveTo ? new Date(body.effectiveTo) : null) : existing.effectiveTo,
        notes: body.notes !== undefined ? (body.notes ? sanitizeInput(body.notes) : null) : existing.notes,
      },
    });
    return NextResponse.json({ id: updated.id, amount: Number(updated.amount), isActive: updated.isActive });
  } catch (error: any) {
    console.error('[PUT /api/payroll/employee-allowances/[id]]', error);
    return NextResponse.json({ error: 'فشل في تحديث بدلات الموظف' }, { status: 500 });
  }
}

// DELETE /api/payroll/employee-allowances/[id]
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
    const existing = await db.employeeAllowance.findUnique({
      where: { id },
      include: { employee: { select: { branchId: true } } },
    });
    if (!existing) {
      return NextResponse.json({ error: 'غير موجود' }, { status: 404 });
    }
    const branchCheck = assertBranchAccess(auth, existing.employee.branchId);
    if (!branchCheck.authenticated) return branchCheck.response;

    await db.employeeAllowance.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[DELETE /api/payroll/employee-allowances/[id]]', error);
    return NextResponse.json({ error: 'فشل في حذف بدلات الموظف' }, { status: 500 });
  }
}
