import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireRole, checkWriteAccess } from '@/lib/api-auth';
import { updateAccountBalance } from '@/lib/accounting-engine';

/**
 * POST /api/data/fix-purchase-return-vat
 *
 * SECURITY: Requires ADMIN role + write access to settings.
 *
 * Fix purchase return journal entries that incorrectly posted VAT to Output Tax (2100)
 * instead of Input Tax (1200).
 */
export async function POST(request: NextRequest) {
  try {
    // SECURITY: Require ADMIN + write access
    const auth = await requireRole('ADMIN', request);
    if (!auth.authenticated) return auth.response;

    const writeCheck = checkWriteAccess(auth, 'settings');
    if (!writeCheck.authenticated) return writeCheck.response;

    const result = await db.$transaction(async (tx) => {
      const outputTaxAccount = await tx.account.findFirst({ where: { code: '2100' } });
      const inputTaxAccount = await tx.account.findFirst({ where: { code: '1200' } });

      if (!outputTaxAccount || !inputTaxAccount) {
        return { fixedCount: 0, message: 'VAT accounts not found, nothing to fix' };
      }

      const wrongLines = await tx.journalLine.findMany({
        where: {
          accountId: outputTaxAccount.id,
          journalEntry: {
            type: { in: ['PURCHASE_RETURN_CASH', 'PURCHASE_RETURN_BANK', 'PURCHASE_RETURN_CREDIT'] },
          },
        },
        include: {
          journalEntry: {
            select: { entryNumber: true, type: true },
          },
        },
      });

      if (wrongLines.length === 0) {
        return { fixedCount: 0, message: 'No purchase return VAT entries to fix' };
      }

      let fixedCount = 0;

      for (const line of wrongLines) {
        await tx.journalLine.update({
          where: { id: line.id },
          data: { accountId: inputTaxAccount.id },
        });
        fixedCount++;
      }

      await updateAccountBalance(outputTaxAccount.id, tx);
      await updateAccountBalance(inputTaxAccount.id, tx);

      const taxPayableAccount = await tx.account.findFirst({ where: { code: '2600' } });
      if (taxPayableAccount) {
        await updateAccountBalance(taxPayableAccount.id, tx);
      }

      return { fixedCount };
    }, { timeout: 30000 });

    return NextResponse.json({
      success: true,
      message: `تم إصلاح ${result.fixedCount} قيد ضريبي - نقل من ضريبة المخرجات (2100) إلى ضريبة المدخلات (1200)`,
      ...result,
    });
  } catch (error: unknown) {
    console.error('[FIX_PURCHASE_RETURN_VAT] Error:', error);
    return NextResponse.json(
      { error: 'فشل في إصلاح قيود مرتجع المشتريات' },
      { status: 500 }
    );
  }
}
