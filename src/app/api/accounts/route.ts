import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth, checkWriteAccess, checkReadAccess, sanitizeInput } from '@/lib/api-auth';
import { createTransaction, updateAccountBalance } from '@/lib/accounting-engine';
import { NORMAL_BALANCE } from '@/lib/types';
import { toNumber } from '@/lib/decimal';
import { resolveBranchId, getDefaultBranchId } from '@/lib/branch-resolver';
import { auditLog } from '@/lib/audit-log';

// GET /api/accounts - Get all accounts as tree structure
export async function GET() {
  try {
    const auth = await requireAuth(); if (!auth.authenticated) return auth.response;
    const readCheck = checkReadAccess(auth, 'chart-of-accounts'); if (!readCheck.authenticated) return readCheck.response;
    const accounts = await db.account.findMany({
      orderBy: { code: 'asc' },
    });

    // Build tree structure
    const accountMap = new Map<string, any>();
    const roots: any[] = [];

    for (const account of accounts) {
      accountMap.set(account.id, {
        ...account,
        // Backward-compat alias: client components (chart-of-accounts.tsx)
        // historically read `account.branch`. The DB column is now `branchId`
        // (UUID). Expose both so old clients keep working.
        branch: account.branchId,
        openingBalance: toNumber(account.openingBalance),
        currentBalance: toNumber(account.currentBalance),
        children: [],
      });
    }

    for (const account of accounts) {
      const node = accountMap.get(account.id);
      if (account.parentId && accountMap.has(account.parentId)) {
        accountMap.get(account.parentId).children.push(node);
      } else {
        roots.push(node);
      }
    }

    return NextResponse.json(roots);
  } catch (error) {
    return NextResponse.json({ error: 'فشل في جلب الحسابات' }, { status: 500 });
  }
}

// POST /api/accounts - Create a new account with optional opening balance
// WRAPPED IN $transaction for atomicity: account creation + opening balance JE must succeed or fail together
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(); if (!auth.authenticated) return auth.response;
    const writeCheck = checkWriteAccess(auth, 'chart-of-accounts'); if (!writeCheck.authenticated) return writeCheck.response;
    const body = await request.json();
    const { type, parentId, level, openingBalance } = body;
    const code = sanitizeInput(body.code);
    const name = sanitizeInput(body.name);
    const nameEn = body.nameEn ? sanitizeInput(body.nameEn) : null;
    const description = body.description ? sanitizeInput(body.description) : null;

    // Resolve branchId (UUID) from body.branch (code/name/id) or body.branchId (UUID), else default
    let branchId: string;
    try {
      branchId = body.branch || body.branchId
        ? await resolveBranchId(body.branch || body.branchId)
        : await getDefaultBranchId();
    } catch (e: any) {
      return NextResponse.json({ error: e.message || 'الفرع غير صالح' }, { status: 400 });
    }

    // Check if code already exists
    const existing = await db.account.findUnique({ where: { code } });
    if (existing) {
      return NextResponse.json({ error: 'رقم الحساب موجود بالفعل' }, { status: 400 });
    }

    const parsedOpeningBalance = parseFloat(String(openingBalance)) || 0;

    // ATOMIC: Create account + opening balance journal entry in one transaction
    const account = await db.$transaction(async (tx) => {
      const newAccount = await tx.account.create({
        data: {
          code,
          name,
          nameEn: nameEn || null,
          type,
          parentId: parentId || null,
          branchId,
          level: level || 1,
          openingBalance: parsedOpeningBalance,
          currentBalance: 0, // Will be recalculated after journal entry
          description,
          isActive: true,
        },
      });

      // If opening balance is non-zero, create a proper OPENING_BALANCE journal entry
      if (parsedOpeningBalance !== 0) {
        const nb = NORMAL_BALANCE[type as keyof typeof NORMAL_BALANCE];

        // Look up the Capital account (رأس المال, code 3000)
        const capitalAccount = await tx.account.findFirst({ where: { code: '3000' } });

        if (!capitalAccount) {
          // Capital account must exist for opening balance entries
          // Throw error to roll back the entire transaction (account creation is also rolled back)
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
              description: `رصيد افتتاحي - ${name}`,
              type: 'OPENING_BALANCE',
              status: 'POSTED',
              amount,
              periodId: period.id,
              lines: {
                create: [
                  { accountId: newAccount.id, debit: amount, credit: 0 },
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
              description: `رصيد افتتاحي - ${name}`,
              type: 'OPENING_BALANCE',
              status: 'POSTED',
              amount,
              periodId: period.id,
              lines: {
                create: [
                  { accountId: capitalAccount.id, debit: amount, credit: 0 },
                  { accountId: newAccount.id, debit: 0, credit: amount },
                ],
              },
            },
          });
        }

        // Update account balances within the transaction
        await updateAccountBalance(newAccount.id, tx);
        await updateAccountBalance(capitalAccount.id, tx);
      }

      return newAccount;
    });

    // AUDIT-9-18 — chart-of-accounts creation is a WARNING (compliance-sensitive)
    auditLog({
      action: 'CREATE',
      entity: 'ACCOUNT',
      entityId: account.id,
      entityNumber: account.code,
      description: `إنشاء حساب: ${account.code} - ${account.name} (${type})${parsedOpeningBalance !== 0 ? ` برصيد افتتاحي ${parsedOpeningBalance}` : ''}`,
      userId: auth.userId,
      userName: auth.email,
      userRole: auth.role,
      branchId,
      severity: 'WARNING',
      category: 'ACCOUNTING',
      details: { code, name, type, parentId: parentId || null, openingBalance: parsedOpeningBalance },
    }).catch(() => {});

    return NextResponse.json({
      ...account,
      // Backward-compat alias: client reads `account.branch`
      branch: (account as any).branchId,
      openingBalance: toNumber(account.openingBalance),
      currentBalance: toNumber(account.currentBalance),
    });
  } catch (error: any) {
    console.error('[POST /api/accounts]', error);
    return NextResponse.json({ error: 'فشل في إنشاء الحساب' }, { status: 500 });
  }
}

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
