import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  requireAuth,
  checkWriteAccess,
  assertBranchAccess,
  sanitizeInput,
} from '@/lib/api-auth';

// PUT /api/payroll/leaves/[id]
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

    const existing = await db.leave.findUnique({
      where: { id },
      include: { employee: { select: { branchId: true } } },
    });
    if (!existing) {
      return NextResponse.json({ error: 'غير موجود' }, { status: 404 });
    }
    const branchCheck = assertBranchAccess(auth, existing.employee.branchId);
    if (!branchCheck.authenticated) return branchCheck.response;

    const start = body.startDate ? new Date(body.startDate) : existing.startDate;
    const end = body.endDate ? new Date(body.endDate) : existing.endDate;
    const days = body.startDate || body.endDate
      ? Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1
      : Number(existing.days);

    const updated = await db.leave.update({
      where: { id },
      data: {
        type: body.type || existing.type,
        startDate: start,
        endDate: end,
        days,
        isPaid: body.isPaid !== undefined ? !!body.isPaid : existing.isPaid,
        reason: body.reason !== undefined ? (body.reason ? sanitizeInput(body.reason) : null) : existing.reason,
        status: body.status || existing.status,
      },
    });
    return NextResponse.json({
      id: updated.id,
      type: updated.type,
      startDate: updated.startDate.toISOString(),
      endDate: updated.endDate.toISOString(),
      days: Number(updated.days),
      isPaid: updated.isPaid,
      reason: updated.reason,
      status: updated.status,
    });
  } catch (error: any) {
    console.error('[PUT /api/payroll/leaves/[id]]', error);
    return NextResponse.json({ error: 'فشل في تحديث الإجازة' }, { status: 500 });
  }
}

// DELETE /api/payroll/leaves/[id]
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
    const existing = await db.leave.findUnique({
      where: { id },
      include: { employee: { select: { branchId: true } } },
    });
    if (!existing) {
      return NextResponse.json({ error: 'غير موجود' }, { status: 404 });
    }
    const branchCheck = assertBranchAccess(auth, existing.employee.branchId);
    if (!branchCheck.authenticated) return branchCheck.response;

    await db.leave.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[DELETE /api/payroll/leaves/[id]]', error);
    return NextResponse.json({ error: 'فشل في حذف الإجازة' }, { status: 500 });
  }
}
