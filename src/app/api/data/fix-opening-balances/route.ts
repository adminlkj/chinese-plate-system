import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { createTransaction, updateAccountBalance } from '@/lib/accounting-engine';
import { NORMAL_BALANCE } from '@/lib/types';
import { toNumber } from '@/lib/decimal';
import { requireRole, checkWriteAccess } from '@/lib/api-auth';

// Helper to generate entry number within a transaction
async function generateEntryNumberTx(tx: any): Promise<string> {
  const lastEntry = await tx.journalEntry.findFirst({
    orderBy: { entryNumber: 'desc' },
    select: { entryNumber: true },
  });

  if (!lastEntry) return 'JE-0001';

  const num = parseInt(lastEntry.entryNumber.replace('JE-', ''));
  return `JE-${String(num + 1).padStart(4, '0')}`;
}

// POST /api/data/fix-opening-balances - Fix accounts that have openingBalance set but no journal entry
// WRAPPED IN $transaction for atomicity: all fixes must succeed or fail together
export async function POST() {
  try {
    const auth = await requireRole('ADMIN'); if (!auth.authenticated) return auth.response;
    const writeCheck = checkWriteAccess(auth, 'settings'); if (!writeCheck.authenticated) return writeCheck.response;
    const result = await db.$transaction(async (tx) => {
      const accounts = await tx.account.findMany({
        where: {
          openingBalance: { not: 0 },
        },
      });

      let fixedCount = 0;

      for (const account of accounts) {
        // Check if there's already an OPENING_BALANCE journal entry for this account
        const existingEntry = await tx.journalEntry.findFirst({
          where: {
            type: 'OPENING_BALANCE',
            lines: {
              some: { accountId: account.id },
            },
          },
        });

        if (!existingEntry) {
          // No journal entry exists - create one within the same transaction
          const nb = NORMAL_BALANCE[account.type as keyof typeof NORMAL_BALANCE];
          const capitalAccount = await tx.account.findFirst({ where: { code: '3000' } });

          if (!capitalAccount) {
            // Skip accounts that can't have opening balance entries without the capital account
            continue;
          }

          const amount = Math.abs(toNumber(account.openingBalance));
          const entryNumber = await generateEntryNumberTx(tx);

          let period = await tx.fiscalPeriod.findFirst({ where: { status: 'OPEN' } });
          if (!period) {
            period = await tx.fiscalPeriod.create({
              data: {
                name: 'الفترة الحالية',
                startDate: new Date(new Date().getFullYear(), 0, 1),
                endDate: new Date(new Date().getFullYear(), 11, 31),
                status: 'OPEN',
              },
            });
          }

          if (nb === 'DEBIT') {
            await tx.journalEntry.create({
              data: {
                entryNumber,
                date: new Date(new Date().getFullYear(), 0, 1),
                description: `رصيد افتتاحي - ${account.name}`,
                type: 'OPENING_BALANCE',
                status: 'POSTED',
                amount,
                periodId: period.id,
                lines: {
                  create: [
                    { accountId: account.id, debit: amount, credit: 0 },
                    { accountId: capitalAccount.id, debit: 0, credit: amount },
                  ],
                },
              },
            });
          } else {
            await tx.journalEntry.create({
              data: {
                entryNumber,
                date: new Date(new Date().getFullYear(), 0, 1),
                description: `رصيد افتتاحي - ${account.name}`,
                type: 'OPENING_BALANCE',
                status: 'POSTED',
                amount,
                periodId: period.id,
                lines: {
                  create: [
                    { accountId: capitalAccount.id, debit: amount, credit: 0 },
                    { accountId: account.id, debit: 0, credit: amount },
                  ],
                },
              },
            });
          }

          // Update balances for both accounts
          await updateAccountBalance(account.id, tx);
          await updateAccountBalance(capitalAccount.id, tx);

          fixedCount++;
        }
      }

      // Recalculate all balances within the same transaction
      const allAccounts = await tx.account.findMany();
      for (const acc of allAccounts) {
        await updateAccountBalance(acc.id, tx);
      }

      return { fixedCount };
    });

    return NextResponse.json({
      success: true,
      message: `تم إصلاح ${result.fixedCount} حساب وإعادة حساب جميع الأرصدة`,
      fixedCount: result.fixedCount,
    });
  } catch (error: any) {
    console.error('[POST /api/data/fix-opening-balances]', error);
    return NextResponse.json({ error: 'فشل في إصلاح الأرصدة الافتتاحية' }, { status: 500 });
  }
}
