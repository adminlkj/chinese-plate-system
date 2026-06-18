import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { toNumber, round2 } from '@/lib/decimal';
import { requireRole, checkWriteAccess, assertBranchAccess } from '@/lib/api-auth';
import { auditLog } from '@/lib/audit-log';

// Card payment methods that count as card sales
const CARD_METHODS = ['MADA', 'VISA', 'MASTERCARD', 'OTHER_CARD'];

// POST /api/pos/shifts/[id]/close - Close a shift
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireRole('CASHIER', request);
    if (!auth.authenticated) return auth.response;

    const writeCheck = checkWriteAccess(auth, 'pos'); if (!writeCheck.authenticated) return writeCheck.response;

    const { id } = await params;
    const body = await request.json();
    const { closingCash, notes } = body;

    // Validate closingCash
    if (closingCash === undefined || closingCash === null || closingCash < 0) {
      return NextResponse.json(
        { error: 'يجب إدخال مبلغ إغلاق الصندوق (قيمة صحيحة)' },
        { status: 400 }
      );
    }

    // Fetch the shift first to verify branch access before transaction
    const existingShift = await db.shift.findUnique({
      where: { id },
      select: { branchId: true, status: true, userId: true },
    });

    if (!existingShift) {
      return NextResponse.json(
        { error: 'الوردية غير موجودة' },
        { status: 404 }
      );
    }

    // Verify the user has access to this shift's branch
    const branchCheck = assertBranchAccess(auth, existingShift.branchId);
    if (!branchCheck.authenticated) return branchCheck.response;

    // Use transaction for atomicity
    const closedShift = await db.$transaction(async (tx) => {
      // Fetch the shift
      const shift = await tx.shift.findUnique({
        where: { id },
        include: {
          user: { select: { name: true, email: true } },
        },
      });

      if (!shift) {
        throw new Error('الوردية غير موجودة');
      }

      // Only OPEN shifts can be closed
      if (shift.status !== 'OPEN') {
        throw new Error('لا يمكن إغلاق وردية ليست مفتوحة');
      }

      // Only the same user who opened the shift, or an ADMIN, can close it
      if (shift.userId !== auth.userId && auth.role !== 'ADMIN') {
        throw new Error('يمكن فقط للمستخدم الذي فتح الوردية أو المسؤول إغلاقها');
      }

      // Calculate shift totals by querying POSInvoice records
      const closedAt = new Date();

      // Get all finalized and returned invoices in this shift's timeframe and branch
      const invoices = await tx.pOSInvoice.findMany({
        where: {
          branchId: shift.branchId,
          createdAt: {
            gte: shift.openedAt,
            lte: closedAt,
          },
          status: { in: ['FINALIZED', 'RETURNED'] },
        },
        include: {
          payments: true,
        },
      });

      // Calculate totals
      let totalSales = 0;
      let totalReturns = 0;
      let totalDiscounts = 0;
      let totalCashSales = 0;
      let totalCardSales = 0;
      let totalOtherSales = 0;
      let invoiceCount = 0;
      let returnCount = 0;
      let cashFromReturns = 0;

      for (const invoice of invoices) {
        if (invoice.status === 'FINALIZED') {
          totalSales += toNumber(invoice.totalAmount);
          totalDiscounts += toNumber(invoice.discountAmount);
          invoiceCount++;

          // Payment breakdown for sales
          if (invoice.payments && invoice.payments.length > 0) {
            for (const payment of invoice.payments) {
              const amount = toNumber(payment.amount);
              if (payment.method === 'CASH') {
                totalCashSales += amount;
              } else if (CARD_METHODS.includes(payment.method)) {
                totalCardSales += amount;
              } else {
                totalOtherSales += amount;
              }
            }
          } else {
            // Fallback: use invoice's payment method if no payment records
            const amt = toNumber(invoice.totalAmount);
            if (invoice.paymentMethod === 'CASH') {
              totalCashSales += amt;
            } else if (CARD_METHODS.includes(invoice.paymentMethod || '')) {
              totalCardSales += amt;
            } else {
              totalOtherSales += amt;
            }
          }
        } else if (invoice.status === 'RETURNED') {
          totalReturns += toNumber(invoice.totalAmount);
          returnCount++;

          // Track cash from returns (to subtract from expected cash)
          if (invoice.payments && invoice.payments.length > 0) {
            for (const payment of invoice.payments) {
              if (payment.method === 'CASH') {
                cashFromReturns += toNumber(payment.amount);
              }
            }
          } else if (invoice.paymentMethod === 'CASH') {
            cashFromReturns += toNumber(invoice.totalAmount);
          }
        }
      }

      // Round all calculated values
      totalSales = round2(totalSales);
      totalReturns = round2(totalReturns);
      totalDiscounts = round2(totalDiscounts);
      totalCashSales = round2(totalCashSales);
      totalCardSales = round2(totalCardSales);
      totalOtherSales = round2(totalOtherSales);
      cashFromReturns = round2(cashFromReturns);

      // Calculate expected cash: opening + cash sales - cash from returns
      const openingCash = toNumber(shift.openingCash);
      const expectedCash = round2(openingCash + totalCashSales - cashFromReturns);

      // Calculate cash difference: closing - expected
      const cashDifference = round2(closingCash - expectedCash);

      // Update the shift
      const updated = await tx.shift.update({
        where: { id },
        data: {
          status: 'CLOSED',
          closedAt,
          closingCash,
          expectedCash,
          cashDifference,
          totalSales,
          totalReturns,
          totalDiscounts,
          totalCashSales,
          totalCardSales,
          totalOtherSales,
          invoiceCount,
          returnCount,
          notes: notes || shift.notes, // Append or replace notes
        },
        include: {
          user: { select: { name: true, email: true } },
        },
      });

      return updated;
    }, {
      maxWait: 10000,
      timeout: 20000,
    });

    // Format response
    // AUDIT-9-18 — shift close is a WARNING (cash reconciliation + cashier accountability)
    auditLog({
      action: 'CLOSE',
      entity: 'SHIFT',
      entityId: closedShift.id,
      entityNumber: closedShift.number,
      description: `إغلاق وردية ${closedShift.number} - مبيعات: ${toNumber(closedShift.totalSales)}, فرق الصندوق: ${closedShift.cashDifference !== null ? toNumber(closedShift.cashDifference) : 0}`,
      userId: auth.userId,
      userName: auth.email,
      userRole: auth.role,
      branchId: closedShift.branchId,
      severity: closedShift.cashDifference !== null && Math.abs(toNumber(closedShift.cashDifference)) > 1 ? 'WARNING' : 'INFO',
      category: 'POS',
      details: {
        totalSales: toNumber(closedShift.totalSales),
        totalReturns: toNumber(closedShift.totalReturns),
        openingCash: toNumber(closedShift.openingCash),
        closingCash: closedShift.closingCash !== null ? toNumber(closedShift.closingCash) : null,
        expectedCash: closedShift.expectedCash !== null ? toNumber(closedShift.expectedCash) : null,
        cashDifference: closedShift.cashDifference !== null ? toNumber(closedShift.cashDifference) : null,
        invoiceCount: closedShift.invoiceCount,
        returnCount: closedShift.returnCount,
      },
    }).catch(() => {});

    return NextResponse.json({
      id: closedShift.id,
      number: closedShift.number,
      userId: closedShift.userId,
      userName: closedShift.user?.name || null,
      userEmail: closedShift.user?.email || null,
      branchId: closedShift.branchId,
      // Backward-compat alias: client reads `shift.branch`
      branch: closedShift.branchId,
      status: closedShift.status,
      openedAt: closedShift.openedAt.toISOString(),
      closedAt: closedShift.closedAt ? closedShift.closedAt.toISOString() : null,
      openingCash: toNumber(closedShift.openingCash),
      closingCash: closedShift.closingCash !== null ? toNumber(closedShift.closingCash) : null,
      expectedCash: closedShift.expectedCash !== null ? toNumber(closedShift.expectedCash) : null,
      cashDifference: closedShift.cashDifference !== null ? toNumber(closedShift.cashDifference) : null,
      totalSales: toNumber(closedShift.totalSales),
      totalReturns: toNumber(closedShift.totalReturns),
      totalDiscounts: toNumber(closedShift.totalDiscounts),
      totalCashSales: toNumber(closedShift.totalCashSales),
      totalCardSales: toNumber(closedShift.totalCardSales),
      totalOtherSales: toNumber(closedShift.totalOtherSales),
      invoiceCount: closedShift.invoiceCount,
      returnCount: closedShift.returnCount,
      notes: closedShift.notes,
      createdAt: closedShift.createdAt.toISOString(),
      updatedAt: closedShift.updatedAt.toISOString(),
    });
  } catch (error: any) {
    console.error('Error closing shift:', error);

    // Return 400 for business logic errors
    if (
      error.message.includes('غير موجودة') ||
      error.message.includes('ليست مفتوحة') ||
      error.message.includes('إغلاقها')
    ) {
      return NextResponse.json(
        { error: error.message },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: 'فشل في إغلاق الوردية' },
      { status: 500 }
    );
  }
}
