import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { generateEntryNumber, generateTransactionNumber } from '@/lib/accounting-engine';
import { toNumber, round2 } from '@/lib/decimal';
import { requireRole, checkWriteAccess } from '@/lib/api-auth';
import { getDefaultBranchId } from '@/lib/branch-resolver';
import { auditLog } from '@/lib/audit-log';

// POST /api/vat/settle - VAT Settlement (إقفال الضريبة)
//
// This endpoint performs the VAT closing entry (إقفال) which:
// 1. Clears Output Tax (2100) → Debit the credit balance
// 2. Clears Input Tax (1200) → Credit the debit balance
// 3. Transfers the net to Tax Payable (2600)
//
// Correct accounting methodology:
//   Do NOT record Tax Payable with every invoice — only use:
//     ضريبة المدخلات (Input Tax 1200) for purchases
//     ضريبة المخرجات (Output Tax 2100) for sales
//   Then at settlement time (إقفال):
//     من حـ/ ضريبة المخرجات (2100)  → Debit to clear
//        إلى حـ/ ضريبة المدخلات (1200)  → Credit to clear
//        إلى حـ/ ضريبة مستحقة (2600)     → Credit net (if net > 0, owe VAT)
//     OR
//        من حـ/ ضريبة مستحقة (2600)      → Debit net (if net < 0, refund due)
//
// After settlement:
//   Input Tax (1200) = 0
//   Output Tax (2100) = 0
//   Tax Payable (2600) = net amount owed/refundable
//
// Then separately pay via /api/vat/pay from 2600 to Cash/Bank
export async function POST(request: NextRequest) {
  try {
    const auth = await requireRole('ADMIN'); if (!auth.authenticated) return auth.response;
    const writeCheck = checkWriteAccess(auth, 'settings'); if (!writeCheck.authenticated) return writeCheck.response;
    const body = await request.json();
    const { date, description } = body;

    const result = await db.$transaction(async (tx) => {
      // Resolve default branchId (UUID)
      const branchId = await getDefaultBranchId();

      // Find VAT accounts
      const outputTaxAccount = await tx.account.findFirst({ where: { code: '2100' } });
      const inputTaxAccount = await tx.account.findFirst({ where: { code: '1200' } });
      const taxPayableAccount = await tx.account.findFirst({ where: { code: '2600' } });

      if (!outputTaxAccount || !inputTaxAccount) {
        throw new Error('حسابات الضريبة غير موجودة');
      }
      if (!taxPayableAccount) {
        throw new Error('حساب ضريبة مستحقة (2600) غير موجود. يجب تهيئة شجرة الحسابات أولاً.');
      }

      // Calculate current balances from posted journal lines
      const outputSums = await tx.journalLine.aggregate({
        where: {
          accountId: outputTaxAccount.id,
          journalEntry: { status: 'POSTED' },
        },
        _sum: { debit: true, credit: true },
      });

      const inputSums = await tx.journalLine.aggregate({
        where: {
          accountId: inputTaxAccount.id,
          journalEntry: { status: 'POSTED' },
        },
        _sum: { debit: true, credit: true },
      });

      // Output Tax (2100) is LIABILITY → credit normal → balance = credit - debit
      const outputTaxBalance = round2(toNumber(outputSums._sum.credit) - toNumber(outputSums._sum.debit));
      // Input Tax (1200) is ASSET → debit normal → balance = debit - credit
      const inputTaxBalance = round2(toNumber(inputSums._sum.debit) - toNumber(inputSums._sum.credit));
      const netVAT = round2(outputTaxBalance - inputTaxBalance);

      // Check if there's anything to settle
      if (Math.abs(outputTaxBalance) < 0.01 && Math.abs(inputTaxBalance) < 0.01) {
        throw new Error('لا توجد أرصدة ضريبية لتسويتها');
      }

      // Create Transaction header
      const transactionNumber = await generateTransactionNumber(tx);
      const entryNumber = await generateEntryNumber(tx);

      const settlementDate = date ? new Date(date) : new Date();

      const transaction = await tx.transaction.create({
        data: {
          transactionNumber,
          type: 'TRANSFER',
          subType: 'VAT_SETTLEMENT',
          date: settlementDate,
          description: description || 'إقفال الضريبة - تحويل إلى ضريبة مستحقة',
          branchId,
          totalAmount: Math.abs(netVAT),
          netAmount: Math.abs(netVAT),
          status: 'POSTED',
        },
      });

      // Build journal entry lines:
      // من حـ/ ضريبة المخرجات (2100)    → Debit to clear the credit balance
      //    إلى حـ/ ضريبة المدخلات (1200) → Credit to clear the debit balance
      //    إلى حـ/ ضريبة مستحقة (2600)   → Credit net if we owe (netVAT > 0)
      // أو من حـ/ ضريبة مستحقة (2600)   → Debit net if refund due (netVAT < 0)
      const lines: { accountId: string; debit: number; credit: number; description: string }[] = [];

      // Clear Output Tax (2100) - debit the credit balance
      if (outputTaxBalance > 0.005) {
        lines.push({
          accountId: outputTaxAccount.id,
          debit: outputTaxBalance,
          credit: 0,
          description: 'إقفال ضريبة المخرجات',
        });
      }

      // Clear Input Tax (1200) - credit the debit balance
      if (inputTaxBalance > 0.005) {
        lines.push({
          accountId: inputTaxAccount.id,
          debit: 0,
          credit: inputTaxBalance,
          description: 'إقفال ضريبة المدخلات',
        });
      }

      // Net transfer to Tax Payable (2600)
      if (Math.abs(netVAT) > 0.005) {
        if (netVAT > 0) {
          // We owe VAT → Credit Tax Payable (liability increases)
          lines.push({
            accountId: taxPayableAccount.id,
            debit: 0,
            credit: netVAT,
            description: 'تحويل صافي الضريبة المستحقة',
          });
        } else {
          // We are owed refund → Debit Tax Payable (asset/receivable)
          lines.push({
            accountId: taxPayableAccount.id,
            debit: Math.abs(netVAT),
            credit: 0,
            description: 'تحويل صافي الضريبة المستردة',
          });
        }
      }

      // Validate balanced entry
      const totalDebit = round2(lines.reduce((sum, l) => sum + l.debit, 0));
      const totalCredit = round2(lines.reduce((sum, l) => sum + l.credit, 0));

      if (Math.abs(totalDebit - totalCredit) > 0.01) {
        throw new Error(`القيد غير متوازن: مدين=${totalDebit}, دائن=${totalCredit}`);
      }

      // Create journal entry
      const journalEntry = await tx.journalEntry.create({
        data: {
          entryNumber,
          date: settlementDate,
          description: description || 'إقفال الضريبة - تحويل إلى ضريبة مستحقة',
          type: 'MANUAL',
          status: 'POSTED',
          branchId,
          amount: Math.abs(netVAT),
          transactionId: transaction.id,
        },
      });

      // Create journal lines
      for (const line of lines) {
        await tx.journalLine.create({
          data: {
            journalEntryId: journalEntry.id,
            accountId: line.accountId,
            debit: line.debit,
            credit: line.credit,
            description: line.description,
          },
        });
      }

      // Update account balances
      const affectedAccountIds = lines.map(l => l.accountId);
      for (const accountId of new Set(affectedAccountIds)) {
        const accSums = await tx.journalLine.aggregate({
          where: {
            accountId,
            journalEntry: { status: 'POSTED' },
          },
          _sum: { debit: true, credit: true },
        });
        const account = await tx.account.findUnique({ where: { id: accountId } });
        if (account) {
          const { NORMAL_BALANCE } = await import('@/lib/types');
          const normalBalance = NORMAL_BALANCE[account.type as any];
          const balance = normalBalance === 'DEBIT'
            ? round2(toNumber(accSums._sum.debit) - toNumber(accSums._sum.credit))
            : round2(toNumber(accSums._sum.credit) - toNumber(accSums._sum.debit));
          await tx.account.update({
            where: { id: accountId },
            data: { currentBalance: balance },
          });
        }
      }

      return {
        transactionNumber,
        entryNumber,
        outputTaxBalance,
        inputTaxBalance,
        netVAT,
        totalDebit,
        totalCredit,
      };
    }, { timeout: 20000 });

    // AUDIT-9-18 — VAT settlement is a CRITICAL accounting operation
    auditLog({
      action: 'FINALIZE',
      entity: 'VAT',
      entityNumber: result.transactionNumber,
      description: `إقفال ضريبة القيمة المضافة - صافي: ${result.netVAT} (TXN ${result.transactionNumber}, JE ${result.entryNumber})`,
      userId: auth.userId,
      userName: auth.email,
      userRole: auth.role,
      severity: 'CRITICAL',
      category: 'ACCOUNTING',
      details: {
        outputTaxBalance: result.outputTaxBalance,
        inputTaxBalance: result.inputTaxBalance,
        netVAT: result.netVAT,
        transactionNumber: result.transactionNumber,
        entryNumber: result.entryNumber,
      },
    }).catch(() => {});

    return NextResponse.json({
      success: true,
      message: 'تم إقفال الضريبة بنجاح - تم تحويل الرصيد إلى حساب ضريبة مستحقة (2600)',
      ...result,
    });
  } catch (error: any) {
    console.error('[VAT_SETTLE] Error:', error);
    return NextResponse.json(
      { error: 'فشل في إقفال الضريبة' },
      { status: 500 }
    );
  }
}
