import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { toNumber, round2 } from '@/lib/decimal';
import { requireAuth, checkReadAccess, getUserAllowedBranches } from '@/lib/api-auth';

// GET /api/reports/customer-statement
// Customer statement: opening balance, all transactions (sales/returns/collections), closing balance
// Query params: customerId (required), dateFrom, dateTo
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth();
    if (!auth.authenticated) return auth.response;
    const readCheck = checkReadAccess(auth, 'customers'); if (!readCheck.authenticated) return readCheck.response;

    // Get the list of branches the user is allowed to access (null = all branches)
    const allowedBranchIds = getUserAllowedBranches(auth);

    const { searchParams } = new URL(request.url);
    const customerId = searchParams.get('customerId');
    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');

    // Validate required param
    if (!customerId) {
      return NextResponse.json(
        { error: 'معرف العميل مطلوب' },
        { status: 400 }
      );
    }

    // Fetch customer info
    const customer = await db.customer.findUnique({
      where: { id: customerId },
      select: {
        id: true,
        name: true,
        nameEn: true,
        type: true,
        phone: true,
        email: true,
        balance: true,
      },
    });

    if (!customer) {
      return NextResponse.json(
        { error: 'العميل غير موجود' },
        { status: 404 }
      );
    }

    // Build date filters
    const fromDate = dateFrom ? new Date(dateFrom) : null;
    const toDate = dateTo ? new Date(dateTo) : null;
    if (fromDate) fromDate.setHours(0, 0, 0, 0);
    if (toDate) toDate.setHours(23, 59, 59, 999);

    // ─── Fetch ALL finalized invoices (sales + returns) for this customer ───
    // Filter by allowed branches (Layer 3: prevents cross-branch data leak)
    const allInvoices = await db.pOSInvoice.findMany({
      where: {
        customerId,
        status: { in: ['FINALIZED', 'RETURNED'] },
        ...(allowedBranchIds ? { branchId: { in: allowedBranchIds } } : {}),
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        invoiceNumber: true,
        isReturn: true,
        status: true,
        branchId: true,
        totalAmount: true,
        discountAmount: true,
        taxAmount: true,
        subtotal: true,
        paymentMethod: true,
        createdAt: true,
      },
    });

    // ─── Fetch ALL collection transactions for this customer ───
    // Filter by allowed branches (Layer 3: prevents cross-branch data leak)
    const allCollections = await db.transaction.findMany({
      where: {
        customerId,
        type: 'COLLECTION',
        status: 'POSTED',
        ...(allowedBranchIds ? { branchId: { in: allowedBranchIds } } : {}),
      },
      orderBy: { date: 'asc' },
      select: {
        id: true,
        transactionNumber: true,
        type: true,
        subType: true,
        date: true,
        description: true,
        netAmount: true,
        paymentMethod: true,
        referenceCode: true,
        branchId: true,
      },
    });

    // ─── Calculate opening balance (all transactions BEFORE dateFrom) ───
    let openingBalance = 0;

    // Sales before dateFrom (non-returns increase what customer owes)
    const salesBefore = allInvoices.filter(
      (inv) => !inv.isReturn && (!fromDate || new Date(inv.createdAt) < fromDate)
    );
    const salesBeforeTotal = salesBefore.reduce((s, inv) => s + toNumber(inv.totalAmount), 0);

    // Returns before dateFrom (returns decrease what customer owes)
    const returnsBefore = allInvoices.filter(
      (inv) => inv.isReturn && (!fromDate || new Date(inv.createdAt) < fromDate)
    );
    const returnsBeforeTotal = returnsBefore.reduce((s, inv) => s + toNumber(inv.totalAmount), 0);

    // Collections before dateFrom
    const collectionsBefore = allCollections.filter(
      (txn) => !fromDate || new Date(txn.date) < fromDate
    );
    const collectionsBeforeTotal = collectionsBefore.reduce((s, txn) => s + toNumber(txn.netAmount), 0);

    openingBalance = round2(salesBeforeTotal - returnsBeforeTotal - collectionsBeforeTotal);

    // ─── Build transaction list for the date range ───
    interface StatementTransaction {
      date: string;
      type: 'SALE' | 'RETURN' | 'COLLECTION';
      reference: string;
      description: string;
      debit: number;   // Amount customer owes (sales)
      credit: number;  // Amount customer paid or returned
      balance: number; // Running balance
      branch: string;
      paymentMethod: string | null;
    }

    const transactions: StatementTransaction[] = [];

    // Filter invoices in date range
    const invoicesInRange = allInvoices.filter((inv) => {
      const invDate = new Date(inv.createdAt);
      if (fromDate && invDate < fromDate) return false;
      if (toDate && invDate > toDate) return false;
      return true;
    });

    // Filter collections in date range
    const collectionsInRange = allCollections.filter((txn) => {
      const txnDate = new Date(txn.date);
      if (fromDate && txnDate < fromDate) return false;
      if (toDate && txnDate > toDate) return false;
      return true;
    });

    // Add sales and returns
    for (const inv of invoicesInRange) {
      const amount = toNumber(inv.totalAmount);
      if (inv.isReturn) {
        transactions.push({
          date: new Date(inv.createdAt).toISOString(),
          type: 'RETURN',
          reference: inv.invoiceNumber,
          description: `مرتجع فاتورة ${inv.invoiceNumber}`,
          debit: 0,
          credit: round2(amount),
          balance: 0, // will be calculated below
          branch: inv.branchId,
          paymentMethod: inv.paymentMethod,
        });
      } else {
        transactions.push({
          date: new Date(inv.createdAt).toISOString(),
          type: 'SALE',
          reference: inv.invoiceNumber,
          description: `فاتورة مبيعات ${inv.invoiceNumber}`,
          debit: round2(amount),
          credit: 0,
          balance: 0,
          branch: inv.branchId,
          paymentMethod: inv.paymentMethod,
        });
      }
    }

    // Add collections
    for (const txn of collectionsInRange) {
      const amount = toNumber(txn.netAmount);
      transactions.push({
        date: new Date(txn.date).toISOString(),
        type: 'COLLECTION',
        reference: txn.transactionNumber,
        description: txn.description || `تحصيل ${txn.transactionNumber}`,
        debit: 0,
        credit: round2(amount),
        balance: 0,
        branch: txn.branchId,
        paymentMethod: txn.paymentMethod,
      });
    }

    // Sort by date
    transactions.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    // Calculate running balance
    let runningBalance = openingBalance;
    for (const txn of transactions) {
      runningBalance = round2(runningBalance + txn.debit - txn.credit);
      txn.balance = runningBalance;
    }

    const closingBalance = round2(runningBalance);

    // ─── Summary ───
    const totalSales = round2(transactions.filter((t) => t.type === 'SALE').reduce((s, t) => s + t.debit, 0));
    const totalReturns = round2(transactions.filter((t) => t.type === 'RETURN').reduce((s, t) => s + t.credit, 0));
    const totalCollections = round2(transactions.filter((t) => t.type === 'COLLECTION').reduce((s, t) => s + t.credit, 0));

    return NextResponse.json({
      customer: {
        id: customer.id,
        name: customer.name,
        nameEn: customer.nameEn,
        type: customer.type,
        phone: customer.phone,
        email: customer.email,
        currentBalance: toNumber(customer.balance),
      },
      dateFrom: dateFrom || null,
      dateTo: dateTo || null,
      openingBalance,
      closingBalance,
      summary: {
        totalSales,
        totalReturns,
        totalCollections,
        netChange: round2(totalSales - totalReturns - totalCollections),
        salesCount: transactions.filter((t) => t.type === 'SALE').length,
        returnsCount: transactions.filter((t) => t.type === 'RETURN').length,
        collectionsCount: transactions.filter((t) => t.type === 'COLLECTION').length,
      },
      transactions,
    });
  } catch (error: any) {
    console.error('[customer-statement] Error:', error);
    return NextResponse.json(
      { error: 'فشل في إنشاء كشف حساب العميل' },
      { status: 500 }
    );
  }
}
