import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { toNumber, round2 } from '@/lib/decimal';
import { requireAuth, checkReadAccess, assertBranchAccess } from '@/lib/api-auth';
import { resolveBranchIdOrNull } from '@/lib/branch-resolver';

// GET /api/reports/salary-statement
// Salary statement: all salary-related transactions (expenses categorized as salaries)
// Query params: dateFrom, dateTo, branch
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth();
    if (!auth.authenticated) return auth.response;
    const readCheck = checkReadAccess(auth, 'advanced-reports'); if (!readCheck.authenticated) return readCheck.response;

    const { searchParams } = new URL(request.url);
    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');
    const branchInput = searchParams.get('branch') || searchParams.get('branchId');

    // Resolve branchId (UUID) or null if 'all'/not specified
    const branchId = (branchInput && branchInput !== 'all')
      ? await resolveBranchIdOrNull(branchInput)
      : null;

    // Verify the user has access to this branch (Layer 3 business rule)
    if (branchId) {
      const branchCheck = assertBranchAccess(auth, branchId);
      if (!branchCheck.authenticated) return branchCheck.response;
    }

    // Find salary-related accounts (typically under 5100 or accounts with "salary" in name)
    const salaryAccounts = await db.account.findMany({
      where: {
        type: 'EXPENSE',
        isActive: true,
        OR: [
          { code: { startsWith: '51' } },  // Salary expense accounts typically start with 51
          { name: { contains: 'رواتب' } },
          { name: { contains: 'راتب' } },
          { nameEn: { contains: 'salary' } },
          { nameEn: { contains: 'Salary' } },
        ],
      },
      select: { id: true, code: true, name: true, nameEn: true },
    });

    const salaryAccountIds = salaryAccounts.map(a => a.id);

    if (salaryAccountIds.length === 0) {
      return NextResponse.json({
        dateFrom: dateFrom || null,
        dateTo: dateTo || null,
        branch: branchId || branchInput || 'all',
        salaryAccounts: [],
        summary: {
          totalSalaries: 0,
          totalTax: 0,
          totalDeductions: 0,
          netSalaries: 0,
          paymentCount: 0,
        },
        transactions: [],
      });
    }

    // Build date filter
    const dateFilter: any = {};
    if (dateFrom || dateTo) {
      if (dateFrom) {
        const from = new Date(dateFrom);
        from.setHours(0, 0, 0, 0);
        dateFilter.gte = from;
      }
      if (dateTo) {
        const to = new Date(dateTo);
        to.setHours(23, 59, 59, 999);
        dateFilter.lte = to;
      }
    }

    // Fetch journal entries that hit salary accounts
    const journalEntries = await db.journalEntry.findMany({
      where: {
        status: 'POSTED',
        type: { in: ['EXPENSE_CASH', 'EXPENSE_BANK', 'EXPENSE_SADAD'] },
        ...(Object.keys(dateFilter).length > 0 ? { date: dateFilter } : {}),
        ...(branchId ? { branchId } : {}),
        lines: {
          some: {
            accountId: { in: salaryAccountIds },
            debit: { gt: 0 },
          },
        },
      },
      include: {
        lines: {
          include: {
            account: { select: { id: true, code: true, name: true, nameEn: true } },
          },
        },
      },
      orderBy: { date: 'asc' },
    });

    // Build transaction list
    const transactions = journalEntries.map((entry) => {
      const salaryLines = entry.lines.filter(
        (l) => salaryAccountIds.includes(l.accountId) && toNumber(l.debit) > 0
      );
      const salaryAmount = round2(salaryLines.reduce((s, l) => s + toNumber(l.debit), 0));
      const taxAmount = toNumber(entry.taxAmount);
      const discountAmount = toNumber(entry.discountAmount);

      // Find the salary account name
      const salaryAccount = salaryLines[0]?.account;

      return {
        id: entry.id,
        entryNumber: entry.entryNumber,
        date: new Date(entry.date).toISOString(),
        type: entry.type,
        description: entry.description,
        salaryAccount: salaryAccount?.name || 'رواتب',
        salaryAccountCode: salaryAccount?.code || '',
        amount: salaryAmount,
        tax: taxAmount,
        discount: discountAmount,
        // For salaries: taxAmount is withholding tax (reduces payout), discountAmount is deductions
        net: round2(salaryAmount - taxAmount - discountAmount),
        paymentMethod: entry.paymentMethod,
        branch: entry.branchId,
        counterParty: entry.counterParty,
      };
    });

    // Summary
    const totalSalaries = round2(transactions.reduce((s, t) => s + t.amount, 0));
    const totalTax = round2(transactions.reduce((s, t) => s + t.tax, 0));
    const totalDeductions = round2(transactions.reduce((s, t) => s + t.discount, 0));
    const netSalaries = round2(transactions.reduce((s, t) => s + t.net, 0));

    return NextResponse.json({
      dateFrom: dateFrom || null,
      dateTo: dateTo || null,
      branch: branchId || branchInput || 'all',
      salaryAccounts: salaryAccounts.map(a => ({
        id: a.id,
        code: a.code,
        name: a.name,
        nameEn: a.nameEn,
      })),
      summary: {
        totalSalaries,
        totalTax,
        totalDeductions,
        netSalaries,
        paymentCount: transactions.length,
      },
      transactions,
    });
  } catch (error: any) {
    console.error('[salary-statement] Error:', error);
    return NextResponse.json(
      { error: 'فشل في إنشاء كشف الرواتب' },
      { status: 500 }
    );
  }
}
