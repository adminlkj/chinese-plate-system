import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { NORMAL_BALANCE, type AccountType } from '@/lib/types';
import { toNumber } from '@/lib/decimal';
import { requireAuth, checkReadAccess } from '@/lib/api-auth';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(); if (!auth.authenticated) return auth.response;
    const readCheck = checkReadAccess(auth, 'cash-flow'); if (!readCheck.authenticated) return readCheck.response;
    const { searchParams } = new URL(request.url);
    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');

    // Build date filter for journal entries
    const dateFilter: any = {};
    if (dateFrom || dateTo) {
      dateFilter.date = {
        ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
        ...(dateTo ? { lte: new Date(dateTo) } : {}),
      };
    }

    const allAccounts = await db.account.findMany({ where: { isActive: true } });
    const accountById = new Map(allAccounts.map(a => [a.id, a]));

    // ─── Efficient batch aggregation: ONE groupBy for the period, ONE for beginning balance ───
    // Replaces the old N+1 pattern (2 queries per account × N accounts = 200+ queries)
    const periodWhere = {
      journalEntry: {
        status: 'POSTED' as const,
        ...(Object.keys(dateFilter).length > 0 ? { ...dateFilter } : {}),
      },
    };
    const periodSums = await db.journalLine.groupBy({
      by: ['accountId'],
      where: periodWhere,
      _sum: { debit: true, credit: true },
    });
    const periodMap = new Map(periodSums.map(r => [r.accountId, r._sum]));

    // Beginning balance: all posted entries BEFORE dateFrom (single groupBy)
    const beginMap = new Map<string, { debit: number | null; credit: number | null }>();
    if (dateFrom) {
      const beginSums = await db.journalLine.groupBy({
        by: ['accountId'],
        where: {
          journalEntry: {
            status: 'POSTED',
            date: { lt: new Date(dateFrom) },
          },
        },
        _sum: { debit: true, credit: true },
      });
      for (const r of beginSums) beginMap.set(r.accountId, r._sum);
    }

    // Helper: compute account balance from pre-fetched aggregation maps
    function getAccountBalanceInPeriod(accountId: string, accountType: AccountType): number {
      const sum = periodMap.get(accountId);
      const totalDebit = toNumber((sum as any)?.debit);
      const totalCredit = toNumber((sum as any)?.credit);
      const normalBalance = NORMAL_BALANCE[accountType];
      return normalBalance === 'DEBIT'
        ? totalDebit - totalCredit
        : totalCredit - totalDebit;
    }

    // Get beginning balance from pre-fetched map
    function getBeginningBalance(accountId: string, accountType: AccountType): number {
      if (!dateFrom) return 0;
      const sum = beginMap.get(accountId);
      const totalDebit = toNumber((sum as any)?.debit);
      const totalCredit = toNumber((sum as any)?.credit);
      const normalBalance = NORMAL_BALANCE[accountType];
      return normalBalance === 'DEBIT'
        ? totalDebit - totalCredit
        : totalCredit - totalDebit;
    }

    // Calculate key balances
    let totalRevenue = 0;
    let totalExpenses = 0;
    let cashBalance = 0;
    let arChange = 0;
    let apChange = 0;
    let withdrawalBalance = 0;
    let capitalBalance = 0;

    for (const acc of allAccounts) {
      const bal = getAccountBalanceInPeriod(acc.id, acc.type as AccountType);
      const beginBal = getBeginningBalance(acc.id, acc.type as AccountType);

      if (acc.type === 'REVENUE') totalRevenue += bal;
      if (acc.type === 'EXPENSE') totalExpenses += bal;
      // Cash and bank balances: include cash (1000) + all bank sub-accounts (1011, 1012, etc.)
      // Also include old 1020 if it exists (backward compat)
      // Note: 1010 is a parent account — we aggregate its children's balances instead
      if (acc.code === '1000' || acc.code === '1020') cashBalance += bal;
      if (acc.code.startsWith('101') && acc.code.length === 4 && acc.code !== '1010') cashBalance += bal;
      // AR change = parent account 1100 + all children (1101, 1102, etc.)
      if (acc.code === '1100' || (acc.code.startsWith('110') && acc.code.length === 4 && acc.code !== '1100')) arChange += (bal - beginBal);
      // AP change = parent account 2000 + all children (2001, 2002, etc.)
      if (acc.code === '2000' || (acc.code.startsWith('200') && acc.code.length === 4 && acc.code !== '2000')) apChange += (bal - beginBal);
      if (acc.code === '3001') withdrawalBalance = bal;
      if (acc.code === '3000') capitalBalance = bal;
    }

    const netIncome = totalRevenue - totalExpenses;

    // Operating Activities: Net income adjusted for working capital CHANGES (not balances)
    const operatingActivities = [
      { description: 'صافي الدخل', amount: netIncome },
      { description: 'تغير الذمم المدينة', amount: -arChange },
      { description: 'تغير الذمم الدائنة', amount: apChange },
    ];

    const totalOperating = netIncome - arChange + apChange;

    // Investing Activities
    const investingActivities: { description: string; amount: number }[] = [];
    const totalInvesting = 0;

    // Financing Activities
    const financingActivities: { description: string; amount: number }[] = [];
    if (withdrawalBalance !== 0) {
      financingActivities.push({ description: 'مسحوبات المالك', amount: -withdrawalBalance });
    }
    if (capitalBalance !== 0) {
      financingActivities.push({ description: 'رأس المال', amount: capitalBalance });
    }
    const totalFinancing = financingActivities.reduce((sum, item) => sum + item.amount, 0);

    // Net cash flow
    const netCashFlow = totalOperating + totalInvesting + totalFinancing;

    const data = {
      operatingActivities,
      totalOperating,
      investingActivities,
      totalInvesting,
      financingActivities,
      totalFinancing,
      netCashFlow,
      cashBalance,
    };

    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json({ error: 'فشل في جلب التدفقات النقدية' }, { status: 500 });
  }
}
