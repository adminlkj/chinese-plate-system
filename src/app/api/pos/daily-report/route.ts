import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { TAX_RATE } from '@/lib/types';
import { toNumber } from '@/lib/decimal';
import { requireAuth, checkReadAccess, assertBranchAccess } from '@/lib/api-auth';
import { resolveBranchId } from '@/lib/branch-resolver';

// POST /api/pos/daily-report - Generate comprehensive daily report for a branch
// Restaurant day: 11:30 AM → 4:00 AM next day
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(); if (!auth.authenticated) return auth.response;
    const readCheck = checkReadAccess(auth, 'pos'); if (!readCheck.authenticated) return readCheck.response;
    const body = await request.json();
    const { date } = body;

    // Resolve branchId (UUID) from body.branch (code/name/id) or body.branchId
    const branchId = await resolveBranchId(body.branch || body.branchId);
    if (!branchId) {
      return NextResponse.json({ error: 'الفرع مطلوب' }, { status: 400 });
    }

    // Verify the user has access to this branch (use the RESOLVED UUID, not the raw input)
    const branchCheck = assertBranchAccess(auth, branchId);
    if (!branchCheck.authenticated) return branchCheck.response;

    // Calculate the restaurant day range
    // The restaurant day starts at 11:30 AM and ends at 4:00 AM the next day
    const targetDate = date ? new Date(date) : new Date();

    // Start: 11:30 AM of the target date
    const dayStart = new Date(targetDate);
    dayStart.setHours(11, 30, 0, 0);

    // End: 4:00 AM of the next day
    const dayEnd = new Date(targetDate);
    dayEnd.setDate(dayEnd.getDate() + 1);
    dayEnd.setHours(4, 0, 0, 0);

    // If the current time is between midnight and 4:00 AM,
    // the "day" started yesterday at 11:30 AM
    const now = new Date();
    if (!date) {
      const currentHour = now.getHours();
      if (currentHour < 4) {
        // We're between midnight and 4 AM — the day started yesterday
        dayStart.setDate(dayStart.getDate() - 1);
        dayEnd.setDate(dayEnd.getDate() - 1);
      }
    }

    // Fetch all finalized invoices for this branch in the time range
    const invoices = await db.pOSInvoice.findMany({
      where: {
        branchId,
        status: { in: ['FINALIZED', 'RETURNED'] },
        createdAt: {
          gte: dayStart,
          lt: dayEnd,
        },
      },
      include: {
        items: true,
        payments: true,
        customer: { select: { id: true, name: true, type: true } },
        table: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    // Fetch returns for this branch in the time range
    const returns = invoices.filter((inv) => inv.isReturn);
    const sales = invoices.filter((inv) => !inv.isReturn);

    // Calculate sales totals
    const totalSales = sales.reduce((sum, inv) => sum + toNumber(inv.totalAmount), 0);
    const totalSalesSubtotal = sales.reduce((sum, inv) => sum + toNumber(inv.subtotal), 0);
    const totalSalesTax = sales.reduce((sum, inv) => sum + toNumber(inv.taxAmount), 0);
    const totalSalesDiscount = sales.reduce((sum, inv) => sum + toNumber(inv.discountAmount), 0);

    // Calculate returns totals
    const totalReturns = returns.reduce((sum, inv) => sum + toNumber(inv.totalAmount), 0);
    const totalReturnsSubtotal = returns.reduce((sum, inv) => sum + toNumber(inv.subtotal), 0);
    const totalReturnsTax = returns.reduce((sum, inv) => sum + toNumber(inv.taxAmount), 0);

    // Net totals
    const netSales = totalSales - totalReturns;
    const netTax = totalSalesTax - totalReturnsTax;
    const netSubtotal = totalSalesSubtotal - totalReturnsSubtotal;

    // Payment method breakdown (net of returns)
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
    // Subtract return payments from the breakdown
    for (const inv of returns) {
      for (const p of inv.payments) {
        if (!paymentBreakdown[p.method]) {
          paymentBreakdown[p.method] = { count: 0, amount: 0 };
        }
        paymentBreakdown[p.method].count += 1;
        paymentBreakdown[p.method].amount -= toNumber(p.amount);
      }
    }

    // Top selling items
    const itemSalesMap: Record<string, { name: string; nameEn?: string; quantity: number; total: number }> = {};
    for (const inv of sales) {
      for (const item of inv.items) {
        if (!itemSalesMap[item.name]) {
          itemSalesMap[item.name] = { name: item.name, nameEn: item.nameEn || undefined, quantity: 0, total: 0 };
        }
        itemSalesMap[item.name].quantity += toNumber(item.quantity);
        itemSalesMap[item.name].total += toNumber(item.totalPrice);
      }
    }
    const topItems = Object.values(itemSalesMap).sort((a, b) => b.total - a.total).slice(0, 20);

    // Customer type breakdown
    const platformSales = sales.filter((inv) => inv.customer?.type === 'PLATFORM');
    const cashSales = sales.filter((inv) => !inv.customer || inv.customer?.type !== 'PLATFORM');
    const platformTotal = platformSales.reduce((sum, inv) => sum + toNumber(inv.totalAmount), 0);
    const cashTotal = cashSales.reduce((sum, inv) => sum + toNumber(inv.totalAmount), 0);

    // Invoice count
    const salesCount = sales.length;
    const returnsCount = returns.length;

    // Average invoice value
    const avgInvoiceValue = salesCount > 0 ? totalSales / salesCount : 0;

    // ─── Customer Balances ──────────────────────────────────────────────────
    // Find all customers who had CREDIT payments in this period
    // and calculate their credit totals
    const customerCreditMap: Record<string, {
      customerId: string;
      customerName: string;
      creditTotal: number;
      type: string;
    }> = {};

    for (const inv of sales) {
      for (const p of inv.payments) {
        if (p.method === 'CREDIT' && inv.customerId) {
          if (!customerCreditMap[inv.customerId]) {
            customerCreditMap[inv.customerId] = {
              customerId: inv.customerId,
              customerName: inv.customerName || inv.customer?.name || 'غير معروف',
              creditTotal: 0,
              type: inv.customer?.type || 'PLATFORM',
            };
          }
          customerCreditMap[inv.customerId].creditTotal += toNumber(p.amount);
        }
      }
    }
    // Subtract credit returns
    for (const inv of returns) {
      for (const p of inv.payments) {
        if (p.method === 'CREDIT' && inv.customerId) {
          if (!customerCreditMap[inv.customerId]) {
            customerCreditMap[inv.customerId] = {
              customerId: inv.customerId,
              customerName: inv.customerName || inv.customer?.name || 'غير معروف',
              creditTotal: 0,
              type: inv.customer?.type || 'PLATFORM',
            };
          }
          customerCreditMap[inv.customerId].creditTotal -= toNumber(p.amount);
        }
      }
    }

    // Also fetch the current running balance for each credit customer from the Customer record
    const creditCustomerIds = Object.keys(customerCreditMap);
    let customerCurrentBalances: Record<string, number> = {};
    if (creditCustomerIds.length > 0) {
      const customers = await db.customer.findMany({
        where: { id: { in: creditCustomerIds } },
        select: { id: true, balance: true },
      });
      customerCurrentBalances = Object.fromEntries(
        customers.map((c) => [c.id, toNumber(c.balance)])
      );
    }

    const customerBalances = Object.values(customerCreditMap).map((cb) => ({
      customerId: cb.customerId,
      customerName: cb.customerName,
      creditTotal: cb.creditTotal,
      currentBalance: customerCurrentBalances[cb.customerId] ?? 0,
      type: cb.type,
    }));

    // Branch info — fetch from DB to get current branch name
    let branchName = branchId;
    try {
      const branchRecord = await db.branch.findUnique({
        where: { id: branchId },
        select: { name: true, nameEn: true, code: true },
      });
      branchName = branchRecord?.name || branchRecord?.nameEn || branchRecord?.code || branchId;
    } catch {
      // ignore — fall back to branchId
    }

    return NextResponse.json({
      branchId,
      branchName,
      dayStart: dayStart.toISOString(),
      dayEnd: dayEnd.toISOString(),
      sales: {
        count: salesCount,
        subtotal: totalSalesSubtotal,
        discount: totalSalesDiscount,
        tax: totalSalesTax,
        total: totalSales,
      },
      returns: {
        count: returnsCount,
        subtotal: totalReturnsSubtotal,
        tax: totalReturnsTax,
        total: totalReturns,
      },
      net: {
        subtotal: netSubtotal,
        tax: netTax,
        total: netSales,
      },
      paymentBreakdown,
      customerBreakdown: {
        platform: { count: platformSales.length, total: platformTotal },
        cash: { count: cashSales.length, total: cashTotal },
      },
      customerBalances,
      topItems,
      avgInvoiceValue,
      invoiceList: invoices.map((inv) => ({
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        isReturn: inv.isReturn,
        status: inv.status,
        customerName: inv.customerName,
        customerType: inv.customer?.type || 'CASH',
        subtotal: toNumber(inv.subtotal),
        discountPercentage: toNumber(inv.discountPercentage),
        discountAmount: toNumber(inv.discountAmount),
        taxAmount: toNumber(inv.taxAmount),
        totalAmount: toNumber(inv.totalAmount),
        paymentMethod: inv.paymentMethod,
        payments: inv.payments.map((p) => ({
          method: p.method,
          amount: toNumber(p.amount),
        })),
        tableName: inv.table?.name,
        createdAt: inv.createdAt.toISOString(),
        itemsCount: inv.items.length,
        items: inv.items.map((item) => ({
          name: item.name,
          nameEn: item.nameEn || undefined,
          quantity: toNumber(item.quantity),
          unitPrice: toNumber(item.unitPrice),
          totalPrice: toNumber(item.totalPrice),
        })),
      })),
    });
  } catch (error: any) {
    console.error('Error generating daily report:', error);
    return NextResponse.json(
      { error: 'فشل في إنشاء التقرير اليومي' },
      { status: 500 }
    );
  }
}
