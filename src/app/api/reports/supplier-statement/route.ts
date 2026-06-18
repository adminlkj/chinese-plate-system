import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { toNumber, round2 } from '@/lib/decimal';
import { requireAuth, checkReadAccess, getUserAllowedBranches } from '@/lib/api-auth';

// GET /api/reports/supplier-statement
// Supplier statement: opening balance, all transactions (purchases/returns/payments), closing balance
// Query params: supplierId (required), dateFrom, dateTo
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth();
    if (!auth.authenticated) return auth.response;
    const readCheck = checkReadAccess(auth, 'suppliers'); if (!readCheck.authenticated) return readCheck.response;

    // Get the list of branches the user is allowed to access (null = all branches)
    const allowedBranchIds = getUserAllowedBranches(auth);

    const { searchParams } = new URL(request.url);
    const supplierId = searchParams.get('supplierId');
    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');

    // Validate required param
    if (!supplierId) {
      return NextResponse.json(
        { error: 'معرف المورد مطلوب' },
        { status: 400 }
      );
    }

    // Fetch supplier info
    const supplier = await db.supplier.findUnique({
      where: { id: supplierId },
      select: {
        id: true,
        name: true,
        nameEn: true,
        phone: true,
        email: true,
        balance: true,
      },
    });

    if (!supplier) {
      return NextResponse.json(
        { error: 'المورد غير موجود' },
        { status: 404 }
      );
    }

    // Build date filters
    const fromDate = dateFrom ? new Date(dateFrom) : null;
    const toDate = dateTo ? new Date(dateTo) : null;
    if (fromDate) fromDate.setHours(0, 0, 0, 0);
    if (toDate) toDate.setHours(23, 59, 59, 999);

    // ─── Fetch ALL posted purchase transactions for this supplier ───
    // Filter by allowed branches (Layer 3: prevents cross-branch data leak)
    const allTransactions = await db.transaction.findMany({
      where: {
        supplierId,
        type: { in: ['PURCHASE', 'PURCHASE_RETURN', 'PAYMENT'] },
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
        totalAmount: true,
        taxAmount: true,
        discountAmount: true,
        netAmount: true,
        paymentMethod: true,
        referenceCode: true,
        branchId: true,
        counterParty: true,
      },
    });

    // ─── Calculate opening balance (all transactions BEFORE dateFrom) ───
    let openingBalance = 0;

    for (const txn of allTransactions) {
      const txnDate = new Date(txn.date);
      if (fromDate && txnDate >= fromDate) continue;

      const amount = toNumber(txn.netAmount);
      if (txn.type === 'PURCHASE') {
        openingBalance += amount; // Purchases increase what we owe
      } else if (txn.type === 'PURCHASE_RETURN') {
        openingBalance -= amount; // Returns decrease what we owe
      } else if (txn.type === 'PAYMENT') {
        openingBalance -= amount; // Payments decrease what we owe
      }
    }

    openingBalance = round2(openingBalance);

    // ─── Build transaction list for the date range ───
    interface StatementTransaction {
      date: string;
      type: 'PURCHASE' | 'PURCHASE_RETURN' | 'PAYMENT';
      reference: string;
      description: string;
      debit: number;   // Amount we owe (purchases)
      credit: number;  // Amount we paid or returned
      balance: number; // Running balance (what we owe)
      branch: string;
      paymentMethod: string | null;
    }

    const transactions: StatementTransaction[] = [];

    for (const txn of allTransactions) {
      const txnDate = new Date(txn.date);
      if (fromDate && txnDate < fromDate) continue;
      if (toDate && txnDate > toDate) continue;

      const amount = toNumber(txn.netAmount);

      if (txn.type === 'PURCHASE') {
        transactions.push({
          date: txnDate.toISOString(),
          type: 'PURCHASE',
          reference: txn.transactionNumber,
          description: txn.description || `مشتريات ${txn.transactionNumber}`,
          debit: round2(amount),
          credit: 0,
          balance: 0,
          branch: txn.branchId,
          paymentMethod: txn.paymentMethod,
        });
      } else if (txn.type === 'PURCHASE_RETURN') {
        transactions.push({
          date: txnDate.toISOString(),
          type: 'PURCHASE_RETURN',
          reference: txn.transactionNumber,
          description: txn.description || `مرتجع مشتريات ${txn.transactionNumber}`,
          debit: 0,
          credit: round2(amount),
          balance: 0,
          branch: txn.branchId,
          paymentMethod: txn.paymentMethod,
        });
      } else if (txn.type === 'PAYMENT') {
        transactions.push({
          date: txnDate.toISOString(),
          type: 'PAYMENT',
          reference: txn.transactionNumber,
          description: txn.description || `سداد ${txn.transactionNumber}`,
          debit: 0,
          credit: round2(amount),
          balance: 0,
          branch: txn.branchId,
          paymentMethod: txn.paymentMethod,
        });
      }
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
    const totalPurchases = round2(transactions.filter((t) => t.type === 'PURCHASE').reduce((s, t) => s + t.debit, 0));
    const totalReturns = round2(transactions.filter((t) => t.type === 'PURCHASE_RETURN').reduce((s, t) => s + t.credit, 0));
    const totalPayments = round2(transactions.filter((t) => t.type === 'PAYMENT').reduce((s, t) => s + t.credit, 0));

    return NextResponse.json({
      supplier: {
        id: supplier.id,
        name: supplier.name,
        nameEn: supplier.nameEn,
        phone: supplier.phone,
        email: supplier.email,
        currentBalance: toNumber(supplier.balance),
      },
      dateFrom: dateFrom || null,
      dateTo: dateTo || null,
      openingBalance,
      closingBalance,
      summary: {
        totalPurchases,
        totalReturns,
        totalPayments,
        netChange: round2(totalPurchases - totalReturns - totalPayments),
        purchaseCount: transactions.filter((t) => t.type === 'PURCHASE').length,
        returnCount: transactions.filter((t) => t.type === 'PURCHASE_RETURN').length,
        paymentCount: transactions.filter((t) => t.type === 'PAYMENT').length,
      },
      transactions,
    });
  } catch (error: any) {
    console.error('[supplier-statement] Error:', error);
    return NextResponse.json(
      { error: 'فشل في إنشاء كشف حساب المورد' },
      { status: 500 }
    );
  }
}
