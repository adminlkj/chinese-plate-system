import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth, checkWriteAccess, assertBranchAccess } from '@/lib/api-auth';

// DELETE /api/pos/tables/[id] - Delete a specific table by ID
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth(); if (!auth.authenticated) return auth.response;
    const writeCheck = checkWriteAccess(auth, 'pos'); if (!writeCheck.authenticated) return writeCheck.response;
    const { id } = await params;

    const existing = await db.restaurantTable.findUnique({
      where: { id },
      include: { _count: { select: { invoices: true } } },
    });

    if (!existing) {
      return NextResponse.json(
        { error: 'الطاولة غير موجودة' },
        { status: 404 }
      );
    }

    if (existing._count.invoices > 0) {
      return NextResponse.json(
        { error: 'لا يمكن حذف طاولة مرتبطة بفواتير' },
        { status: 400 }
      );
    }

    // Verify the user has access to this table's branch
    const branchCheck = assertBranchAccess(auth, existing.branchId);
    if (!branchCheck.authenticated) return branchCheck.response;

    await db.restaurantTable.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error deleting table:', error);
    return NextResponse.json(
      { error: 'فشل في حذف الطاولة' },
      { status: 500 }
    );
  }
}
