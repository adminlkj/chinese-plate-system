'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Printer, Calendar, TrendingUp, TrendingDown, Search, CheckCircle2, AlertTriangle, FileSpreadsheet } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, Legend } from 'recharts';
import type { IncomeStatementData } from '@/lib/types';
import { toast } from 'sonner';
import { formatCurrencyWithSymbol, formatNumber as formatChartNumber } from '@/lib/types';
import { CurrencyAmount } from '@/components/ui/currency-symbol';
import { exportToExcel } from '@/lib/export-utils';
import { printReportDocument, fetchCompanyInfoForPrint, generateReportNumber } from '@/lib/report-print';
import { useAppStore } from '@/lib/store';
import { AccountCodeBadge } from '@/components/accounting/account-code-badge';
import { useTranslation } from '@/lib/i18n';

export default function IncomeStatement() {
  const { t, isRTL } = useTranslation();
  const { user } = useAppStore();
  const [data, setData] = useState<IncomeStatementData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [hideZeroBalances, setHideZeroBalances] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (dateFrom) params.set('dateFrom', dateFrom);
      if (dateTo) params.set('dateTo', dateTo);
      const res = await fetch(`/api/reports/income-statement?${params.toString()}`);
      if (!res.ok) throw new Error(t.failedToFetchData);
      const json = await res.json();
      setData(json);
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
  const filteredRevenue = hideZeroBalances && data
    ? data.revenue.filter((r) => r.amount !== 0)
    : data?.revenue || [];
  const filteredExpenses = hideZeroBalances && data
    ? data.expenses.filter((e) => e.amount !== 0)
    : data?.expenses || [];

  const handlePrint = async () => {
    if (!data) return;
    let html = '';

    // Revenue section
    html += `<div class="section"><div class="section-title">${t.revenue}</div>`;
    html += `<table><thead><tr>
      <th>${t.accountCode}</th><th>${t.accountName}</th><th class="text-left">${t.amount}</th>
    </tr></thead><tbody>`;
    for (const item of filteredRevenue) {
      html += `<tr>
        <td class="font-mono text-sm">${item.accountCode}</td>
        <td>${item.accountName}</td>
        <td class="num">${item.amount.toFixed(2)}</td>
      </tr>`;
    }
    html += `<tr class="total-row">
      <td colspan="2">${t.totalRevenueLabel}</td>
      <td class="num">${data.totalRevenue.toFixed(2)}</td>
    </tr>`;
    html += `</tbody></table></div>`;

    // Expenses section
    html += `<div class="section"><div class="section-title">${t.expense}</div>`;
    html += `<table><thead><tr>
      <th>${t.accountCode}</th><th>${t.accountName}</th><th class="text-left">${t.amount}</th>
    </tr></thead><tbody>`;
    for (const item of filteredExpenses) {
      html += `<tr>
        <td class="font-mono text-sm">${item.accountCode}</td>
        <td>${item.accountName}</td>
        <td class="num">${item.amount.toFixed(2)}</td>
      </tr>`;
    }
    html += `<tr class="total-row">
      <td colspan="2">${t.totalExpensesLabel}</td>
      <td class="num">${data.totalExpenses.toFixed(2)}</td>
    </tr>`;
    html += `</tbody></table></div>`;

    // Net income
    html += `<div class="summary-total">
      <span>${data.netIncome >= 0 ? t.netProfit : t.netLoss}</span>
      <span class="${data.netIncome >= 0 ? 'text-green' : 'text-red'}">${Math.abs(data.netIncome).toFixed(2)}</span>
    </div>`;

    const company = await fetchCompanyInfoForPrint();

    const success = printReportDocument({
      title: t.incomeStatementTitle,
      titleEn: 'Income Statement',
      reportNumber: generateReportNumber('IS'),
      company,
      period: { from: dateFrom || '—', to: dateTo || '—' },
      generatedBy: user?.name || '—',
      contentHtml: html,
      format: 'A4',
    });

    if (!success) {
      toast.error(t.failedToOpenPrint);
    }
  };

  // Chart data
  const chartData = data
    ? [
        { name: t.revenue, amount: data.totalRevenue },
        { name: t.expense, amount: data.totalExpenses },
        { name: t.netIncomeLabel, amount: data.netIncome },
      ]
    : [];

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
                {t.incomeStatementTitle}
              </CardTitle>
              <CardDescription>
                {t.incomeStatementDesc}
              </CardDescription>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Switch
                  id="hide-zero-is"
                  checked={hideZeroBalances}
                  onCheckedChange={setHideZeroBalances}
                />
                <Label htmlFor="hide-zero-is" className="text-sm cursor-pointer">
                  {t.hideZeroBalances}
                </Label>
              </div>
              <Button onClick={() => {
                if (!data) return;
                const exportData = [
                  ...filteredRevenue.map((item) => ({
                    accountCode: item.accountCode,
                    accountName: item.accountName,
                    amount: item.amount,
                    category: t.revenue,
                  })),
                  ...filteredExpenses.map((item) => ({
                    accountCode: item.accountCode,
                    accountName: item.accountName,
                    amount: item.amount,
                    category: t.expense,
                  })),
                ];
                exportToExcel({
                  data: exportData,
                  columns: [
                    { key: 'accountCode', header: t.accountCode, width: 12 },
                    { key: 'accountName', header: t.accountName, width: 25 },
                    { key: 'amount', header: t.amount, width: 15 },
                    { key: 'category', header: t.classification, width: 12 },
                  ],
                  sheetName: t.incomeStatementTitle,
                  fileName: `${t.incomeStatementTitle}-${new Date().toISOString().slice(0, 10)}.xlsx`,
                  title: t.incomeStatementTitle,
                  subtitle: [dateFrom && `${t.from}: ${dateFrom}`, dateTo && `${t.to}: ${dateTo}`].filter(Boolean).join(' '),
                });
              }} variant="outline" size="sm" className="gap-2" disabled={!data}>
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

      {loading ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-6 space-y-4">
                <Skeleton className="h-6 w-40" />
                {Array.from({ length: 5 }).map((_, j) => (
                  <div key={j} className="flex justify-between">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-4 w-24" />
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : data ? (
        <>
          {/* Net Income Status */}
          <div
            className={`flex items-center gap-3 rounded-lg border p-4 ${
              data.netIncome >= 0
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300'
                : 'border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300'
            }`}
          >
            {data.netIncome >= 0 ? (
              <TrendingUp className="size-6 shrink-0" />
            ) : (
              <TrendingDown className="size-6 shrink-0" />
            )}
            <div>
              <p className="font-semibold text-base">
                {data.netIncome >= 0 ? t.profit : t.loss}:{' '}
                <CurrencyAmount amount={Math.abs(data.netIncome)} symbolClassName="w-3.5 h-3.5" />
              </p>
              <p className="text-sm opacity-80">
                {t.totalRevenueLabel} (<CurrencyAmount amount={data.totalRevenue} symbolClassName="w-3.5 h-3.5" />) - {t.totalExpensesLabel} (<CurrencyAmount amount={data.totalExpenses} symbolClassName="w-3.5 h-3.5" />)
              </p>
            </div>
            <Badge
              className={`mr-auto text-sm px-3 py-1 ${
                data.netIncome >= 0
                  ? 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-900/40 dark:text-emerald-300 dark:border-emerald-700'
                  : 'bg-red-100 text-red-800 border-red-300 dark:bg-red-900/40 dark:text-red-300 dark:border-red-700'
              }`}
            >
              {data.netIncome >= 0 ? t.profit : t.loss}
            </Badge>
          </div>

          {/* Revenue & Expenses Tables */}
          <div className="grid gap-4 lg:grid-cols-2">
            {/* Revenue Section */}
            <Card className="border-emerald-200 dark:border-emerald-800">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
                  <TrendingUp className="size-5" />
                  {t.revenue}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {filteredRevenue.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    {t.noRevenueAccounts}
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-emerald-50/50 dark:bg-emerald-950/20">
                        <TableHead className="text-right font-bold">{t.account}</TableHead>
                        <TableHead className="text-left font-bold">{t.amount}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredRevenue.map((item) => (
                        <TableRow key={item.accountCode}>
                          <TableCell><AccountCodeBadge code={item.accountCode} name={item.accountName} /></TableCell>
                          <TableCell className="text-left font-mono font-semibold">
                            <CurrencyAmount amount={item.amount} symbolClassName="w-3.5 h-3.5" />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
                <div className="flex items-center justify-between pt-4 mt-3 border-t-2 border-emerald-300 dark:border-emerald-700">
                  <span className="font-bold text-emerald-700 dark:text-emerald-400">{t.totalRevenueLabel}</span>
                  <span className="font-bold font-mono text-emerald-700 dark:text-emerald-400 text-lg">
                    <CurrencyAmount amount={data.totalRevenue} symbolClassName="w-3.5 h-3.5" />
                  </span>
                </div>
              </CardContent>
            </Card>

            {/* Expenses Section */}
            <Card className="border-amber-200 dark:border-amber-800">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg flex items-center gap-2 text-amber-700 dark:text-amber-400">
                  <TrendingDown className="size-5" />
                  {t.expense}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {filteredExpenses.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    {t.noExpenseAccounts}
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-amber-50/50 dark:bg-amber-950/20">
                        <TableHead className="text-right font-bold">{t.account}</TableHead>
                        <TableHead className="text-left font-bold">{t.amount}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredExpenses.map((item) => (
                        <TableRow key={item.accountCode}>
                          <TableCell><AccountCodeBadge code={item.accountCode} name={item.accountName} /></TableCell>
                          <TableCell className="text-left font-mono font-semibold">
                            <CurrencyAmount amount={item.amount} symbolClassName="w-3.5 h-3.5" />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
                <div className="flex items-center justify-between pt-4 mt-3 border-t-2 border-amber-300 dark:border-amber-700">
                  <span className="font-bold text-amber-700 dark:text-amber-400">{t.totalExpensesLabel}</span>
                  <span className="font-bold font-mono text-amber-700 dark:text-amber-400 text-lg">
                    <CurrencyAmount amount={data.totalExpenses} symbolClassName="w-3.5 h-3.5" />
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Net Income Summary */}
          <Card
            className={`border-2 ${
              data.netIncome >= 0
                ? 'border-emerald-300 bg-emerald-50/50 dark:border-emerald-700 dark:bg-emerald-950/20'
                : 'border-red-300 bg-red-50/50 dark:border-red-700 dark:bg-red-950/20'
            }`}
          >
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {data.netIncome >= 0 ? (
                    <CheckCircle2 className="size-6 text-emerald-600 dark:text-emerald-400" />
                  ) : (
                    <AlertTriangle className="size-6 text-red-500 dark:text-red-400" />
                  )}
                  <span className="text-lg font-bold">
                    {data.netIncome >= 0 ? t.netProfit : t.netLoss}
                  </span>
                </div>
                <span
                  className={`text-2xl font-bold font-mono ${
                    data.netIncome >= 0
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : 'text-red-600 dark:text-red-400'
                  }`}
                >
                  <CurrencyAmount amount={Math.abs(data.netIncome)} symbolClassName="w-3.5 h-3.5" />
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Revenue vs Expenses Bar Chart */}
          {data.totalRevenue > 0 || data.totalExpenses > 0 ? (
            <Card className="no-print">
              <CardHeader>
                <CardTitle className="text-lg text-emerald-700 dark:text-emerald-400">
                  {t.revenueVsExpenses}
                </CardTitle>
                <CardDescription>{t.revenueExpensesChartDesc}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-72 w-full" dir="ltr">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis
                        dataKey="name"
                        tick={{ fontSize: 13, fill: 'var(--foreground)' }}
                        axisLine={{ stroke: 'var(--border)' }}
                      />
                      <YAxis
                        tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }}
                        axisLine={{ stroke: 'var(--border)' }}
                        tickFormatter={(val) => formatChartNumber(val, 0)}
                      />
                      <Tooltip
                        formatter={(value: number) => [formatCurrencyWithSymbol(value)]}
                        contentStyle={{
                          backgroundColor: 'var(--card)',
                          border: '1px solid var(--border)',
                          borderRadius: '8px',
                          color: 'var(--foreground)',
                          direction: isRTL ? 'rtl' : 'ltr',
                        }}
                      />
                      <Legend />
                      <Bar dataKey="amount" name={t.amount} radius={[6, 6, 0, 0]} maxBarSize={80}>
                        {chartData.map((entry, index) => (
                          <Cell
                            key={`cell-${index}`}
                            fill={
                              index === 0
                                ? 'oklch(0.596 0.12 160)' // emerald for revenue
                                : index === 1
                                ? 'oklch(0.577 0.15 55)' // amber for expenses
                                : entry.amount >= 0
                                ? 'oklch(0.508 0.14 160)' // emerald darker for profit
                                : 'oklch(0.577 0.245 27.325)' // red for loss
                            }
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          ) : null}
        </>
      ) : (
        <Card>
          <CardContent className="p-12 text-center text-muted-foreground">
            <p className="text-lg font-medium">{t.noData}</p>
            <p className="text-sm mt-1">{t.noDataAdjustDate}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
