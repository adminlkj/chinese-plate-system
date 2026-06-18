import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { toNumber, round2 } from '@/lib/decimal';
import { requireAuth } from '@/lib/api-auth';

// GET /api/vat/quarterly-report?year=2024&quarter=1
// Returns detailed VAT data for a specific quarter for the tax declaration
//
// CRITICAL: Tax amounts MUST come from Transaction.taxAmount, NOT from journal line
// balances. Journal line balances include settlement entries that clear the VAT
// accounts, which would incorrectly show 0 tax after settlement.
// Transaction.taxAmount is the historical record of tax collected/paid per transaction.
//
// Quarter mapping:
//   Q1: Jan-Mar, Q2: Apr-Jun, Q3: Jul-Sep, Q4: Oct-Dec
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth();
    if (!auth.authenticated) return auth.response;

    const { searchParams } = new URL(request.url);
    const year = parseInt(searchParams.get('year') || String(new Date().getFullYear()));
    const quarter = parseInt(searchParams.get('quarter') || String(Math.ceil((new Date().getMonth() + 1) / 3)));

    if (quarter < 1 || quarter > 4) {
      return NextResponse.json({ error: 'الربع يجب أن يكون بين 1 و 4' }, { status: 400 });
    }

    // Calculate quarter date range
    const quarterStartMonth = (quarter - 1) * 3; // 0, 3, 6, 9
    const startDate = new Date(year, quarterStartMonth, 1);
    const endDate = new Date(year, quarterStartMonth + 3, 1); // first day of next quarter

    // Get company settings
    const settings = await db.setting.findMany();
    const settingsMap: Record<string, string> = {};
    for (const s of settings) {
      settingsMap[s.key] = s.value;
    }

    // Find VAT accounts (needed for current balance display)
    const outputTaxAccount = await db.account.findFirst({ where: { code: '2100' } });
    const inputTaxAccount = await db.account.findFirst({ where: { code: '1200' } });
    const taxPayableAccount = await db.account.findFirst({ where: { code: '2600' } });

    if (!outputTaxAccount || !inputTaxAccount) {
      return NextResponse.json({ error: 'حسابات الضريبة غير موجودة. يجب تهيئة شجرة الحسابات أولاً.' }, { status: 400 });
    }

    // ═══════════════════════════════════════════════════════════════
    // USE TRANSACTION TAX AMOUNTS - NOT JOURNAL LINE BALANCES
    // This is the only reliable way to get historical tax data
    // that's not affected by VAT settlement (إقفال) entries.
    // ═══════════════════════════════════════════════════════════════

    // Sales transactions (for output tax and taxable base)
    const salesTransactions = await db.transaction.findMany({
      where: {
        type: { in: ['SALE', 'SALE_RETURN'] },
        status: 'POSTED',
        date: { gte: startDate, lt: endDate },
      },
      select: {
        transactionNumber: true,
        type: true,
        subType: true,
        date: true,
        branchId: true,
        totalAmount: true,
        taxAmount: true,
        discountAmount: true,
        netAmount: true,
        counterParty: true,
      },
      orderBy: { date: 'asc' },
    });

    // Purchase/Expense transactions (for input tax and taxable base)
    const purchaseTransactions = await db.transaction.findMany({
      where: {
        type: { in: ['PURCHASE', 'PURCHASE_RETURN', 'EXPENSE'] },
        status: 'POSTED',
        date: { gte: startDate, lt: endDate },
      },
      select: {
        transactionNumber: true,
        type: true,
        subType: true,
        date: true,
        branchId: true,
        totalAmount: true,
        taxAmount: true,
        discountAmount: true,
        netAmount: true,
        counterParty: true,
      },
      orderBy: { date: 'asc' },
    });

    // ─── Calculate summary figures from Transaction.taxAmount ───

    // Output tax = sum of taxAmount from SALE transactions - sum from SALE_RETURN transactions
    const totalOutputTax = round2(
      salesTransactions
        .filter(t => t.type === 'SALE')
        .reduce((sum, t) => sum + toNumber(t.taxAmount), 0)
      - salesTransactions
        .filter(t => t.type === 'SALE_RETURN')
        .reduce((sum, t) => sum + toNumber(t.taxAmount), 0)
    );

    // Input tax = sum of taxAmount from PURCHASE/EXPENSE - sum from PURCHASE_RETURN
    const totalInputTax = round2(
      purchaseTransactions
        .filter(t => t.type !== 'PURCHASE_RETURN')
        .reduce((sum, t) => sum + toNumber(t.taxAmount), 0)
      - purchaseTransactions
        .filter(t => t.type === 'PURCHASE_RETURN')
        .reduce((sum, t) => sum + toNumber(t.taxAmount), 0)
    );

    // Net VAT = Output Tax - Input Tax
    const netVAT = round2(totalOutputTax - totalInputTax);

    // Sales taxable base (total sales amount before tax)
    const totalSalesBase = round2(salesTransactions
      .filter(t => t.type === 'SALE')
      .reduce((sum, t) => sum + toNumber(t.totalAmount), 0));
    const totalSalesReturnsBase = round2(salesTransactions
      .filter(t => t.type === 'SALE_RETURN')
      .reduce((sum, t) => sum + toNumber(t.totalAmount), 0));
    const netSalesBase = round2(totalSalesBase - totalSalesReturnsBase);

    // Purchase taxable base
    const totalPurchaseBase = round2(purchaseTransactions
      .filter(t => t.type !== 'PURCHASE_RETURN')
      .reduce((sum, t) => sum + toNumber(t.totalAmount), 0));
    const totalPurchaseReturnsBase = round2(purchaseTransactions
      .filter(t => t.type === 'PURCHASE_RETURN')
      .reduce((sum, t) => sum + toNumber(t.totalAmount), 0));
    const netPurchaseBase = round2(totalPurchaseBase - totalPurchaseReturnsBase);

    // ─── Monthly breakdown ───
    const monthlyBreakdown: { month: number; label: string; salesBase: number; salesReturns: number; netSales: number; purchasesBase: number; outputTax: number; inputTax: number; netVAT: number }[] = [];
    const quarterMonths = [
      { month: quarterStartMonth + 1, label: getMonthLabel(quarterStartMonth) },
      { month: quarterStartMonth + 2, label: getMonthLabel(quarterStartMonth + 1) },
      { month: quarterStartMonth + 3, label: getMonthLabel(quarterStartMonth + 2) },
    ];

    for (const m of quarterMonths) {
      const mStart = new Date(year, m.month - 1, 1);
      const mEnd = new Date(year, m.month, 1);

      // Monthly sales base and output tax
      const mSalesBase = round2(salesTransactions
        .filter(t => t.type === 'SALE' && t.date >= mStart && t.date < mEnd)
        .reduce((sum, t) => sum + toNumber(t.totalAmount), 0));
      const mSalesReturns = round2(salesTransactions
        .filter(t => t.type === 'SALE_RETURN' && t.date >= mStart && t.date < mEnd)
        .reduce((sum, t) => sum + toNumber(t.totalAmount), 0));
      const mOutputTax = round2(
        salesTransactions
          .filter(t => t.type === 'SALE' && t.date >= mStart && t.date < mEnd)
          .reduce((sum, t) => sum + toNumber(t.taxAmount), 0)
        - salesTransactions
          .filter(t => t.type === 'SALE_RETURN' && t.date >= mStart && t.date < mEnd)
          .reduce((sum, t) => sum + toNumber(t.taxAmount), 0)
      );

      // Monthly purchase base and input tax
      const mPurchasesBase = round2(purchaseTransactions
        .filter(t => t.type !== 'PURCHASE_RETURN' && t.date >= mStart && t.date < mEnd)
        .reduce((sum, t) => sum + toNumber(t.totalAmount), 0));
      const mInputTax = round2(
        purchaseTransactions
          .filter(t => t.type !== 'PURCHASE_RETURN' && t.date >= mStart && t.date < mEnd)
          .reduce((sum, t) => sum + toNumber(t.taxAmount), 0)
        - purchaseTransactions
          .filter(t => t.type === 'PURCHASE_RETURN' && t.date >= mStart && t.date < mEnd)
          .reduce((sum, t) => sum + toNumber(t.taxAmount), 0)
      );

      monthlyBreakdown.push({
        month: m.month,
        label: m.label,
        salesBase: mSalesBase,
        salesReturns: mSalesReturns,
        netSales: round2(mSalesBase - mSalesReturns),
        purchasesBase: mPurchasesBase,
        outputTax: mOutputTax,
        inputTax: mInputTax,
        netVAT: round2(mOutputTax - mInputTax),
      });
    }

    // ─── Branch breakdown ───
    // Build a lookup of branchId → code for display keying
    const allBranches = await db.branch.findMany({ select: { id: true, code: true, name: true } });
    const branchCodeById = new Map<string, string>();
    for (const b of allBranches) branchCodeById.set(b.id, b.code);
    const branchBreakdown: Record<string, { salesBase: number; outputTax: number; purchasesBase: number; inputTax: number }> = {};

    // Helper to resolve a branchId to a display key (code) — fallback to 'UNKNOWN'
    const branchKey = (txnBranchId: string | null | undefined): string => {
      if (!txnBranchId) return 'UNKNOWN';
      return branchCodeById.get(txnBranchId) ?? 'UNKNOWN';
    };

    // Sales by branch
    for (const txn of salesTransactions.filter(t => t.type === 'SALE')) {
      const bKey = branchKey(txn.branchId);
      if (!branchBreakdown[bKey]) branchBreakdown[bKey] = { salesBase: 0, outputTax: 0, purchasesBase: 0, inputTax: 0 };
      branchBreakdown[bKey].salesBase = round2(branchBreakdown[bKey].salesBase + toNumber(txn.totalAmount));
      branchBreakdown[bKey].outputTax = round2(branchBreakdown[bKey].outputTax + toNumber(txn.taxAmount));
    }

    // Purchases by branch (typically NONE but include for completeness)
    for (const txn of purchaseTransactions.filter(t => t.type !== 'PURCHASE_RETURN')) {
      const bKey = branchKey(txn.branchId);
      if (!branchBreakdown[bKey]) branchBreakdown[bKey] = { salesBase: 0, outputTax: 0, purchasesBase: 0, inputTax: 0 };
      branchBreakdown[bKey].purchasesBase = round2(branchBreakdown[bKey].purchasesBase + toNumber(txn.totalAmount));
      branchBreakdown[bKey].inputTax = round2(branchBreakdown[bKey].inputTax + toNumber(txn.taxAmount));
    }

    // ─── VAT Settlements and Payments within the quarter ───
    // Get from Transaction model (VAT_SETTLEMENT and VAT_PAYMENT subtypes)
    const settlementTransactions = await db.transaction.findMany({
      where: {
        subType: { in: ['VAT_SETTLEMENT', 'VAT_PAYMENT'] },
        status: 'POSTED',
        date: { gte: startDate, lt: endDate },
      },
      select: {
        transactionNumber: true,
        type: true,
        subType: true,
        date: true,
        description: true,
        totalAmount: true,
      },
      orderBy: { date: 'asc' },
    });

    const settlements = settlementTransactions.map(t => ({
      date: t.date.toISOString().slice(0, 10),
      description: t.description || (t.subType === 'VAT_SETTLEMENT' ? 'إقفال ضريبة' : 'سداد ضريبة'),
      amount: toNumber(t.totalAmount),
      type: t.subType === 'VAT_SETTLEMENT' ? 'SETTLEMENT' : 'PAYMENT',
    }));

    // ─── Current unsettled balances (from journal lines) ───
    // This is intentionally different from the declaration data above.
    // Current balances show what's currently sitting in the VAT accounts
    // (may be 0 if already settled), while the declaration shows what
    // was actually collected/paid during the period.
    const allOutputSums = await db.journalLine.aggregate({
      where: { accountId: outputTaxAccount.id, journalEntry: { status: 'POSTED' } },
      _sum: { debit: true, credit: true },
    });
    const allInputSums = await db.journalLine.aggregate({
      where: { accountId: inputTaxAccount.id, journalEntry: { status: 'POSTED' } },
      _sum: { debit: true, credit: true },
    });
    const currentOutputTaxBalance = round2(toNumber(allOutputSums._sum.credit) - toNumber(allOutputSums._sum.debit));
    const currentInputTaxBalance = round2(toNumber(allInputSums._sum.debit) - toNumber(allInputSums._sum.credit));

    // ─── Build response ───
    const quarterLabel = `Q${quarter} ${year}`;
    const quarterPeriodLabel = getQuarterPeriodLabel(quarter, year);

    return NextResponse.json({
      // Company info
      company: {
        name: settingsMap.companyNameAr || settingsMap.companyName || '',
        nameEn: settingsMap.companyNameEn || settingsMap.companyName || '',
        taxNumber: settingsMap.taxNumber || '',
        activity: settingsMap.activity || '',
        crNumber: settingsMap.crNumber || '',
      },
      // Quarter info
      quarter: {
        number: quarter,
        year,
        label: quarterLabel,
        periodLabel: quarterPeriodLabel,
        startDate: startDate.toISOString().slice(0, 10),
        endDate: new Date(endDate.getTime() - 1).toISOString().slice(0, 10), // last day of quarter
      },
      // Summary - uses Transaction.taxAmount (NOT journal line balances)
      summary: {
        totalSalesBase,
        totalSalesReturnsBase,
        netSalesBase,
        totalPurchaseBase,
        totalPurchaseReturnsBase,
        netPurchaseBase,
        totalOutputTax,
        totalInputTax,
        netVAT,
        vatStatus: netVAT > 0 ? 'PAYABLE' : netVAT < 0 ? 'REFUNDABLE' : 'ZERO',
      },
      // Monthly breakdown - also uses Transaction.taxAmount
      monthlyBreakdown,
      // Branch breakdown
      branchBreakdown,
      // Current unsettled balances (from journal lines - may be 0 after settlement)
      currentBalances: {
        outputTax: currentOutputTaxBalance,
        inputTax: currentInputTaxBalance,
        unsettledNet: round2(currentOutputTaxBalance - currentInputTaxBalance),
      },
      // VAT settlements and payments in this quarter
      settlements,
      // Sales transaction detail
      salesDetail: salesTransactions.map(t => ({
        date: t.date.toISOString().slice(0, 10),
        transactionNumber: t.transactionNumber,
        type: t.type,
        subType: t.subType,
        description: t.counterParty || '',
        branch: t.branchId,
        baseAmount: toNumber(t.totalAmount),
        taxAmount: toNumber(t.taxAmount),
      })),
      // Purchase transaction detail
      purchaseDetail: purchaseTransactions.map(t => ({
        date: t.date.toISOString().slice(0, 10),
        transactionNumber: t.transactionNumber,
        type: t.type,
        subType: t.subType,
        description: t.counterParty || '',
        branch: t.branchId,
        baseAmount: toNumber(t.totalAmount),
        taxAmount: toNumber(t.taxAmount),
      })),
    });
  } catch (error: any) {
    console.error('[VAT_QUARTERLY_REPORT] Error:', error);
    return NextResponse.json(
      { error: 'فشل في جلب التقرير الضريبي الربعي' },
      { status: 500 }
    );
  }
}

function getMonthLabel(monthIndex: number): string {
  const months = [
    'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
    'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'
  ];
  return months[monthIndex] || '';
}

function getQuarterPeriodLabel(quarter: number, year: number): string {
  const ranges: Record<number, string> = {
    1: `يناير - مارس ${year}`,
    2: `أبريل - يونيو ${year}`,
    3: `يوليو - سبتمبر ${year}`,
    4: `أكتوبر - ديسمبر ${year}`,
  };
  return ranges[quarter] || '';
}
