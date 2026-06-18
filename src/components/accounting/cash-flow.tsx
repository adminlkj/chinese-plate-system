'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Printer, Calendar, Search, TrendingUp, TrendingDown, Wallet, ArrowUpDown, Building2, Landmark, CheckCircle2, AlertTriangle, FileSpreadsheet } from 'lucide-react';
import type { CashFlowData } from '@/lib/types';
import { CurrencyAmount } from '@/components/ui/currency-symbol';
import { toast } from 'sonner';
import { exportToExcel } from '@/lib/export-utils';
import { printReportDocument, fetchCompanyInfoForPrint, generateReportNumber } from '@/lib/report-print';
import { useAppStore } from '@/lib/store';
import { useTranslation } from '@/lib/i18n';

// Currency display uses CurrencyAmount component

interface CashFlowResponse extends CashFlowData {
  cashBalance: number;
}

export default function CashFlow() {
  const { t, isRTL } = useTranslation();
  const { user } = useAppStore();
  const [data, setData] = useState<CashFlowResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (dateFrom) params.set('dateFrom', dateFrom);
      if (dateTo) params.set('dateTo', dateTo);
      const res = await fetch(`/api/reports/cash-flow?${params.toString()}`);
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

  const handlePrint = async () => {
    if (!data) return;
    let html = '';

    // Operating Activities
    html += `<div class="section"><div class="section-title">${t.operatingActivities}</div>`;
    html += `<table><thead><tr>
      <th>${t.description}</th><th class="text-left">${t.amount}</th>
    </tr></thead><tbody>`;
    for (const item of data.operatingActivities) {
      html += `<tr>
        <td>${item.description}</td>
        <td class="num ${item.amount >= 0 ? 'text-green' : 'text-red'}">${item.amount >= 0 ? '+' : ''}${item.amount.toFixed(2)}</td>
      </tr>`;
    }
    html += `<tr class="total-row">
      <td>${t.totalOperatingActivities}</td>
      <td class="num">${data.totalOperating.toFixed(2)}</td>
    </tr>`;
    html += `</tbody></table></div>`;

    // Investing Activities
    html += `<div class="section"><div class="section-title">${t.investingActivities}</div>`;
    html += `<table><thead><tr>
      <th>${t.description}</th><th class="text-left">${t.amount}</th>
    </tr></thead><tbody>`;
    for (const item of data.investingActivities) {
      html += `<tr>
        <td>${item.description}</td>
        <td class="num ${item.amount >= 0 ? 'text-green' : 'text-red'}">${item.amount >= 0 ? '+' : ''}${item.amount.toFixed(2)}</td>
      </tr>`;
    }
    html += `<tr class="total-row">
      <td>${t.totalInvestingActivities}</td>
      <td class="num">${data.totalInvesting.toFixed(2)}</td>
    </tr>`;
    html += `</tbody></table></div>`;

    // Financing Activities
    html += `<div class="section"><div class="section-title">${t.financingActivities}</div>`;
    html += `<table><thead><tr>
      <th>${t.description}</th><th class="text-left">${t.amount}</th>
    </tr></thead><tbody>`;
    for (const item of data.financingActivities) {
      html += `<tr>
        <td>${item.description}</td>
        <td class="num ${item.amount >= 0 ? 'text-green' : 'text-red'}">${item.amount >= 0 ? '+' : ''}${item.amount.toFixed(2)}</td>
      </tr>`;
    }
    html += `<tr class="total-row">
      <td>${t.totalFinancingActivities}</td>
      <td class="num">${data.totalFinancing.toFixed(2)}</td>
    </tr>`;
    html += `</tbody></table></div>`;

    // Net cash flow & cash balance
    html += `<div class="summary-total">
      <span>${t.netCashFlow}</span>
      <span class="${data.netCashFlow >= 0 ? 'text-green' : 'text-red'}">${data.netCashFlow >= 0 ? '+' : ''}${data.netCashFlow.toFixed(2)}</span>
    </div>`;
    html += `<div class="summary-row">
      <span>${t.currentCashBalance}</span>
      <span class="num font-bold">${data.cashBalance.toFixed(2)}</span>
    </div>`;

    const company = await fetchCompanyInfoForPrint();

    const success = printReportDocument({
      title: t.cashFlowTitle,
      titleEn: 'Cash Flow Statement',
      reportNumber: generateReportNumber('CF'),
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

  const renderActivitySection = (
    title: string,
    icon: React.ReactNode,
    items: { description: string; amount: number }[],
    total: number,
    accentColor: string,
    borderColor: string,
    darkBorderColor: string
  ) => (
    <Card className={`${borderColor} ${darkBorderColor}`}>
      <CardHeader className="pb-2">
        <CardTitle className={`text-lg flex items-center gap-2 ${accentColor}`}>
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            {t.noLineItems}
          </p>
        ) : (
          items.map((item) => (
            <div
              key={item.description}
              className="flex items-center justify-between py-2 border-b border-border/50 last:border-0"
            >
              <div className="flex items-center gap-2">
                <span
                  className={`w-2 h-2 rounded-full shrink-0 ${
                    item.amount >= 0
                      ? 'bg-emerald-500'
                      : 'bg-red-500'
                  }`}
                />
                <span className="text-sm">{item.description}</span>
              </div>
              <span
                className={`text-sm font-mono font-semibold ${
                  item.amount >= 0
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-red-500 dark:text-red-400'
                }`}
              >
                {item.amount >= 0 ? '+' : ''}
                <CurrencyAmount amount={item.amount} symbolClassName="w-3.5 h-3.5" />
              </span>
            </div>
          ))
        )}
        <div className={`flex items-center justify-between pt-3 mt-2 border-t-2 ${borderColor} ${darkBorderColor}`}>
          <span className={`font-bold ${accentColor}`}>{t.total}</span>
          <span className={`font-bold font-mono text-lg ${accentColor}`}>
            {total >= 0 ? '+' : ''}
            <CurrencyAmount amount={total} symbolClassName="w-3.5 h-3.5" />
          </span>
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-4 print:p-0">
      {/* Header Card with Filters */}
      <Card className="no-print">
        <CardHeader>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-xl text-emerald-700 dark:text-emerald-400">
                {t.cashFlowTitle}
              </CardTitle>
              <CardDescription>
                {t.cashFlowDesc}
              </CardDescription>
            </div>
            <Button onClick={() => {
              if (!data) return;
              const exportData = [
                ...data.operatingActivities.map((item) => ({ description: item.description, amount: item.amount, category: t.operatingCategory })),
                ...data.investingActivities.map((item) => ({ description: item.description, amount: item.amount, category: t.investingCategory })),
                ...data.financingActivities.map((item) => ({ description: item.description, amount: item.amount, category: t.financingCategory })),
              ];
              exportToExcel({
                data: exportData,
                columns: [
                  { key: 'description', header: t.description, width: 30 },
                  { key: 'amount', header: t.amount, width: 15 },
                  { key: 'category', header: t.classification, width: 18 },
                ],
                sheetName: t.cashFlowTitle,
                fileName: `${t.cashFlowTitle}-${new Date().toISOString().slice(0, 10)}.xlsx`,
                title: t.cashFlowTitle,
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
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-6 space-y-4">
                <Skeleton className="h-6 w-48" />
                {Array.from({ length: 4 }).map((_, j) => (
                  <div key={j} className="flex justify-between">
                    <Skeleton className="h-4 w-36" />
                    <Skeleton className="h-4 w-28" />
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : data ? (
        <>
          {/* Cash Balance & Net Cash Flow Summary Cards */}
          <div className="grid gap-4 sm:grid-cols-2 no-print">
            {/* Cash Balance */}
            <Card className="border-emerald-200 dark:border-emerald-800 bg-gradient-to-bl from-emerald-50 to-transparent dark:from-emerald-950/30">
              <CardContent className="p-6">
                <div className="flex items-center gap-3">
                  <div className="p-3 rounded-xl bg-emerald-100 dark:bg-emerald-900/40">
                    <Wallet className="size-6 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm text-muted-foreground">{t.currentCashBalance}</p>
                    <p className="text-2xl font-bold font-mono text-emerald-700 dark:text-emerald-400">
                      <CurrencyAmount amount={data.cashBalance} symbolClassName="w-3.5 h-3.5" />
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Net Cash Flow */}
            <Card
              className={`border-2 ${
                data.netCashFlow >= 0
                  ? 'border-emerald-200 bg-gradient-to-bl from-emerald-50 to-transparent dark:border-emerald-800 dark:from-emerald-950/30'
                  : 'border-red-200 bg-gradient-to-bl from-red-50 to-transparent dark:border-red-800 dark:from-red-950/30'
              }`}
            >
              <CardContent className="p-6">
                <div className="flex items-center gap-3">
                  <div
                    className={`p-3 rounded-xl ${
                      data.netCashFlow >= 0
                        ? 'bg-emerald-100 dark:bg-emerald-900/40'
                        : 'bg-red-100 dark:bg-red-900/40'
                    }`}
                  >
                    {data.netCashFlow >= 0 ? (
                      <TrendingUp className="size-6 text-emerald-600 dark:text-emerald-400" />
                    ) : (
                      <TrendingDown className="size-6 text-red-500 dark:text-red-400" />
                    )}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm text-muted-foreground">{t.netCashFlow}</p>
                    <p
                      className={`text-2xl font-bold font-mono ${
                        data.netCashFlow >= 0
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : 'text-red-600 dark:text-red-400'
                      }`}
                    >
                      {data.netCashFlow >= 0 ? '+' : ''}
                      <CurrencyAmount amount={data.netCashFlow} symbolClassName="w-3.5 h-3.5" />
                    </p>
                  </div>
                  <Badge
                    className={`text-sm px-3 py-1 ${
                      data.netCashFlow >= 0
                        ? 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-900/40 dark:text-emerald-300 dark:border-emerald-700'
                        : 'bg-red-100 text-red-800 border-red-300 dark:bg-red-900/40 dark:text-red-300 dark:border-red-700'
                    }`}
                  >
                    {data.netCashFlow >= 0 ? t.positiveFlow : t.negativeFlow}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Three Activity Sections */}
          <div className="space-y-4">
            {/* Operating Activities */}
            {renderActivitySection(
              t.operatingActivities,
              <ArrowUpDown className="size-5" />,
              data.operatingActivities,
              data.totalOperating,
              'text-emerald-700 dark:text-emerald-400',
              'border-emerald-200',
              'dark:border-emerald-800'
            )}

            {/* Investing Activities */}
            {renderActivitySection(
              t.investingActivities,
              <Building2 className="size-5" />,
              data.investingActivities,
              data.totalInvesting,
              'text-amber-700 dark:text-amber-400',
              'border-amber-200',
              'dark:border-amber-800'
            )}

            {/* Financing Activities */}
            {renderActivitySection(
              t.financingActivities,
              <Landmark className="size-5" />,
              data.financingActivities,
              data.totalFinancing,
              'text-teal-700 dark:text-teal-400',
              'border-teal-200',
              'dark:border-teal-800'
            )}
          </div>

          {/* Cash Flow Summary Table */}
          <Card className="border-emerald-200 dark:border-emerald-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg text-emerald-700 dark:text-emerald-400">
                {t.cashFlowSummary}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex items-center justify-between py-2">
                  <span className="text-sm font-medium flex items-center gap-2">
                    <ArrowUpDown className="size-4 text-emerald-600" />
                    {t.netOperatingActivities}
                  </span>
                  <span
                    className={`font-mono font-semibold ${
                      data.totalOperating >= 0
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-red-500 dark:text-red-400'
                    }`}
                  >
                    <CurrencyAmount amount={data.totalOperating} symbolClassName="w-3.5 h-3.5" />
                  </span>
                </div>
                <div className="flex items-center justify-between py-2">
                  <span className="text-sm font-medium flex items-center gap-2">
                    <Building2 className="size-4 text-amber-600" />
                    {t.netInvestingActivities}
                  </span>
                  <span
                    className={`font-mono font-semibold ${
                      data.totalInvesting >= 0
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-red-500 dark:text-red-400'
                    }`}
                  >
                    <CurrencyAmount amount={data.totalInvesting} symbolClassName="w-3.5 h-3.5" />
                  </span>
                </div>
                <div className="flex items-center justify-between py-2">
                  <span className="text-sm font-medium flex items-center gap-2">
                    <Landmark className="size-4 text-teal-600" />
                    {t.netFinancingActivities}
                  </span>
                  <span
                    className={`font-mono font-semibold ${
                      data.totalFinancing >= 0
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-red-500 dark:text-red-400'
                    }`}
                  >
                    <CurrencyAmount amount={data.totalFinancing} symbolClassName="w-3.5 h-3.5" />
                  </span>
                </div>
                <div className="flex items-center justify-between pt-4 mt-2 border-t-2 border-emerald-300 dark:border-emerald-700">
                  <span className="font-bold text-lg flex items-center gap-2">
                    <Wallet className="size-5 text-emerald-600" />
                    {t.netCashFlow}
                  </span>
                  <span
                    className={`font-bold font-mono text-xl ${
                      data.netCashFlow >= 0
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : 'text-red-600 dark:text-red-400'
                    }`}
                  >
                    {data.netCashFlow >= 0 ? '+' : ''}
                    <CurrencyAmount amount={data.netCashFlow} symbolClassName="w-3.5 h-3.5" />
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Current Cash Balance */}
          <Card className="border-emerald-200 dark:border-emerald-800 bg-emerald-50/30 dark:bg-emerald-950/10">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-emerald-100 dark:bg-emerald-900/40">
                    <Wallet className="size-5 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <span className="text-lg font-bold text-emerald-700 dark:text-emerald-400">
                    {t.currentCashBalance}
                  </span>
                </div>
                <span className="text-2xl font-bold font-mono text-emerald-700 dark:text-emerald-400">
                  <CurrencyAmount amount={data.cashBalance} symbolClassName="w-3.5 h-3.5" />
                </span>
              </div>
            </CardContent>
          </Card>
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
