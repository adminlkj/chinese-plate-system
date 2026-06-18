import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { toNumber, round2 } from '@/lib/decimal';
import { requireAuth } from '@/lib/api-auth';

// GET /api/vat/status - Get current VAT position
// Returns:
//   - Unsettled VAT: Output Tax (2100) - Input Tax (1200) = pending amount
//   - Tax Payable (2600): actual balance from journal lines (after settlement)
//   - Available payment accounts for paying the tax
export async function GET() {
  try {
    const auth = await requireAuth(); if (!auth.authenticated) return auth.response;
    const outputTaxAccount = await db.account.findFirst({ where: { code: '2100' } });
    const inputTaxAccount = await db.account.findFirst({ where: { code: '1200' } });
    const taxPayableAccount = await db.account.findFirst({ where: { code: '2600' } });

    // Calculate unsettled balances from Input/Output Tax accounts
    const outputSums = await db.journalLine.aggregate({
      where: {
        accountId: outputTaxAccount?.id || 'none',
        journalEntry: { status: 'POSTED' },
      },
      _sum: { debit: true, credit: true },
    });

    const inputSums = await db.journalLine.aggregate({
      where: {
        accountId: inputTaxAccount?.id || 'none',
        journalEntry: { status: 'POSTED' },
      },
      _sum: { debit: true, credit: true },
    });

    // Output Tax (2100) is LIABILITY → credit normal → balance = credit - debit
    const outputTaxBalance = round2(toNumber(outputSums._sum.credit) - toNumber(outputSums._sum.debit));
    // Input Tax (1200) is ASSET → debit normal → balance = debit - credit
    const inputTaxBalance = round2(toNumber(inputSums._sum.debit) - toNumber(inputSums._sum.credit));
    // Unsettled net VAT = Output - Input (amount not yet closed to Tax Payable)
    const unsettledNetVAT = round2(outputTaxBalance - inputTaxBalance);

    // Tax Payable (2600) actual balance from journal lines
    // LIABILITY → credit normal → balance = credit - debit
    const taxPayableSums = await db.journalLine.aggregate({
      where: {
        accountId: taxPayableAccount?.id || 'none',
        journalEntry: { status: 'POSTED' },
      },
      _sum: { debit: true, credit: true },
    });
    const taxPayableBalance = round2(
      toNumber(taxPayableSums._sum.credit) - toNumber(taxPayableSums._sum.debit)
    );

    // Get available payment accounts (Cash + Banks)
    const paymentAccounts = await db.account.findMany({
      where: {
        isActive: true,
        code: { in: ['1000', '1010', '1020'] },
      },
      select: { id: true, code: true, name: true, nameEn: true, type: true },
    });

    // Check if there are unsettled VAT balances (Input/Output still have balances)
    const hasSettlableBalance = Math.abs(outputTaxBalance) > 0.01 || Math.abs(inputTaxBalance) > 0.01;
    // Check if Tax Payable has a balance that needs to be paid
    const hasPayableBalance = Math.abs(taxPayableBalance) > 0.01;

    return NextResponse.json({
      outputTax: {
        code: '2100',
        name: outputTaxAccount?.name || 'ضريبة مخرجات',
        nameEn: outputTaxAccount?.nameEn || 'Output Tax',
        balance: outputTaxBalance,
        totalDebit: toNumber(outputSums._sum.debit),
        totalCredit: toNumber(outputSums._sum.credit),
      },
      inputTax: {
        code: '1200',
        name: inputTaxAccount?.name || 'ضريبة مدخلات',
        nameEn: inputTaxAccount?.nameEn || 'Input Tax',
        balance: inputTaxBalance,
        totalDebit: toNumber(inputSums._sum.debit),
        totalCredit: toNumber(inputSums._sum.credit),
      },
      unsettledNetTax: {
        balance: unsettledNetVAT,
        status: unsettledNetVAT > 0 ? 'PAYABLE' : unsettledNetVAT < 0 ? 'REFUNDABLE' : 'ZERO',
      },
      taxPayable: {
        code: '2600',
        name: taxPayableAccount?.name || 'ضريبة مستحقة',
        nameEn: taxPayableAccount?.nameEn || 'Tax Payable',
        balance: taxPayableBalance,
        totalDebit: toNumber(taxPayableSums._sum.debit),
        totalCredit: toNumber(taxPayableSums._sum.credit),
        status: taxPayableBalance > 0 ? 'OWED' : taxPayableBalance < 0 ? 'REFUND_DUE' : 'ZERO',
      },
      paymentAccounts,
      hasSettlableBalance,
      hasPayableBalance,
    });
  } catch (error: any) {
    console.error('[VAT_STATUS] Error:', error);
    return NextResponse.json(
      { error: 'فشل في جلب حالة الضريبة' },
      { status: 500 }
    );
  }
}
