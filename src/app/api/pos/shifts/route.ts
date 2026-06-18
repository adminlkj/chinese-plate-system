import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { toNumber } from '@/lib/decimal';
import { requireAuth, requireRole, safePageSize, checkWriteAccess, checkReadAccess, assertBranchAccess } from '@/lib/api-auth';
import { resolveBranchId, resolveBranchIdOrNull } from '@/lib/branch-resolver';

// Helper: Generate next shift number (SHF-0001, SHF-0002, etc.)
async function generateShiftNumber(tx: any): Promise<string> {
  const last = await tx.shift.findFirst({
    orderBy: { createdAt: 'desc' },
    select: { number: true },
  });
  if (!last) return 'SHF-0001';
  const num = parseInt(last.number.split('-')[1]);
  if (isNaN(num)) throw new Error(`Corrupted shift number: ${last.number}`);
  return `SHF-${(num + 1).toString().padStart(4, '0')}`;
}

// Helper: Format shift for JSON response
function formatShift(shift: any) {
  return {
    id: shift.id,
    number: shift.number,
    userId: shift.userId,
    userName: shift.user?.name || null,
    userEmail: shift.user?.email || null,
    branchId: shift.branchId,
    // Backward-compat alias: client components (shift-management.tsx)
    // historically read `shift.branch`. The DB column is `branchId` (UUID).
    // Expose both so old clients keep working without interface changes.
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

// GET /api/pos/shifts - List shifts with filters
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth.authenticated) return auth.response;
    const readCheck = checkReadAccess(auth, 'pos'); if (!readCheck.authenticated) return readCheck.response;

    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    const branchInput = searchParams.get('branch') || searchParams.get('branchId');
    const status = searchParams.get('status');
    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');
    const limit = safePageSize(parseInt(searchParams.get('limit') || '50'));
    const offset = parseInt(searchParams.get('offset') || '0');

    const branchId = await resolveBranchIdOrNull(branchInput);

    // Verify branch access if branch filter is specified
    if (branchInput) {
      const branchCheck = assertBranchAccess(auth, branchInput);
      if (!branchCheck.authenticated) return branchCheck.response;
    }

    const where: any = {};
    if (userId) where.userId = userId;
    if (branchId) where.branchId = branchId;
    if (status) {
      if (status.includes(',')) {
        where.status = { in: status.split(',') };
      } else {
        where.status = status;
      }
    }
    if (dateFrom || dateTo) {
      where.openedAt = {};
      if (dateFrom) where.openedAt.gte = new Date(dateFrom);
      if (dateTo) where.openedAt.lte = new Date(dateTo);
    }

    const [shifts, total] = await Promise.all([
      db.shift.findMany({
        where,
        include: {
          user: { select: { name: true, email: true } },
        },
        orderBy: { openedAt: 'desc' },
        skip: offset,
        take: limit,
      }),
      db.shift.count({ where }),
    ]);

    return NextResponse.json({
      shifts: shifts.map(formatShift),
      total,
    });
  } catch (error: any) {
    console.error('Error fetching shifts:', error);
    return NextResponse.json(
      { error: 'فشل في جلب الورديات' },
      { status: 500 }
    );
  }
}

// POST /api/pos/shifts - Open a new shift
export async function POST(request: NextRequest) {
  try {
    const auth = await requireRole('CASHIER', request);
    if (!auth.authenticated) return auth.response;

    const writeCheck = checkWriteAccess(auth, 'pos'); if (!writeCheck.authenticated) return writeCheck.response;

    const body = await request.json();
    const { openingCash, notes } = body;

    // Resolve branchId (UUID) from body.branch (code/name/id) or body.branchId
    const branchId = await resolveBranchId(body.branch || body.branchId);
    if (!branchId) {
      return NextResponse.json(
        { error: 'الفرع مطلوب' },
        { status: 400 }
      );
    }

    // Verify the user has access to this branch
    const branchCheck = assertBranchAccess(auth, body.branch || body.branchId);
    if (!branchCheck.authenticated) return branchCheck.response;

    if (openingCash === undefined || openingCash === null || openingCash < 0) {
      return NextResponse.json(
        { error: 'يجب إدخال مبلغ افتتاح الصندوق (قيمة صحيحة)' },
        { status: 400 }
      );
    }

    // Use transaction for atomicity
    const shift = await db.$transaction(async (tx) => {
      // Check if user already has an open shift
      const existingOpen = await tx.shift.findFirst({
        where: {
          userId: auth.userId,
          status: 'OPEN',
        },
      });

      if (existingOpen) {
        throw new Error('لديك وردية مفتوحة بالفعل - يجب إغلاقها أولاً');
      }

      const number = await generateShiftNumber(tx);

      const newShift = await tx.shift.create({
        data: {
          number,
          userId: auth.userId,
          branchId,
          status: 'OPEN',
          openedAt: new Date(),
          openingCash,
          notes: notes || null,
        },
        include: {
          user: { select: { name: true, email: true } },
        },
      });

      return newShift;
    }, {
      maxWait: 10000,
      timeout: 15000,
    });

    return NextResponse.json(formatShift(shift), { status: 201 });
  } catch (error: any) {
    console.error('Error opening shift:', error);

    // Return 400 for business logic errors thrown inside transaction
    if (error.message.includes('وردية مفتوحة بالفعل')) {
      return NextResponse.json(
        { error: error.message },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: 'فشل في فتح وردية جديدة' },
      { status: 500 }
    );
  }
}
