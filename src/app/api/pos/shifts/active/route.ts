import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { toNumber } from '@/lib/decimal';
import { requireAuth, checkReadAccess } from '@/lib/api-auth';

// GET /api/pos/shifts/active - Get the current user's active (OPEN) shift
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth.authenticated) return auth.response;
    const readCheck = checkReadAccess(auth, 'pos'); if (!readCheck.authenticated) return readCheck.response;

    const shift = await db.shift.findFirst({
      where: {
        userId: auth.userId,
        status: 'OPEN',
      },
      include: {
        user: { select: { name: true, email: true } },
      },
      orderBy: { openedAt: 'desc' },
    });

    if (!shift) {
      return NextResponse.json({ active: false });
    }

    return NextResponse.json({
      active: true,
      shift: {
        id: shift.id,
        number: shift.number,
        userId: shift.userId,
        userName: shift.user?.name || null,
        userEmail: shift.user?.email || null,
        branchId: shift.branchId,
        // Backward-compat alias: client reads `activeShift.branch`
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
      },
    });
  } catch (error: any) {
    console.error('Error fetching active shift:', error);
    return NextResponse.json(
      { error: 'فشل في جلب الوردية النشطة' },
      { status: 500 }
    );
  }
}
