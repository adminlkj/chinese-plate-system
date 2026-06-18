import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  requireAuth,
  checkWriteAccess,
  assertBranchAccess,
  sanitizeInput,
} from '@/lib/api-auth';

// PUT /api/payroll/attendance/[id]
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

    const existing = await db.attendance.findUnique({
      where: { id },
      include: { employee: { select: { branchId: true } } },
    });
    if (!existing) {
      return NextResponse.json({ error: 'غير موجود' }, { status: 404 });
    }
    const branchCheck = assertBranchAccess(auth, existing.employee.branchId);
    if (!branchCheck.authenticated) return branchCheck.response;

    const updated = await db.attendance.update({
      where: { id },
      data: {
        status: body.status || existing.status,
        checkIn: body.checkIn !== undefined ? (body.checkIn ? new Date(body.checkIn) : null) : existing.checkIn,
        checkOut: body.checkOut !== undefined ? (body.checkOut ? new Date(body.checkOut) : null) : existing.checkOut,
        workHours: body.workHours !== undefined ? Number(body.workHours) : existing.workHours,
        lateHours: body.lateHours !== undefined ? Number(body.lateHours) : existing.lateHours,
        overtimeHours: body.overtimeHours !== undefined ? Number(body.overtimeHours) : existing.overtimeHours,
        notes: body.notes !== undefined ? (body.notes ? sanitizeInput(body.notes) : null) : existing.notes,
      },
    });
    return NextResponse.json({
      id: updated.id,
      status: updated.status,
      workHours: Number(updated.workHours),
      lateHours: Number(updated.lateHours),
      overtimeHours: Number(updated.overtimeHours),
    });
  } catch (error: any) {
    console.error('[PUT /api/payroll/attendance/[id]]', error);
    return NextResponse.json({ error: 'فشل في تحديث الحضور' }, { status: 500 });
  }
}

// DELETE /api/payroll/attendance/[id]
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
    const existing = await db.attendance.findUnique({
      where: { id },
      include: { employee: { select: { branchId: true } } },
    });
    if (!existing) {
      return NextResponse.json({ error: 'غير موجود' }, { status: 404 });
    }
    const branchCheck = assertBranchAccess(auth, existing.employee.branchId);
    if (!branchCheck.authenticated) return branchCheck.response;

    await db.attendance.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[DELETE /api/payroll/attendance/[id]]', error);
    return NextResponse.json({ error: 'فشل في حذف الحضور' }, { status: 500 });
  }
}
