import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { recalculateAllBalances } from '@/lib/accounting-engine';
import { requireRole, checkWriteAccess } from '@/lib/api-auth';
import { getDefaultBranchId } from '@/lib/branch-resolver';

// POST /api/data/fix-leaf-accounts
// 1. Adds missing leaf account 5001 (مشتريات عامة) under 5000
// 2. Removes obsolete account 4001 (مبيعات مباشرة) and migrates its journal lines
//    to the appropriate branch sales account (4100/4200) based on the entry's branch
// 3. Migrates journal lines from parent accounts (4000, 5000) to leaf accounts
export async function POST() {
  try {
    const auth = await requireRole('ADMIN'); if (!auth.authenticated) return auth.response;
    const writeCheck = checkWriteAccess(auth, 'settings'); if (!writeCheck.authenticated) return writeCheck.response;
    const result = await db.$transaction(async (tx) => {
      const log: string[] = [];

      // Resolve default branchId (UUID) for newly-created accounts
      const defaultBranchId = await getDefaultBranchId();

      // ─── Step 1: Add missing leaf account 5001 (مشتريات عامة) ───
      const existingAccounts = await tx.account.findMany({
        select: { id: true, code: true, name: true, nameEn: true, parentId: true },
      }) as any[];
      const codeMap = new Map(existingAccounts.map(a => [a.code, a]));

      let account5001 = codeMap.get('5001');
      if (!account5001) {
        const parent5000 = codeMap.get('5000');
        account5001 = await tx.account.create({
          data: {
            code: '5001',
            name: 'مشتريات عامة',
            nameEn: 'General Purchases',
            type: 'EXPENSE',
            parentId: parent5000?.id || null,
            branchId: defaultBranchId,
            level: 2,
            isSystem: true,
            isComputed: false,
            computedSource: null,
            openingBalance: 0,
            currentBalance: 0,
            isActive: true,
          },
        });
        log.push('Created account 5001 (مشتريات عامة)');
      } else {
        log.push('Account 5001 already exists');
      }

      // ─── Step 2: Remove obsolete account 4001 (مبيعات مباشرة) ───
      // Account 4001 was a temporary fix that should not exist.
      // Each branch must have its own sales sub-account (4100, 4200, etc.).
      // Migrate any journal lines from 4001 to the correct branch sales account.
      const account4001 = codeMap.get('4001');
      if (account4001) {
        // Find all journal lines on account 4001
        const linesOn4001 = await tx.journalLine.findMany({
          where: { accountId: account4001.id },
          include: {
            journalEntry: {
              select: { id: true, branchId: true, type: true },
            },
          },
        }) as any[];

        if (linesOn4001.length > 0) {
          // Group lines by branch to migrate to the correct account
          const branchAccountMap = new Map<string, string>(); // branch → accountId
          const parent4000 = codeMap.get('4000');

          // Pre-fetch branch sales accounts (exclude 4001 itself and platform 4300)
          const branchSalesAccounts = await tx.account.findMany({
            where: {
              parentId: parent4000?.id || undefined,
              type: 'REVENUE',
              code: { notIn: ['4001', '4300'] },
              isActive: true,
            },
            select: { id: true, code: true, branchId: true, name: true },
            orderBy: { code: 'asc' },
          }) as any[];
          for (const bsa of branchSalesAccounts) {
            branchAccountMap.set(bsa.branchId, bsa.id);
          }

          // Default fallback: use the first branch sales account (e.g., 4100 CHINA_TOWN)
          // for entries with branch=NONE that have no matching account
          const defaultFallbackAccount = branchSalesAccounts.length > 0
            ? branchSalesAccounts[0]
            : null;

          let movedCount = 0;
          let fallbackCount = 0;

          for (const line of linesOn4001) {
            const entryBranch = line.journalEntry.branchId || defaultBranchId;
            let targetAccountId = branchAccountMap.get(entryBranch);

            if (!targetAccountId && defaultFallbackAccount) {
              // No branch-specific account for this entry's branch — use default fallback
              targetAccountId = defaultFallbackAccount.id;
              fallbackCount++;
            }

            if (targetAccountId) {
              await tx.journalLine.update({
                where: { id: line.id },
                data: { accountId: targetAccountId },
              });
              movedCount++;
            }
          }

          log.push(`Migrated ${movedCount} journal lines from 4001 to branch accounts`);
          if (fallbackCount > 0) {
            log.push(`Note: ${fallbackCount} lines with no matching branch were moved to ${defaultFallbackAccount?.code || 'default'} (${defaultFallbackAccount?.name || ''})`);
          }
        }

        // Deactivate account 4001 if all lines were migrated (or if it had no lines)
        const remainingLines = await tx.journalLine.count({
          where: { accountId: account4001.id },
        });

        if (remainingLines === 0) {
          // Safe to deactivate
          await tx.account.update({
            where: { id: account4001.id },
            data: {
              isActive: false,
              name: `${account4001.name} (ملغي)`,
              nameEn: `${account4001.nameEn ?? 'Direct Sales'} (Cancelled)`,
            },
          });
          log.push('Deactivated account 4001 (مبيعات مباشرة) — no longer needed');
        } else {
          log.push(`Account 4001 still has ${remainingLines} lines — kept active but should be migrated`);
        }
      } else {
        log.push('Account 4001 does not exist — no action needed');
      }

      // ─── Step 3: Migrate journal lines from parent 4000 to branch leaf accounts ───
      const parent4000 = codeMap.get('4000');
      if (parent4000) {
        const salesTypes = ['SALE_CASH', 'SALE_BANK', 'SALE_RETURN_CASH', 'SALE_RETURN_BANK'];
        const linesToMove = await tx.journalLine.findMany({
          where: {
            accountId: parent4000.id,
            journalEntry: {
              type: { in: salesTypes },
              status: 'POSTED',
            },
          },
          include: {
            journalEntry: {
              select: { id: true, branchId: true },
            },
          },
        }) as any[];

        if (linesToMove.length > 0) {
          // Group by branch
          const branchSalesAccounts = await tx.account.findMany({
            where: {
              parentId: parent4000.id,
              type: 'REVENUE',
              code: { not: '4300' },
              isActive: true,
            },
            select: { id: true, code: true, branchId: true, name: true },
          }) as any[];
          const branchMap = new Map(branchSalesAccounts.map(a => [a.branchId, a.id]));

          let movedFromParent = 0;
          for (const line of linesToMove) {
            const entryBranch = line.journalEntry.branchId || defaultBranchId;
            const targetId = branchMap.get(entryBranch);
            if (targetId) {
              await tx.journalLine.update({
                where: { id: line.id },
                data: { accountId: targetId },
              });
              movedFromParent++;
            }
          }
          log.push(`Moved ${movedFromParent} journal lines from parent 4000 to branch leaf accounts`);
        } else {
          log.push('No sale journal lines on parent 4000 to move');
        }
      }

      // ─── Step 4: Migrate journal lines from parent 5000 to leaf 5001 ───
      const parent5000 = codeMap.get('5000');
      if (parent5000 && account5001) {
        const purchaseTypes = ['PURCHASE_CASH', 'PURCHASE_BANK', 'PURCHASE_CREDIT',
          'PURCHASE_RETURN_CASH', 'PURCHASE_RETURN_BANK', 'PURCHASE_RETURN_CREDIT',
          'EXPENSE_CASH', 'EXPENSE_BANK', 'EXPENSE_SADAD'];
        const linesToMove = await tx.journalLine.findMany({
          where: {
            accountId: parent5000.id,
            journalEntry: {
              type: { in: purchaseTypes },
              status: 'POSTED',
            },
          },
          select: { id: true },
        }) as any[];

        if (linesToMove.length > 0) {
          const updateResult = await tx.journalLine.updateMany({
            where: {
              id: { in: linesToMove.map(l => l.id) },
            },
            data: {
              accountId: account5001.id,
            },
          });
          log.push(`Moved ${updateResult.count} journal lines from 5000 → 5001`);
        } else {
          log.push('No purchase/expense journal lines on 5000 to move');
        }
      }

      return { log };
    }, {
      maxWait: 15000,
      timeout: 30000,
    });

    // ─── Step 5: Recalculate all account balances after migration ───
    await recalculateAllBalances();

    return NextResponse.json({
      success: true,
      message: 'تم إصلاح الحسابات وترحيل القيود',
      details: result.log,
    });
  } catch (error: any) {
    console.error('Error fixing leaf accounts:', error);
    return NextResponse.json(
      { error: 'فشل في إصلاح الحسابات' },
      { status: 500 }
    );
  }
}
