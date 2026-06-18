import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  requireAuth,
  checkWriteAccess,
  assertBranchAccess,
  sanitizeInput,
} from '@/lib/api-auth';

// PUT /api/payroll/allowances/[id] — update an AllowanceType
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

    const existing = await db.allowanceType.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: 'نوع البدل غير موجود' }, { status: 404 });
    }

    const branchCheck = assertBranchAccess(auth, existing.branchId);
    if (!branchCheck.authenticated) return branchCheck.response;

    const updated = await db.allowanceType.update({
      where: { id },
      data: {
        name: body.name ? sanitizeInput(body.name) : existing.name,
        nameEn: body.nameEn !== undefined ? (body.nameEn ? sanitizeInput(body.nameEn) : null) : existing.nameEn,
        category: body.category === 'DEDUCTION' ? 'DEDUCTION' : body.category === 'ALLOWANCE' ? 'ALLOWANCE' : existing.category,
        isPercentage: body.isPercentage !== undefined ? !!body.isPercentage : existing.isPercentage,
        defaultAmount: body.defaultAmount !== undefined ? Number(body.defaultAmount) : existing.defaultAmount,
        isRecurring: body.isRecurring !== undefined ? !!body.isRecurring : existing.isRecurring,
        isActive: body.isActive !== undefined ? !!body.isActive : existing.isActive,
      },
    });

    return NextResponse.json({
      id: updated.id,
      code: updated.code,
      name: updated.name,
      nameEn: updated.nameEn,
      category: updated.category,
      isPercentage: updated.isPercentage,
      defaultAmount: Number(updated.defaultAmount),
      isRecurring: updated.isRecurring,
      isActive: updated.isActive,
    });
  } catch (error: any) {
    console.error('[PUT /api/payroll/allowances/[id]]', error);
    return NextResponse.json(
      { error: 'فشل في تحديث نوع البدل' },
      { status: 500 }
    );
  }
}

// DELETE /api/payroll/allowances/[id] — deactivate (soft delete)
// We don't hard-delete because PayrollItemAllowance records may reference it.
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
    const existing = await db.allowanceType.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: 'نوع البدل غير موجود' }, { status: 404 });
    }
    const branchCheck = assertBranchAccess(auth, existing.branchId);
    if (!branchCheck.authenticated) return branchCheck.response;

    // Check if any employee is using this allowance type
    const usageCount = await db.employeeAllowance.count({
      where: { allowanceTypeId: id, isActive: true },
    });
    if (usageCount > 0) {
      // Soft-deactivate instead of hard delete
      await db.allowanceType.update({
        where: { id },
        data: { isActive: false },
      });
      return NextResponse.json({
        success: true,
        softDeleted: true,
        message: `تم إلغاء تفعيل البدل لأنه مستخدم بواسطة ${usageCount} موظف`,
      });
    }

    await db.allowanceType.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[DELETE /api/payroll/allowances/[id]]', error);
    return NextResponse.json(
      { error: 'فشل في حذف نوع البدل' },
      { status: 500 }
    );
  }
}
