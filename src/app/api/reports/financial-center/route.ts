import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAllAccountBalances } from '@/lib/accounting-engine';
import { NORMAL_BALANCE, type AccountType } from '@/lib/types';
import { requireAuth, checkReadAccess } from '@/lib/api-auth';

export async function GET() {
  try {
    const auth = await requireAuth(); if (!auth.authenticated) return auth.response;
    const readCheck = checkReadAccess(auth, 'financial-center'); if (!readCheck.authenticated) return readCheck.response;
    const allAccounts = await db.account.findMany({ where: { isActive: true } });

    // Use batch query instead of N+1
    const balances = await getAllAccountBalances();

    let totalAssets = 0;
    let totalLiabilities = 0;
    let totalEquity = 0;
    let totalRevenue = 0;
    let totalExpenses = 0;

    const assetAccounts: { code: string; name: string; nameEn?: string; balance: number; normalSide: string; isAbnormal: boolean; isFixedAsset?: boolean; isAccumDepreciation?: boolean; parentId?: string }[] = [];
    const liabilityAccounts: { code: string; name: string; nameEn?: string; balance: number; normalSide: string; isAbnormal: boolean }[] = [];
    const equityAccounts: { code: string; name: string; nameEn?: string; balance: number; normalSide: string; isAbnormal: boolean }[] = [];

    for (const account of allAccounts) {
      const balance = balances.get(account.id) || 0;
      const normalSide = NORMAL_BALANCE[account.type as AccountType] || 'DEBIT';
      const isAbnormal = balance < 0;

      // Identify account categories for proper balance sheet presentation
      const isFixedAsset = account.code.startsWith('14') && !account.code.startsWith('149');
      const isAccumDepreciation = account.code.startsWith('149');

      const accountData = {
        code: account.code,
        name: account.name,
        nameEn: account.nameEn || undefined,
        balance,
        normalSide,
        isAbnormal,
        isFixedAsset,
        isAccumDepreciation,
        parentId: account.parentId || undefined,
      };

      switch (account.type) {
        case 'ASSET':
          totalAssets += balance;
          assetAccounts.push(accountData);
          break;
        case 'LIABILITY':
          // All liability accounts (including 2600 Tax Payable) are included in total
          // Tax Payable receives actual journal lines during VAT settlement
          totalLiabilities += balance;
          liabilityAccounts.push(accountData);
          break;
        case 'EQUITY':
          totalEquity += balance;
          equityAccounts.push(accountData);
          break;
        case 'REVENUE':
          totalRevenue += balance;
          break;
        case 'EXPENSE':
          totalExpenses += balance;
          break;
      }
    }

    // Compute fixed assets section for balance sheet presentation
    const fixedAssetAccounts = assetAccounts.filter(a => a.isFixedAsset);
    const accumDepreciationAccounts = assetAccounts.filter(a => a.isAccumDepreciation);
    const totalFixedAssets = fixedAssetAccounts.reduce((sum, a) => sum + a.balance, 0);
    const totalAccumDepreciation = accumDepreciationAccounts.reduce((sum, a) => sum + a.balance, 0); // negative values
    const netFixedAssets = round2(totalFixedAssets + totalAccumDepreciation); // adding because accum depr is negative

    // Net income adds to equity
    const netIncome = totalRevenue - totalExpenses;
    totalEquity += netIncome;

    // Compute VAT breakdown for informational display
    const inputTaxAccount = allAccounts.find(a => a.code === '1200');
    const outputTaxAccount = allAccounts.find(a => a.code === '2100');
    const taxPayableAccount = allAccounts.find(a => a.code === '2600');

    const inputTaxBalance = inputTaxAccount ? balances.get(inputTaxAccount.id) || 0 : 0;
    const outputTaxBalance = outputTaxAccount ? balances.get(outputTaxAccount.id) || 0 : 0;
    const taxPayableBalance = taxPayableAccount ? balances.get(taxPayableAccount.id) || 0 : 0;

    const vatBreakdown = {
      inputTax: inputTaxBalance,
      outputTax: outputTaxBalance,
      unsettledNetTax: round2(outputTaxBalance - inputTaxBalance),
      taxPayable: taxPayableBalance,
    };

    return NextResponse.json({
      totalAssets,
      totalLiabilities,
      totalEquity,
      netIncome,
      totalRevenue,
      totalExpenses,
      assetAccounts,
      liabilityAccounts,
      equityAccounts,
      vatBreakdown,
      // Fixed Assets detail
      fixedAssets: {
        accounts: fixedAssetAccounts,
        accumDepreciation: accumDepreciationAccounts,
        totalFixedAssets,
        totalAccumDepreciation,
        netFixedAssets,
      },
      accountingEquation: {
        assets: totalAssets,
        liabilitiesPlusEquity: totalLiabilities + totalEquity,
        isBalanced: Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.01,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: 'فشل في جلب المركز المالي' }, { status: 500 });
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
