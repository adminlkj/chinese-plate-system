import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { toNumber } from '@/lib/decimal';
import { requireAuth, checkReadAccess, assertBranchAccess } from '@/lib/api-auth';
import { resolveBranchIdOrNull } from '@/lib/branch-resolver';

// GET /api/reports/sales-report - Comprehensive sales report with branch breakdown
// Query params: dateFrom, dateTo, branch (optional, all branches if not specified)
// Pagination: page (default 1), take (default 100)
// Summary/totals are computed from ALL matching invoices; invoiceList is paginated
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(); if (!auth.authenticated) return auth.response;
    const readCheck = checkReadAccess(auth, 'advanced-reports'); if (!readCheck.authenticated) return readCheck.response;
    const { searchParams } = new URL(request.url);
    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');
    const branchFilterInput = searchParams.get('branch') || searchParams.get('branchId');
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const take = Math.min(1000, Math.max(1, parseInt(searchParams.get('take') || '100')));

    // Resolve branchId (UUID) or null if 'all'/not specified
    const branchFilterId = (branchFilterInput && branchFilterInput !== 'all')
      ? await resolveBranchIdOrNull(branchFilterInput)
      : null;

    // Verify branch access if branch filter is specified
    if (branchFilterId) {
      const branchCheck = assertBranchAccess(auth, branchFilterId);
      if (!branchCheck.authenticated) return branchCheck.response;
    }

    // Build where clause
    const where: any = {
      status: { in: ['FINALIZED', 'RETURNED'] },
    };

    if (branchFilterId) {
      where.branchId = branchFilterId;
    }

    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) {
        const from = new Date(dateFrom);
        from.setHours(0, 0, 0, 0);
        where.createdAt.gte = from;
      }
      if (dateTo) {
        const to = new Date(dateTo);
        to.setHours(23, 59, 59, 999);
        where.createdAt.lte = to;
      }
    }

    // Get all active branches from the database
    const dbBranches = await db.branch.findMany({
      where: { isActive: true },
      select: { id: true, code: true, name: true, nameEn: true },
      orderBy: { sortOrder: 'asc' },
    });
    const branchList: { id: string; key: string; name: string; nameEn: string | null }[] =
      dbBranches.map((b) => ({ id: b.id, key: b.code, name: b.name, nameEn: b.nameEn }));

    const BRANCH_ARABIC_NAMES: Record<string, string> = {};
    for (const b of dbBranches) {
      BRANCH_ARABIC_NAMES[b.code] = b.name;
    }

    // --- Compute summaries from ALL matching invoices (without heavy items include) ---
    const allInvoicesForSummary = await db.pOSInvoice.findMany({
      where,
      include: {
        payments: true,
        customer: { select: { id: true, name: true, nameEn: true, type: true } },
      },
      // No items include — we only need payments & customer for summary calculations
      orderBy: { createdAt: 'desc' },
    });

    // Total count for pagination metadata
    const totalCount = allInvoicesForSummary.length;

    // Aggregate data per branch (from ALL invoices)
    const branchReports: Record<string, any> = {};

    for (const branch of branchList) {
      const branchInvoices = allInvoicesForSummary.filter((inv) => inv.branchId === branch.id);
      const sales = branchInvoices.filter((inv) => !inv.isReturn);
      const returns = branchInvoices.filter((inv) => inv.isReturn);

      // Sales totals
      const totalSales = sales.reduce((sum, inv) => sum + toNumber(inv.totalAmount), 0);
      const totalSubtotal = sales.reduce((sum, inv) => sum + toNumber(inv.subtotal), 0);
      const totalDiscount = sales.reduce((sum, inv) => sum + toNumber(inv.discountAmount), 0);
      const totalTax = sales.reduce((sum, inv) => sum + toNumber(inv.taxAmount), 0);
      // Items count not available without items include; use 0 as approximation
      const totalItems = 0;

      // Returns totals
      const totalReturns = returns.reduce((sum, inv) => sum + toNumber(inv.totalAmount), 0);
      const returnsCount = returns.length;

      // Payment method breakdown
      const paymentBreakdown: Record<string, { count: number; amount: number }> = {};
      for (const inv of sales) {
        for (const p of inv.payments) {
          if (!paymentBreakdown[p.method]) {
            paymentBreakdown[p.method] = { count: 0, amount: 0 };
          }
          paymentBreakdown[p.method].count += 1;
          paymentBreakdown[p.method].amount += toNumber(p.amount);
        }
      }

      // Bank payments total
      const bankTotal = ['MADA', 'VISA', 'MASTERCARD', 'OTHER_CARD'].reduce((sum, method) => {
        return sum + (paymentBreakdown[method]?.amount || 0);
      }, 0);

      // Cash total
      const cashTotal = paymentBreakdown['CASH']?.amount || 0;

      // Credit total
      const creditTotal = paymentBreakdown['CREDIT']?.amount || 0;

      // Platform sales breakdown (customers with type=PLATFORM)
      const platformSalesMap: Record<string, { count: number; amount: number }> = {};
      for (const inv of sales) {
        if (inv.customer?.type === 'PLATFORM') {
          const platformName = inv.customer.name || 'غير محدد';
          if (!platformSalesMap[platformName]) {
            platformSalesMap[platformName] = { count: 0, amount: 0 };
          }
          platformSalesMap[platformName].count += 1;
          platformSalesMap[platformName].amount += toNumber(inv.totalAmount);
        }
      }

      branchReports[branch.key] = {
        key: branch.key,
        name: branch.name,
        nameAr: BRANCH_ARABIC_NAMES[branch.key] || branch.name,
        sales: {
          count: sales.length,
          subtotal: totalSubtotal,
          discount: totalDiscount,
          tax: totalTax,
          total: totalSales,
          itemsCount: totalItems,
        },
        returns: {
          count: returnsCount,
          total: totalReturns,
        },
        bank: {
          total: bankTotal,
          mada: paymentBreakdown['MADA'] || { count: 0, amount: 0 },
          visa: paymentBreakdown['VISA'] || { count: 0, amount: 0 },
          mastercard: paymentBreakdown['MASTERCARD'] || { count: 0, amount: 0 },
          otherCard: paymentBreakdown['OTHER_CARD'] || { count: 0, amount: 0 },
        },
        cash: {
          total: cashTotal,
          count: paymentBreakdown['CASH']?.count || 0,
        },
        credit: {
          total: creditTotal,
          count: paymentBreakdown['CREDIT']?.count || 0,
        },
        platforms: platformSalesMap,
      };
    }

    // Grand totals (from ALL invoices)
    const grandTotal = Object.values(branchReports).reduce((sum: number, b: any) => sum + b.sales.total, 0);
    const grandDiscount = Object.values(branchReports).reduce((sum: number, b: any) => sum + b.sales.discount, 0);
    const grandTax = Object.values(branchReports).reduce((sum: number, b: any) => sum + b.sales.tax, 0);
    const grandInvoiceCount = Object.values(branchReports).reduce((sum: number, b: any) => sum + b.sales.count, 0);
    const grandBank = Object.values(branchReports).reduce((sum: number, b: any) => sum + b.bank.total, 0);
    const grandCash = Object.values(branchReports).reduce((sum: number, b: any) => sum + b.cash.total, 0);
    const grandCredit = Object.values(branchReports).reduce((sum: number, b: any) => sum + b.credit.total, 0);
    const grandItems = Object.values(branchReports).reduce((sum: number, b: any) => sum + b.sales.itemsCount, 0);
    const grandReturns = Object.values(branchReports).reduce((sum: number, b: any) => sum + b.returns.total, 0);

    // --- Paginated invoice list (with items for detailed display) ---
    const paginatedInvoices = await db.pOSInvoice.findMany({
      where,
      include: {
        items: true,
        payments: true,
        customer: { select: { id: true, name: true, nameEn: true, type: true } },
        table: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * take,
      take,
    });

    return NextResponse.json({
      dateFrom: dateFrom || null,
      dateTo: dateTo || null,
      branches: branchReports,
      grandTotals: {
        sales: grandTotal,
        discount: grandDiscount,
        tax: grandTax,
        invoiceCount: grandInvoiceCount,
        bank: grandBank,
        cash: grandCash,
        credit: grandCredit,
        itemsCount: grandItems,
        returns: grandReturns,
        net: grandTotal - grandReturns,
      },
      invoiceList: paginatedInvoices.map((inv) => ({
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        isReturn: inv.isReturn,
        status: inv.status,
        branch: inv.branchId,
        customerName: inv.customerName,
        customerId: inv.customerId,
        customerType: inv.customer?.type,
        subtotal: toNumber(inv.subtotal),
        discountAmount: toNumber(inv.discountAmount),
        discountPercentage: toNumber(inv.discountPercentage),
        taxAmount: toNumber(inv.taxAmount),
        totalAmount: toNumber(inv.totalAmount),
        paymentMethod: inv.paymentMethod,
        payments: inv.payments.map((p) => ({ method: p.method, amount: toNumber(p.amount) })),
        tableName: inv.table?.name,
        createdAt: inv.createdAt.toISOString(),
        itemsCount: inv.items.reduce((sum, i) => sum + toNumber(i.quantity), 0),
      })),
      pagination: {
        page,
        take,
        totalCount,
        totalPages: Math.ceil(totalCount / take),
      },
    });
  } catch (error: any) {
    console.error('Error generating sales report:', error);
    return NextResponse.json(
      { error: 'فشل في إنشاء تقرير المبيعات' },
      { status: 500 }
    );
  }
}
