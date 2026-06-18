import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { toNumber } from '@/lib/decimal';
import { requireAuth, checkReadAccess, assertBranchAccess } from '@/lib/api-auth';

// Helper: Format shift for JSON response (with full detail)
function formatShiftDetail(shift: any) {
  return {
    id: shift.id,
    number: shift.number,
    userId: shift.userId,
    userName: shift.user?.name || null,
    userEmail: shift.user?.email || null,
    branchId: shift.branchId,
    // Backward-compat alias: client reads `shift.branch` (see shift-management.tsx)
    branch: shift.branchId,
    status: shift.status,
    openedAt: shift.openedAt.toISOString(),
    closedAt: shift.closedAt ? shift.closedAt.toISOString() : null,
    openingCash: toNumber(shift.openingCash),
    closingCash: shift.closingCash !== null ? toNumber(shift.closingCash) : null,
    expectedCash: shift.expectedCash !== null ? toNumber(shift.expectedCash) : null,
    cashDifference: shift.cashDifference !== null ? toNumber(shift.cashDifference) : null,
    totalSales: toNumber(shift.totalSales),
    totalReturns: toNumber(shift.totalReturns),
    totalDiscounts: toNumber(shift.totalDiscounts),
    totalCashSales: toNumber(shift.totalCashSales),
    totalCardSales: toNumber(shift.totalCardSales),
    totalOtherSales: toNumber(shift.totalOtherSales),
    invoiceCount: shift.invoiceCount,
    returnCount: shift.returnCount,
    notes: shift.notes,
    createdAt: shift.createdAt.toISOString(),
    updatedAt: shift.updatedAt.toISOString(),
  };
}

// GET /api/pos/shifts/[id] - Get single shift detail with all summary data
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth(request);
    if (!auth.authenticated) return auth.response;
    const readCheck = checkReadAccess(auth, 'pos'); if (!readCheck.authenticated) return readCheck.response;

    const { id } = await params;

    const shift = await db.shift.findUnique({
      where: { id },
      include: {
        user: { select: { name: true, email: true } },
      },
    });

    if (!shift) {
      return NextResponse.json(
        { error: 'الوردية غير موجودة' },
        { status: 404 }
      );
    }

    // Verify the user has access to this shift's branch (Layer 3)
    const branchCheck = assertBranchAccess(auth, shift.branchId);
    if (!branchCheck.authenticated) return branchCheck.response;

    return NextResponse.json(formatShiftDetail(shift));
  } catch (error: any) {
    console.error('Error fetching shift:', error);
    return NextResponse.json(
      { error: 'فشل في جلب بيانات الوردية' },
      { status: 500 }
    );
  }
}
