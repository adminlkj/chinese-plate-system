import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { toNumber, round2 } from '@/lib/decimal';
import { requireRole, assertBranchAccess } from '@/lib/api-auth';
import { resolveBranchIdOrNull } from '@/lib/branch-resolver';

// Card payment methods
const CARD_METHODS = ['MADA', 'VISA', 'MASTERCARD', 'OTHER_CARD'];

// Payment method display labels
const METHOD_LABELS: Record<string, string> = {
  CASH: 'نقدي',
  MADA: 'مدى',
  VISA: 'فيزا',
  MASTERCARD: 'ماستركارد',
  OTHER_CARD: 'بطاقة أخرى',
};

// GET /api/pos/shifts/report - Cashier report for a specific shift or date range
// Computes everything from invoices + payments + items (never from shift totals)
export async function GET(request: NextRequest) {
  try {
    const auth = await requireRole('CASHIER', request);
    if (!auth.authenticated) return auth.response;

    const { searchParams } = new URL(request.url);
    const shiftId = searchParams.get('shiftId');
    const userId = searchParams.get('userId');
    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');
    const branchInput = searchParams.get('branch') || searchParams.get('branchId');
    const branchId = await resolveBranchIdOrNull(branchInput);

    // Verify branch access if branch filter is specified (use the RESOLVED UUID)
    if (branchId) {
      const branchCheck = assertBranchAccess(auth, branchId);
      if (!branchCheck.authenticated) return branchCheck.response;
    }

    // Mode 1: Report by shift ID
    if (shiftId) {
      const shift = await db.shift.findUnique({
        where: { id: shiftId },
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

      // Verify the user has access to this shift's branch
      const shiftBranchCheck = assertBranchAccess(auth, shift.branchId);
      if (!shiftBranchCheck.authenticated) return shiftBranchCheck.response;

      // Always compute from invoices — never use shift stored totals
      const invoices = await db.pOSInvoice.findMany({
        where: {
          branchId: shift.branchId,
          createdAt: { gte: shift.openedAt },
          status: { in: ['FINALIZED', 'RETURNED'] },
          ...(shift.closedAt ? { createdAt: { gte: shift.openedAt, lte: shift.closedAt } } : {}),
        },
        include: {
          payments: true,
          items: true,
          customer: { select: { name: true } },
        },
        orderBy: { createdAt: 'asc' },
      });

      const report = calculateReport(invoices);

      // Calculate top products from invoice items
      const productMap = new Map<string, {
        productId: string;
        name: string;
        nameEn: string | null;
        quantity: number;
        total: number;
      }>();

      for (const inv of invoices) {
        if (inv.status === 'FINALIZED' && inv.items) {
          for (const item of inv.items) {
            const pid = item.productId || `custom_${item.name}`;
            const existing = productMap.get(pid);
            const qty = toNumber(item.quantity);
            const rev = toNumber(item.totalPrice);
            if (existing) {
              existing.quantity += qty;
              existing.total += rev;
            } else {
              productMap.set(pid, {
                productId: item.productId || pid,
                name: item.name,
                nameEn: item.nameEn || null,
                quantity: qty,
                total: rev,
              });
            }
          }
        }
      }

      const topProducts = Array.from(productMap.values())
        .sort((a, b) => b.total - a.total)
        .slice(0, 20)
        .map((p) => ({
          name: p.name,
          nameEn: p.nameEn,
          quantity: round2(p.quantity),
          total: round2(p.total),
        }));

      return NextResponse.json({
        mode: 'shift',
        shift: {
          id: shift.id,
          number: shift.number,
          userId: shift.userId,
          userName: shift.user?.name || null,
          branchId: shift.branchId,
          // Backward-compat alias: client reads `reportData.shift?.branch`
          branch: shift.branchId,
          status: shift.status,
          openedAt: shift.openedAt.toISOString(),
          closedAt: shift.closedAt ? shift.closedAt.toISOString() : null,
          openingCash: toNumber(shift.openingCash),
          closingCash: shift.closingCash !== null ? toNumber(shift.closingCash) : null,
          expectedCash: shift.expectedCash !== null ? toNumber(shift.expectedCash) : null,
          cashDifference: shift.cashDifference !== null ? toNumber(shift.cashDifference) : null,
        },
        ...report,
        topProducts,
      });
    }

    // Mode 2: Report by date range (and optionally userId)
    if (!dateFrom || !dateTo) {
      return NextResponse.json(
        { error: 'يجب تحديد رقم الوردية أو نطاق التاريخ' },
        { status: 400 }
      );
    }

    const invoiceWhere: any = {
      createdAt: {
        gte: new Date(dateFrom),
        lte: new Date(dateTo),
      },
      status: { in: ['FINALIZED', 'RETURNED'] },
    };
    if (branchId) invoiceWhere.branchId = branchId;

    const invoices = await db.pOSInvoice.findMany({
      where: invoiceWhere,
      include: {
        payments: true,
        items: {
          include: {
            product: { select: { id: true, name: true, nameEn: true } },
          },
        },
        customer: { select: { name: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    // Filter by userId if specified (via shift relation)
    let filteredInvoices = invoices;
    let shiftInfo: any = null;
    if (userId) {
      // Find shifts for this user in the date range
      const userShifts = await db.shift.findMany({
        where: {
          userId,
          openedAt: { lte: new Date(dateTo) },
          OR: [
            { closedAt: null },
            { closedAt: { gte: new Date(dateFrom) } },
          ],
        },
        include: {
          user: { select: { name: true, email: true } },
        },
      });

      // Filter invoices that fall within any of this user's shifts
      filteredInvoices = invoices.filter((inv) => {
        return userShifts.some((s) => {
          if (inv.branchId !== s.branchId) return false;
          const invDate = new Date(inv.createdAt);
          if (invDate < new Date(s.openedAt)) return false;
          if (s.closedAt && invDate > new Date(s.closedAt)) return false;
          return true;
        });
      });

      // Use first shift for header info
      if (userShifts.length > 0) {
        const s = userShifts[0];
        shiftInfo = {
          id: s.id,
          number: s.number,
          userName: s.user?.name || null,
          branchId: s.branchId,
          // Backward-compat alias: client reads `reportData.shift?.branch`
          branch: s.branchId,
          status: s.status,
          openedAt: new Date(s.openedAt).toISOString(),
          closedAt: s.closedAt ? new Date(s.closedAt).toISOString() : null,
          openingCash: toNumber(s.openingCash),
        };
      }
    }

    const report = calculateReport(filteredInvoices);

    // Calculate top products from invoice items
    const productMap = new Map<string, {
      productId: string;
      name: string;
      nameEn: string | null;
      quantity: number;
      total: number;
    }>();

    for (const inv of filteredInvoices) {
      if (inv.status === 'FINALIZED' && inv.items) {
        for (const item of inv.items) {
          const pid = item.productId || `custom_${item.name}`;
          const existing = productMap.get(pid);
          const qty = toNumber(item.quantity);
          const rev = toNumber(item.totalPrice);
          if (existing) {
            existing.quantity += qty;
            existing.total += rev;
          } else {
            productMap.set(pid, {
              productId: item.productId || pid,
              name: item.name,
              nameEn: item.nameEn || null,
              quantity: qty,
              total: rev,
            });
          }
        }
      }
    }

    const topProducts = Array.from(productMap.values())
      .sort((a, b) => b.total - a.total)
      .slice(0, 20)
      .map((p) => ({
        name: p.name,
        nameEn: p.nameEn,
        quantity: round2(p.quantity),
        total: round2(p.total),
      }));

    return NextResponse.json({
      mode: 'dateRange',
      shift: shiftInfo,
      filters: {
        userId: userId || null,
        dateFrom,
        dateTo,
        branchId: branchId || null,
      },
      ...report,
      topProducts,
    });
  } catch (error: any) {
    console.error('Error generating shift report:', error);
    return NextResponse.json(
      { error: 'فشل في إنشاء تقرير الوردية' },
      { status: 500 }
    );
  }
}

// Helper: Calculate report from invoice list — THE SINGLE SOURCE OF TRUTH
function calculateReport(invoices: any[]) {
  let totalSales = 0;
  let totalReturns = 0;
  let totalDiscounts = 0;
  let totalTax = 0;
  let totalCashSales = 0;
  let totalCardSales = 0;
  let totalOtherSales = 0;
  let invoiceCount = 0;
  let returnCount = 0;

  // Payment method breakdown with count
  const paymentMethodMap: Record<string, { amount: number; count: number }> = {};

  for (const invoice of invoices) {
    if (invoice.status === 'FINALIZED') {
      totalSales += toNumber(invoice.totalAmount);
      totalDiscounts += toNumber(invoice.discountAmount);
      totalTax += toNumber(invoice.taxAmount);
      invoiceCount++;

      // Payment breakdown from payments array
      if (invoice.payments && invoice.payments.length > 0) {
        for (const payment of invoice.payments) {
          const amount = toNumber(payment.amount);
          const method = payment.method;

          if (!paymentMethodMap[method]) {
            paymentMethodMap[method] = { amount: 0, count: 0 };
          }
          paymentMethodMap[method].amount += amount;
          paymentMethodMap[method].count += 1;

          if (method === 'CASH') {
            totalCashSales += amount;
          } else if (CARD_METHODS.includes(method)) {
            totalCardSales += amount;
          } else {
            totalOtherSales += amount;
          }
        }
      } else if (invoice.paymentMethod) {
        // Fallback: use invoice's primary payment method
        const amt = toNumber(invoice.totalAmount);
        const method = invoice.paymentMethod;

        if (!paymentMethodMap[method]) {
          paymentMethodMap[method] = { amount: 0, count: 0 };
        }
        paymentMethodMap[method].amount += amt;
        paymentMethodMap[method].count += 1;

        if (method === 'CASH') {
          totalCashSales += amt;
        } else if (CARD_METHODS.includes(method)) {
          totalCardSales += amt;
        } else {
          totalOtherSales += amt;
        }
      }
    } else if (invoice.status === 'RETURNED') {
      totalReturns += toNumber(invoice.totalAmount);
      returnCount++;
    }
  }

  // Build invoices list for the report
  const invoicesList = invoices.map((inv) => ({
    id: inv.id,
    invoiceNumber: inv.invoiceNumber,
    totalAmount: round2(toNumber(inv.totalAmount)),
    paymentMethod: inv.paymentMethod || (inv.payments && inv.payments.length > 0 ? inv.payments[0].method : null),
    isReturn: inv.status === 'RETURNED',
    createdAt: new Date(inv.createdAt).toISOString(),
    customerName: inv.customerName || inv.customer?.name || null,
    subtotal: round2(toNumber(inv.subtotal)),
    discountAmount: round2(toNumber(inv.discountAmount)),
    taxAmount: round2(toNumber(inv.taxAmount)),
  }));

  return {
    summary: {
      totalSales: round2(totalSales),
      totalReturns: round2(totalReturns),
      totalDiscounts: round2(totalDiscounts),
      totalTax: round2(totalTax),
      netSales: round2(totalSales - totalReturns),
      totalCashSales: round2(totalCashSales),
      totalCardSales: round2(totalCardSales),
      totalOtherSales: round2(totalOtherSales),
      invoiceCount,
      returnCount,
    },
    paymentBreakdown: Object.fromEntries(
      Object.entries(paymentMethodMap).map(([k, v]) => [k, { amount: round2(v.amount), count: v.count }])
    ),
    invoices: invoicesList,
    topProducts: [] as any[], // Populated by caller for date range mode
  };
}
