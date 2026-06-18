import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { toNumber, round2 } from '@/lib/decimal';
import { requireAuth, checkReadAccess, assertBranchAccess } from '@/lib/api-auth';
import { resolveBranchIdOrNull } from '@/lib/branch-resolver';

// GET /api/reports/purchase-report
// Purchase report: purchases grouped by supplier, totals, payment breakdown
// Query params: dateFrom, dateTo, supplierId, branch
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth();
    if (!auth.authenticated) return auth.response;
    const readCheck = checkReadAccess(auth, 'advanced-reports'); if (!readCheck.authenticated) return readCheck.response;

    const { searchParams } = new URL(request.url);
    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');
    const supplierId = searchParams.get('supplierId');
    const branchInput = searchParams.get('branch') || searchParams.get('branchId');

    // Resolve branchId (UUID) or null if 'all'/not specified
    const branchId = (branchInput && branchInput !== 'all')
      ? await resolveBranchIdOrNull(branchInput)
      : null;

    // Build where clause for Transaction model
    const where: any = {
      type: { in: ['PURCHASE', 'PURCHASE_RETURN'] },
      status: 'POSTED',
    };

    if (supplierId) {
      where.supplierId = supplierId;
    }

    if (branchId) {
      where.branchId = branchId;
      // Verify the user has access to this branch (Layer 3 business rule)
      const branchCheck = assertBranchAccess(auth, branchId);
      if (!branchCheck.authenticated) return branchCheck.response;
    }

    if (dateFrom || dateTo) {
      where.date = {};
      if (dateFrom) {
        const from = new Date(dateFrom);
        from.setHours(0, 0, 0, 0);
        where.date.gte = from;
      }
      if (dateTo) {
        const to = new Date(dateTo);
        to.setHours(23, 59, 59, 999);
        where.date.lte = to;
      }
    }

    // Fetch transactions with supplier info
    const transactions = await db.transaction.findMany({
      where,
      include: {
        supplier: {
          select: {
            id: true,
            name: true,
            nameEn: true,
            phone: true,
          },
        },
        journalEntries: {
          select: {
            type: true,
            paymentMethod: true,
            amount: true,
            taxAmount: true,
          },
        },
      },
      orderBy: { date: 'desc' },
    });

    // ─── Group by supplier ───
    const supplierMap = new Map<string, {
      supplierId: string;
      supplierName: string;
      supplierNameEn: string | null;
      supplierPhone: string | null;
      purchaseCount: number;
      returnCount: number;
      totalPurchaseAmount: number;
      totalReturnAmount: number;
      totalTax: number;
      totalDiscount: number;
      netAmount: number;
      paymentBreakdown: Record<string, number>;
      purchases: any[];
    }>();

    for (const txn of transactions) {
      const sid = txn.supplierId || 'unknown';
      const isReturn = txn.type === 'PURCHASE_RETURN';

      if (!supplierMap.has(sid)) {
        supplierMap.set(sid, {
          supplierId: sid,
          supplierName: txn.supplier?.name || txn.counterParty || 'غير محدد',
          supplierNameEn: txn.supplier?.nameEn || null,
          supplierPhone: txn.supplier?.phone || null,
          purchaseCount: 0,
          returnCount: 0,
          totalPurchaseAmount: 0,
          totalReturnAmount: 0,
          totalTax: 0,
          totalDiscount: 0,
          netAmount: 0,
          paymentBreakdown: {},
          purchases: [],
        });
      }

      const group = supplierMap.get(sid)!;
      const amount = toNumber(txn.totalAmount);
      const tax = toNumber(txn.taxAmount);
      const discount = toNumber(txn.discountAmount);
      const net = toNumber(txn.netAmount);

      if (isReturn) {
        group.returnCount += 1;
        group.totalReturnAmount += net;
      } else {
        group.purchaseCount += 1;
        group.totalPurchaseAmount += net;
      }

      group.totalTax += tax;
      group.totalDiscount += discount;
      group.netAmount += isReturn ? -net : net;

      // Payment method breakdown
      const method = txn.paymentMethod || txn.subType || 'CREDIT';
      group.paymentBreakdown[method] = (group.paymentBreakdown[method] || 0) + (isReturn ? -net : net);

      group.purchases.push({
        id: txn.id,
        transactionNumber: txn.transactionNumber,
        type: txn.type,
        subType: txn.subType,
        date: new Date(txn.date).toISOString(),
        description: txn.description,
        referenceCode: txn.referenceCode,
        branch: txn.branchId,
        totalAmount: toNumber(txn.totalAmount),
        taxAmount: tax,
        discountAmount: discount,
        netAmount: net,
        paymentMethod: txn.paymentMethod,
        counterParty: txn.counterParty,
        invoiceNumber: txn.invoiceNumber,
      });
    }

    // Build supplier groups with rounding
    const bySupplier = Array.from(supplierMap.values()).map((g) => ({
      ...g,
      totalPurchaseAmount: round2(g.totalPurchaseAmount),
      totalReturnAmount: round2(g.totalReturnAmount),
      totalTax: round2(g.totalTax),
      totalDiscount: round2(g.totalDiscount),
      netAmount: round2(g.netAmount),
      paymentBreakdown: Object.fromEntries(
        Object.entries(g.paymentBreakdown).map(([k, v]) => [k, round2(v)])
      ),
    }));

    // ─── Grand totals ───
    const grandPurchaseAmount = round2(bySupplier.reduce((s, g) => s + g.totalPurchaseAmount, 0));
    const grandReturnAmount = round2(bySupplier.reduce((s, g) => s + g.totalReturnAmount, 0));
    const grandTax = round2(bySupplier.reduce((s, g) => s + g.totalTax, 0));
    const grandDiscount = round2(bySupplier.reduce((s, g) => s + g.totalDiscount, 0));
    const grandNet = round2(bySupplier.reduce((s, g) => s + g.netAmount, 0));
    const totalPurchaseCount = bySupplier.reduce((s, g) => s + g.purchaseCount, 0);
    const totalReturnCount = bySupplier.reduce((s, g) => s + g.returnCount, 0);

    // ─── Overall payment breakdown ───
    const overallPaymentBreakdown: Record<string, number> = {};
    for (const g of bySupplier) {
      for (const [method, amount] of Object.entries(g.paymentBreakdown)) {
        overallPaymentBreakdown[method] = (overallPaymentBreakdown[method] || 0) + amount;
      }
    }
    // Round overall breakdown
    for (const [method, amount] of Object.entries(overallPaymentBreakdown)) {
      overallPaymentBreakdown[method] = round2(amount);
    }

    return NextResponse.json({
      dateFrom: dateFrom || null,
      dateTo: dateTo || null,
      supplierId: supplierId || null,
      branch: branchId || branchInput || 'all',
      summary: {
        totalSuppliers: bySupplier.length,
        totalPurchaseCount,
        totalReturnCount,
        grandPurchaseAmount,
        grandReturnAmount,
        grandTax,
        grandDiscount,
        grandNet,
        paymentBreakdown: overallPaymentBreakdown,
      },
      bySupplier,
    });
  } catch (error: any) {
    console.error('[purchase-report] Error:', error);
    return NextResponse.json(
      { error: 'فشل في إنشاء تقرير المشتريات' },
      { status: 500 }
    );
  }
}
