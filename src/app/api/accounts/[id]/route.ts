import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth, checkWriteAccess, checkReadAccess, sanitizeInput } from '@/lib/api-auth';
import { createTransaction, updateAccountBalance } from '@/lib/accounting-engine';
import { NORMAL_BALANCE } from '@/lib/types';
import { toNumber } from '@/lib/decimal';
import { resolveBranchId } from '@/lib/branch-resolver';
import { auditLog } from '@/lib/audit-log';

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

// GET /api/accounts/[id] - Get single account
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth(); if (!auth.authenticated) return auth.response;
    const readCheck = checkReadAccess(auth, 'chart-of-accounts'); if (!readCheck.authenticated) return readCheck.response;
    const { id } = await params;
    const account = await db.account.findUnique({
      where: { id },
      include: { children: true, parent: true },
    });

    if (!account) {
      return NextResponse.json({ error: 'الحساب غير موجود' }, { status: 404 });
    }

    return NextResponse.json({
      ...account,
      // Backward-compat alias: client reads `account.branch`
      branch: (account as any).branchId,
      openingBalance: toNumber(account.openingBalance),
      currentBalance: toNumber(account.currentBalance),
      children: account.children?.map((c: any) => ({
        ...c,
        branch: c.branchId,
        openingBalance: toNumber(c.openingBalance),
        currentBalance: toNumber(c.currentBalance),
      })),
      parent: account.parent ? {
        ...account.parent,
        branch: (account.parent as any).branchId,
        openingBalance: toNumber(account.parent.openingBalance),
        currentBalance: toNumber(account.parent.currentBalance),
      } : null,
    });
  } catch (error) {
    return NextResponse.json({ error: 'فشل في جلب الحساب' }, { status: 500 });
  }
}

// PUT /api/accounts/[id] - Update account
// WRAPPED IN $transaction for atomicity: account update + opening balance change must succeed or fail together
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth(); if (!auth.authenticated) return auth.response;
    const writeCheck = checkWriteAccess(auth, 'chart-of-accounts'); if (!writeCheck.authenticated) return writeCheck.response;
    const { id } = await params;
    const body = await request.json();
    const { openingBalance, isActive } = body;
    const name = body.name ? sanitizeInput(body.name) : undefined;
    const nameEn = body.nameEn !== undefined ? sanitizeInput(body.nameEn) : undefined;
    const description = body.description !== undefined ? sanitizeInput(body.description) : undefined;

    // Resolve branchId (UUID) if provided
    let branchId: string | undefined;
    if (body.branch !== undefined || body.branchId !== undefined) {
      try {
        branchId = await resolveBranchId(body.branch || body.branchId);
      } catch (e: any) {
        return NextResponse.json({ error: e.message || 'الفرع غير صالح' }, { status: 400 });
      }
    }

    const result = await db.$transaction(async (tx) => {
      // Get current account to compare opening balance
      const currentAccount = await tx.account.findUnique({ where: { id } });
      if (!currentAccount) {
        throw new Error('الحساب غير موجود');
      }

      const parsedOpeningBalance = parseFloat(String(openingBalance)) || 0;
      const openingBalanceChanged = openingBalance !== undefined && parsedOpeningBalance !== toNumber(currentAccount.openingBalance);

      const account = await tx.account.update({
        where: { id },
        data: {
          ...(name ? { name } : {}),
          ...(nameEn !== undefined ? { nameEn } : {}),
          ...(openingBalance !== undefined ? { openingBalance: parsedOpeningBalance } : {}),
          ...(isActive !== undefined ? { isActive } : {}),
          ...(branchId !== undefined ? { branchId } : {}),
          ...(description !== undefined ? { description } : {}),
        },
      });

      // If opening balance changed, cancel old entry and create new one - all within the same transaction
      if (openingBalanceChanged) {
        // Step 1: Find and handle any existing OPENING_BALANCE entries for this account
        const existingOpeningEntries = await tx.journalEntry.findMany({
          where: {
            type: 'OPENING_BALANCE',
            lines: {
              some: { accountId: id },
            },
          },
          include: { lines: true },
        });

        const affectedAccountIds = new Set<string>();

        for (const entry of existingOpeningEntries) {
          if (entry.status === 'POSTED') {
            // Cancel the posted entry (sets status to CANCELLED and recalculates balances)
            await tx.journalEntry.update({
              where: { id: entry.id },
              data: { status: 'CANCELLED' },
            });
            // Track affected accounts for balance recalculation
            for (const line of entry.lines) {
              affectedAccountIds.add(line.accountId);
            }
          } else if (entry.status === 'DRAFT') {
            // Delete draft entries (they were never posted, no balance impact)
            await tx.journalLine.deleteMany({ where: { journalEntryId: entry.id } });
            await tx.journalEntry.delete({ where: { id: entry.id } });
          }
          // CANCELLED entries are left as-is (already neutralized, preserves audit trail)
        }

        // Step 2: Create new opening balance entry if non-zero
        if (parsedOpeningBalance !== 0) {
          const nb = NORMAL_BALANCE[account.type as keyof typeof NORMAL_BALANCE];
          const capitalAccount = await tx.account.findFirst({ where: { code: '3000' } });

          if (!capitalAccount) {
            throw new Error('حساب رأس المال (3000) غير موجود. يرجى تهيئة الحسابات الافتراضية أولاً.');
          }

          const amount = Math.abs(parsedOpeningBalance);
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
            // ASSET/EXPENSE: Debit the account, Credit Capital
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
            // LIABILITY/EQUITY/REVENUE: Credit the account, Debit Capital
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

          affectedAccountIds.add(account.id);
          affectedAccountIds.add(capitalAccount.id);
        }

        // Recalculate balances for all affected accounts
        for (const accId of affectedAccountIds) {
          await updateAccountBalance(accId, tx);
        }
      }

      return account;
    });

    // AUDIT-9-18: Audit log the account update (non-blocking)
    auditLog({
      action: 'UPDATE',
      entity: 'ACCOUNT',
      entityId: id,
      entityNumber: result.code,
      description: `تحديث حساب: ${result.code} - ${result.name}`,
      userId: auth.userId,
      userName: auth.email,
      userRole: auth.role,
      severity: 'INFO',
      category: 'ACCOUNTING',
      details: { updatedFields: Object.keys(body) },
    }).catch(() => {});

    return NextResponse.json({
      ...result,
      // Backward-compat alias: client reads `account.branch`
      branch: (result as any).branchId,
      openingBalance: toNumber(result.openingBalance),
      currentBalance: toNumber(result.currentBalance),
    });
  } catch (error: any) {
    console.error('[PUT /api/accounts/[id]]', error);
    return NextResponse.json({ error: 'فشل في تحديث الحساب' }, { status: 500 });
  }
}

// DELETE /api/accounts/[id] - Delete account
// ADMIN can delete any account (deactivates instead if has journal lines).
// Non-admin users can only delete accounts with no transactions and no children.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth(); if (!auth.authenticated) return auth.response;
    const writeCheck = checkWriteAccess(auth, 'chart-of-accounts'); if (!writeCheck.authenticated) return writeCheck.response;
    const { id } = await params;

    await db.$transaction(async (tx) => {
      const lineCount = await tx.journalLine.count({
        where: { accountId: id },
      });

      const childrenCount = await tx.account.count({
        where: { parentId: id },
      });

      // Non-admin: strict rules - cannot delete if has lines or children
      if (auth.role !== 'ADMIN') {
        if (lineCount > 0) {
          throw new Error('لا يمكن حذف حساب مرتبط بقيود');
        }
        if (childrenCount > 0) {
          throw new Error('لا يمكن حذف حساب يحتوي على حسابات فرعية');
        }
        await tx.account.delete({ where: { id } });
      } else {
        // ADMIN: can delete if no children; if has journal lines, deactivate instead
        if (childrenCount > 0) {
          throw new Error('لا يمكن حذف حساب يحتوي على حسابات فرعية - قم بتحويل أو حذف الحسابات الفرعية أولاً');
        }
        if (lineCount > 0) {
          // ADMIN with journal lines: soft-delete (deactivate) instead of hard delete
          await tx.account.update({ where: { id }, data: { isActive: false } });
        } else {
          await tx.account.delete({ where: { id } });
        }
      }
    });

    // AUDIT-9-18: Audit log the account delete/deactivate (WARNING — chart-of-accounts change)
    auditLog({
      action: 'DELETE',
      entity: 'ACCOUNT',
      entityId: id,
      description: `حذف/تعطيل حساب ${id}`,
      userId: auth.userId,
      userName: auth.email,
      userRole: auth.role,
      severity: 'WARNING',
      category: 'ACCOUNTING',
    }).catch(() => {});

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[DELETE /api/accounts/[id]]', error);
    return NextResponse.json({ error: 'فشل في حذف الحساب' }, { status: 500 });
  }
}
