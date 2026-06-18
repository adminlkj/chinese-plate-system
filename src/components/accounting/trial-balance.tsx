'use client';

import { useState, useEffect, useCallback, Fragment } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Printer, Calendar, AlertTriangle, CheckCircle2, Search, FileSpreadsheet } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { TrialBalanceItem, AccountType, ACCOUNT_TYPE_LABELS } from '@/lib/types';
import { toast } from 'sonner';
import { CurrencyAmount } from '@/components/ui/currency-symbol';
import { exportToExcel } from '@/lib/export-utils';
import { printReportDocument, fetchCompanyInfoForPrint, generateReportNumber } from '@/lib/report-print';
import { useAppStore } from '@/lib/store';
import { AccountCodeBadge } from '@/components/accounting/account-code-badge';
import { useTranslation } from '@/lib/i18n';

// Account type order for grouping
const ACCOUNT_TYPE_ORDER: AccountType[] = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'];

export default function TrialBalance() {
  const { t, isRTL } = useTranslation();
  const { user } = useAppStore();
  const [data, setData] = useState<TrialBalanceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [hideZeroBalances, setHideZeroBalances] = useState(false);

  // Account type label helper using i18n
  const getAccountTypeLabel = (type: AccountType) => {
    const map: Record<AccountType, string> = {
      ASSET: t.asset,
      LIABILITY: t.liability,
      EQUITY: t.equity,
      REVENUE: t.revenue,
      EXPENSE: t.expense,
    };
    return map[type];
  };

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (dateFrom) params.set('dateFrom', dateFrom);
      if (dateTo) params.set('dateTo', dateTo);
      const res = await fetch(`/api/reports/trial-balance?${params.toString()}`);
      if (!res.ok) throw new Error(t.failedToFetchData);
      const json = await res.json();
      setData(Array.isArray(json) ? json : []);
    } catch (err: any) {
      setError(err.message || t.errorLoadingData);
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, t.failedToFetchData, t.errorLoadingData]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Filter data based on hideZeroBalances
  const filteredData = hideZeroBalances
    ? data.filter((item) => item.totalDebit !== 0 || item.totalCredit !== 0)
    : data;

  // Group data by account type
  const groupedData = ACCOUNT_TYPE_ORDER.map((type) => {
    const items = filteredData.filter((item) => item.accountType === type);
    const totalDebit = items.reduce((sum, item) => sum + item.totalDebit, 0);
    const totalCredit = items.reduce((sum, item) => sum + item.totalCredit, 0);
    return { type, items, totalDebit, totalCredit };
  }).filter((group) => group.items.length > 0);

  // Grand totals (always based on filtered data)
  const grandDebit = filteredData.reduce((sum, item) => sum + item.totalDebit, 0);
  const grandCredit = filteredData.reduce((sum, item) => sum + item.totalCredit, 0);
  const isBalanced = Math.abs(grandDebit - grandCredit) < 0.01;

  const handlePrint = async () => {
    let html = '';

    for (const group of groupedData) {
      html += `<div class="section"><div class="section-title">${getAccountTypeLabel(group.type)}</div>`;
      html += `<table><thead><tr>
        <th>${t.accountCode}</th><th>${t.accountName}</th><th>${t.accountType}</th><th class="text-left">${t.accountDebit}</th><th class="text-left">${t.accountCredit}</th><th class="text-left">${t.netBalance}</th><th class="text-center">${t.debitLabel}/${t.creditLabel}</th>
      </tr></thead><tbody>`;

      for (const item of group.items) {
        const balanceNature = (item as any).balanceNature || (item.netBalance >= 0 ? 'DEBIT' : 'CREDIT');
        const isAbnormal = (item as any).isAbnormal || item.netBalance < 0;
        const natureLabel = balanceNature === 'DEBIT' ? t.debitLabel : t.creditLabel;
        const natureClass = isAbnormal ? 'text-red' : 'text-green';
        html += `<tr>
          <td class="font-mono text-sm">${item.accountCode}</td>
          <td>${item.accountName}</td>
          <td>${getAccountTypeLabel(item.accountType)}</td>
          <td class="num">${item.totalDebit > 0 ? item.totalDebit.toFixed(2) : '—'}</td>
          <td class="num">${item.totalCredit > 0 ? item.totalCredit.toFixed(2) : '—'}</td>
          <td class="num font-bold">${Math.abs(item.netBalance).toFixed(2)}</td>
          <td class="text-center ${natureClass}">${natureLabel}${isAbnormal ? ' *' : ''}</td>
        </tr>`;
      }

      html += `<tr class="total-row">
        <td colspan="3">${t.total} ${getAccountTypeLabel(group.type)}</td>
        <td class="num">${group.totalDebit.toFixed(2)}</td>
        <td class="num">${group.totalCredit.toFixed(2)}</td>
        <td class="num">${Math.abs(group.totalDebit - group.totalCredit).toFixed(2)}</td>
        <td></td>
      </tr>`;

      html += `</tbody></table></div>`;
    }

    html += `<div class="summary-total">
      <span>${t.generalTotal}</span>
      <span>${t.accountDebit}: <span class="num">${grandDebit.toFixed(2)}</span> | ${t.accountCredit}: <span class="num">${grandCredit.toFixed(2)}</span> | ${t.difference}: <span class="num">${Math.abs(grandDebit - grandCredit).toFixed(2)}</span></span>
    </div>`;

    const company = await fetchCompanyInfoForPrint();

    const success = printReportDocument({
      title: t.trialBalanceTitle,
      titleEn: 'Trial Balance',
      reportNumber: generateReportNumber('TB'),
      company,
      period: { from: dateFrom || '—', to: dateTo || '—' },
      generatedBy: user?.name || '—',
      contentHtml: html,
      format: 'A4',
      orientation: 'landscape',
    });

    if (!success) {
      toast.error(t.failedToOpenPrint);
    }
  };

  if (error) {
    return (
      <Card className="border-destructive/50">
        <CardContent className="p-6">
          <div className="flex items-center gap-3 text-destructive">
            <AlertTriangle className="size-5" />
            <p className="text-sm font-medium">{error}</p>
          </div>
          <Button onClick={fetchData} variant="outline" className="mt-4" size="sm">
            {t.retry}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4 print:p-0">
      {/* Header Card with Filters */}
      <Card className="no-print">
        <CardHeader>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-xl text-emerald-700 dark:text-emerald-400">
                {t.trialBalanceTitle}
              </CardTitle>
              <CardDescription>{t.trialBalanceDesc}</CardDescription>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Switch
                  id="hide-zero"
                  checked={hideZeroBalances}
                  onCheckedChange={setHideZeroBalances}
                />
                <Label htmlFor="hide-zero" className="text-sm cursor-pointer">
                  {t.hideZeroBalances}
                </Label>
              </div>
              <Button onClick={() => {
                exportToExcel({
                  data: filteredData.map((item) => ({
                    accountCode: item.accountCode,
                    accountName: item.accountName,
                    accountType: getAccountTypeLabel(item.accountType),
                    totalDebit: item.totalDebit,
                    totalCredit: item.totalCredit,
                  })),
                  columns: [
                    { key: 'accountCode', header: t.accountCode, width: 12 },
                    { key: 'accountName', header: t.accountName, width: 25 },
                    { key: 'accountType', header: t.type, width: 15 },
                    { key: 'totalDebit', header: t.accountDebit, width: 15 },
                    { key: 'totalCredit', header: t.accountCredit, width: 15 },
                  ],
                  sheetName: t.trialBalanceTitle,
                  fileName: `${t.trialBalanceTitle}-${new Date().toISOString().slice(0, 10)}.xlsx`,
                  title: t.trialBalanceTitle,
                  subtitle: [dateFrom && `${t.from}: ${dateFrom}`, dateTo && `${t.to}: ${dateTo}`].filter(Boolean).join(' '),
                });
              }} variant="outline" size="sm" className="gap-2" disabled={filteredData.length === 0}>
                <FileSpreadsheet className="size-4" />
                {t.exportExcel}
              </Button>
              <Button onClick={handlePrint} variant="outline" size="sm" className="gap-2">
                <Printer className="size-4" />
                {t.print}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-1.5">
              <label className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                <Calendar className="size-3.5" />
                {t.dateFrom}
              </label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs focus:border-ring focus:ring-ring/50 focus:ring-[3px] focus:outline-none"
              />
            </div>
            <div className="flex-1 space-y-1.5">
              <label className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                <Calendar className="size-3.5" />
                {t.dateTo}
              </label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs focus:border-ring focus:ring-ring/50 focus:ring-[3px] focus:outline-none"
              />
            </div>
            <Button onClick={fetchData} variant="default" size="sm" className="gap-2">
              <Search className="size-4" />
              {t.show}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Balance Status Alert */}
      {!loading && filteredData.length > 0 && (
        <div
          className={`flex items-center gap-3 rounded-lg border p-4 ${
            isBalanced
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300'
              : 'border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300'
          }`}
        >
          {isBalanced ? (
            <>
              <CheckCircle2 className="size-5 shrink-0" />
              <div>
                <p className="font-semibold">{t.balancedMsg}</p>
                <p className="text-sm opacity-80">
                  {t.totalDebitLabel} (<CurrencyAmount amount={grandDebit} symbolClassName="w-3.5 h-3.5" />) = {t.totalCreditLabel} (<CurrencyAmount amount={grandCredit} symbolClassName="w-3.5 h-3.5" />)
                </p>
              </div>
            </>
          ) : (
            <>
              <AlertTriangle className="size-5 shrink-0" />
              <div>
                <p className="font-semibold">{t.unbalancedMsg}</p>
                <p className="text-sm opacity-80">
                  {t.difference}: <CurrencyAmount amount={Math.abs(grandDebit - grandCredit)} symbolClassName="w-3.5 h-3.5" /> — {t.totalDebitLabel} (<CurrencyAmount amount={grandDebit} symbolClassName="w-3.5 h-3.5" />) ≠ {t.totalCreditLabel} (<CurrencyAmount amount={grandCredit} symbolClassName="w-3.5 h-3.5" />)
                </p>
              </div>
            </>
          )}
        </div>
      )}

      {/* Main Table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6 space-y-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : filteredData.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">
              <p className="text-lg font-medium">{t.noData}</p>
              <p className="text-sm mt-1">{t.noDataAdjustDate}</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-emerald-50/50 dark:bg-emerald-950/20">
                  <TableHead className="text-right font-bold">{t.account}</TableHead>
                  <TableHead className="text-right font-bold">{t.accountType}</TableHead>
                  <TableHead className="text-left font-bold">{t.accountDebit}</TableHead>
                  <TableHead className="text-left font-bold">{t.accountCredit}</TableHead>
                  <TableHead className="text-left font-bold">{t.netBalance}</TableHead>
                  <TableHead className="text-center font-bold">{t.debitLabel}/{t.creditLabel}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groupedData.map((group) => (
                  <Fragment key={group.type}>
                    {/* Group Header */}
                    <TableRow
                      key={`header-${group.type}`}
                      className="bg-muted/60 hover:bg-muted/60"
                    >
                      <TableCell colSpan={6} className="font-bold text-emerald-700 dark:text-emerald-400 py-2">
                        {getAccountTypeLabel(group.type)}
                      </TableCell>
                    </TableRow>
                    {/* Group Items */}
                    {group.items.map((item, idx) => (
                      <TableRow key={`${group.type}-${idx}`}>
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            <AccountCodeBadge code={item.accountCode} name={item.accountName} />
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="text-xs">
                            {getAccountTypeLabel(item.accountType)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-left font-mono">
                          {item.totalDebit > 0 ? <CurrencyAmount amount={item.totalDebit} symbolClassName="w-3.5 h-3.5" /> : '—'}
                        </TableCell>
                        <TableCell className="text-left font-mono">
                          {item.totalCredit > 0 ? <CurrencyAmount amount={item.totalCredit} symbolClassName="w-3.5 h-3.5" /> : '—'}
                        </TableCell>
                        <TableCell className="text-left font-mono font-semibold">
                          <CurrencyAmount amount={Math.abs(item.netBalance)} symbolClassName="w-3.5 h-3.5" />
                        </TableCell>
                        <TableCell className="text-center">
                          {(item as any).balanceNature === 'DEBIT' ? (
                            <Badge variant="outline" className={`text-xs px-2 ${(item as any).isAbnormal ? 'border-red-300 text-red-600 dark:border-red-700 dark:text-red-400' : 'border-emerald-300 text-emerald-600 dark:border-emerald-700 dark:text-emerald-400'}`}>
                              {t.debitLabel}
                            </Badge>
                          ) : (
                            <Badge variant="outline" className={`text-xs px-2 ${(item as any).isAbnormal ? 'border-red-300 text-red-600 dark:border-red-700 dark:text-red-400' : 'border-emerald-300 text-emerald-600 dark:border-emerald-700 dark:text-emerald-400'}`}>
                              {t.creditLabel}
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                    {/* Group Subtotal */}
                    <TableRow
                      key={`subtotal-${group.type}`}
                      className="bg-emerald-50/30 dark:bg-emerald-950/10 border-t-2 border-emerald-200 dark:border-emerald-800"
                    >
                      <TableCell colSpan={2} className="font-bold text-sm">
                        {t.total} {getAccountTypeLabel(group.type)}
                      </TableCell>
                      <TableCell className="text-left font-mono font-bold">
                        <CurrencyAmount amount={group.totalDebit} symbolClassName="w-3.5 h-3.5" />
                      </TableCell>
                      <TableCell className="text-left font-mono font-bold">
                        <CurrencyAmount amount={group.totalCredit} symbolClassName="w-3.5 h-3.5" />
                      </TableCell>
                      <TableCell className="text-left font-mono font-bold">
                        <CurrencyAmount amount={Math.abs(group.totalDebit - group.totalCredit)} symbolClassName="w-3.5 h-3.5" />
                      </TableCell>
                      <TableCell></TableCell>
                    </TableRow>
                  </Fragment>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow className="bg-emerald-100/50 dark:bg-emerald-900/30 text-base">
                  <TableCell colSpan={2} className="font-bold">
                    {t.generalTotal}
                  </TableCell>
                  <TableCell className="text-left font-mono font-bold">
                    <CurrencyAmount amount={grandDebit} symbolClassName="w-3.5 h-3.5" />
                  </TableCell>
                  <TableCell className="text-left font-mono font-bold">
                    <CurrencyAmount amount={grandCredit} symbolClassName="w-3.5 h-3.5" />
                  </TableCell>
                  <TableCell className="text-left font-mono font-bold">
                    <div className="flex items-center gap-2">
                      <CurrencyAmount amount={Math.abs(grandDebit - grandCredit)} symbolClassName="w-3.5 h-3.5" />
                      {isBalanced ? (
                        <CheckCircle2 className="size-4 text-emerald-600" />
                      ) : (
                        <AlertTriangle className="size-4 text-red-500" />
                      )}
                    </div>
                  </TableCell>
                  <TableCell></TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
