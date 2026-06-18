import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { generateEntryNumber, generateTransactionNumber } from '@/lib/accounting-engine';
import { toNumber, round2 } from '@/lib/decimal';
import { NORMAL_BALANCE, type AccountType } from '@/lib/types';
import { requireRole, checkWriteAccess } from '@/lib/api-auth';
import { getDefaultBranchId } from '@/lib/branch-resolver';
import { auditLog } from '@/lib/audit-log';

// POST /api/vat/pay - Pay VAT from Tax Payable (2600) to Cash/Bank
//
// This is the second step after VAT settlement (إقفال):
//   Step 1 (إقفال): /api/vat/settle → transfers 1200+2100 to 2600
//   Step 2 (سداد):  /api/vat/pay   → pays from 2600 to Cash/Bank
//
// Journal entry:
//   من حـ/ ضريبة مستحقة (2600)  → Debit to clear the liability
//      إلى حـ/ النقدية/البنك     → Credit (actual payment)
//
// Or if Tax Payable has a debit balance (refund due):
//   من حـ/ النقدية/البنك        → Debit (receive refund)
//      إلى حـ/ ضريبة مستحقة (2600) → Credit to clear the asset
export async function POST(request: NextRequest) {
  try {
    const auth = await requireRole('ADMIN'); if (!auth.authenticated) return auth.response;
    const writeCheck = checkWriteAccess(auth, 'settings'); if (!writeCheck.authenticated) return writeCheck.response;
    const body = await request.json();
    const { paymentAccountId, date, description, amount: overrideAmount } = body;

    if (!paymentAccountId) {
      return NextResponse.json(
        { error: 'يجب اختيار حساب السداد (نقدية أو بنك)' },
        { status: 400 }
      );
    }

    const result = await db.$transaction(async (tx) => {
      // Resolve default branchId (UUID)
      const branchId = await getDefaultBranchId();

      // Find Tax Payable account (2600)
      const taxPayableAccount = await tx.account.findFirst({ where: { code: '2600' } });
      const paymentAccount = await tx.account.findUnique({ where: { id: paymentAccountId } });

      if (!taxPayableAccount) {
        throw new Error('حساب ضريبة مستحقة (2600) غير موجود');
      }
      if (!paymentAccount) {
        throw new Error('حساب السداد غير موجود');
      }

      // Calculate current balance of Tax Payable from journal lines
      const taxPayableSums = await tx.journalLine.aggregate({
        where: {
          accountId: taxPayableAccount.id,
          journalEntry: { status: 'POSTED' },
        },
        _sum: { debit: true, credit: true },
      });

      // Tax Payable (2600) is LIABILITY → credit normal → balance = credit - debit
      // Positive balance = we owe VAT (credit balance)
      // Negative balance = refund due (debit balance)
      const taxPayableBalance = round2(
        toNumber(taxPayableSums._sum.credit) - toNumber(taxPayableSums._sum.debit)
      );

      // Determine amount to pay
      const payAmount = overrideAmount && overrideAmount > 0
        ? round2(overrideAmount)
        : Math.abs(taxPayableBalance);

      if (payAmount < 0.01) {
        throw new Error('لا يوجد رصيد ضريبة مستحقة للسداد');
      }

      // Cannot pay more than the balance
      if (payAmount > Math.abs(taxPayableBalance) + 0.01) {
        throw new Error(`مبلغ السداد (${payAmount}) أكبر من رصيد الضريبة المستحقة (${Math.abs(taxPayableBalance)})`);
      }

      // Create Transaction header
      const transactionNumber = await generateTransactionNumber(tx);
      const entryNumber = await generateEntryNumber(tx);

      const paymentDate = date ? new Date(date) : new Date();

      const transaction = await tx.transaction.create({
        data: {
          transactionNumber,
          type: 'PAYMENT',
          subType: 'VAT_PAYMENT',
          date: paymentDate,
          description: description || 'سداد ضريبة مستحقة',
          branchId,
          totalAmount: payAmount,
          netAmount: payAmount,
          status: 'POSTED',
        },
      });

      // Build journal entry lines
      const lines: { accountId: string; debit: number; credit: number; description: string }[] = [];

      if (taxPayableBalance > 0) {
        // We owe VAT → pay from cash/bank to clear the liability
        // من حـ/ ضريبة مستحقة (2600)  → Debit (clear liability)
        //    إلى حـ/ النقدية/البنك     → Credit (payment out)
        lines.push({
          accountId: taxPayableAccount.id,
          debit: payAmount,
          credit: 0,
          description: 'سداد ضريبة مستحقة',
        });
        lines.push({
          accountId: paymentAccount.id,
          debit: 0,
          credit: payAmount,
          description: `سداد ضريبة من ${paymentAccount.name}`,
        });
      } else if (taxPayableBalance < 0) {
        // Refund due → receive to cash/bank
        // من حـ/ النقدية/البنك        → Debit (receive refund)
        //    إلى حـ/ ضريبة مستحقة (2600) → Credit (clear asset)
        lines.push({
          accountId: paymentAccount.id,
          debit: payAmount,
          credit: 0,
          description: `استرداد ضريبة إلى ${paymentAccount.name}`,
        });
        lines.push({
          accountId: taxPayableAccount.id,
          debit: 0,
          credit: payAmount,
          description: 'استرداد ضريبة مستحقة',
        });
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
          date: paymentDate,
          description: description || 'سداد ضريبة مستحقة',
          type: 'MANUAL',
          status: 'POSTED',
          branchId,
          amount: payAmount,
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
      const affectedAccountIds = [...new Set(lines.map(l => l.accountId))];
      for (const accountId of affectedAccountIds) {
        const accSums = await tx.journalLine.aggregate({
          where: {
            accountId,
            journalEntry: { status: 'POSTED' },
          },
          _sum: { debit: true, credit: true },
        });
        const account = await tx.account.findUnique({ where: { id: accountId } });
        if (account) {
          const normalBalance = NORMAL_BALANCE[account.type as AccountType];
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
        taxPayableBalance,
        payAmount,
        totalDebit,
        totalCredit,
        paymentAccount: paymentAccount.name,
      };
    }, { timeout: 20000 });

    // AUDIT-9-18 — VAT payment is a CRITICAL accounting operation (cash outflow)
    auditLog({
      action: 'FINALIZE',
      entity: 'VAT',
      entityNumber: result.transactionNumber,
      description: `سداد ضريبة مستحقة - المبلغ: ${result.payAmount} من ${result.paymentAccount} (TXN ${result.transactionNumber})`,
      userId: auth.userId,
      userName: auth.email,
      userRole: auth.role,
      severity: 'CRITICAL',
      category: 'ACCOUNTING',
      details: {
        payAmount: result.payAmount,
        taxPayableBalance: result.taxPayableBalance,
        paymentAccount: result.paymentAccount,
        transactionNumber: result.transactionNumber,
        entryNumber: result.entryNumber,
      },
    }).catch(() => {});

    return NextResponse.json({
      success: true,
      message: 'تم سداد الضريبة المستحقة بنجاح',
      ...result,
    });
  } catch (error: any) {
    console.error('[VAT_PAY] Error:', error);
    return NextResponse.json(
      { error: 'فشل في سداد الضريبة' },
      { status: 500 }
    );
  }
}
