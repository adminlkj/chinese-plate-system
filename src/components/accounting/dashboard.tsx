'use client';

import { useEffect, useState } from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import {
  TrendingUp,
  TrendingDown,
  Wallet,
  Landmark,
  Users,
  Building,
  DollarSign,
  BarChart3,
  Receipt,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
} from 'recharts';
import { formatCurrencyWithSymbol } from '@/lib/types';
import { CurrencyAmount } from '@/components/ui/currency-symbol';
import type { DashboardData, JournalEntryType, EntryStatus } from '@/lib/types';
import { useTranslation } from '@/lib/i18n';

// Currency display uses CurrencyAmount component and formatCurrencyWithSymbol

// Expense bar colors (warm)
const EXPENSE_COLORS = [
  'oklch(0.637 0.237 25.331)', // orange
  'oklch(0.577 0.245 27.325)', // red
  'oklch(0.701 0.187 47.604)', // amber
  'oklch(0.637 0.17 40)',      // warm orange
  'oklch(0.585 0.21 30)',      // deep red
];

function getStatusLabel(t: any, status: EntryStatus): string {
  const statusKeyMap: Record<EntryStatus, string> = {
    DRAFT: t.draft,
    POSTED: t.posted,
    CANCELLED: t.cancelled,
    RETURNED: t.returned,
  };
  return statusKeyMap[status] || status;
}

function StatusBadge({ status }: { status: EntryStatus }) {
  const { t } = useTranslation();
  const label = getStatusLabel(t, status);
  switch (status) {
    case 'POSTED':
      return (
        <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 hover:bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-800">
          {label}
        </Badge>
      );
    case 'DRAFT':
      return (
        <Badge className="bg-yellow-100 text-yellow-700 border-yellow-200 hover:bg-yellow-100 dark:bg-yellow-900/30 dark:text-yellow-400 dark:border-yellow-800">
          {label}
        </Badge>
      );
    case 'CANCELLED':
      return (
        <Badge className="bg-red-100 text-red-700 border-red-200 hover:bg-red-100 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800">
          {label}
        </Badge>
      );
    default:
      return <Badge variant="outline">{label}</Badge>;
  }
}

function StatCardSkeleton() {
  return (
    <Card className="py-4">
      <CardHeader className="pb-0 pt-0">
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-9 w-9 rounded-lg" />
        </div>
      </CardHeader>
      <CardContent>
        <Skeleton className="h-7 w-32 mb-1" />
        <Skeleton className="h-3 w-20" />
      </CardContent>
    </Card>
  );
}

function ChartSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-5 w-40" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-64 w-full" />
      </CardContent>
    </Card>
  );
}

function getEntryTypeLabel(t: any, type: JournalEntryType): string {
  const entryTypeKeyMap: Partial<Record<JournalEntryType, string>> = {
    SALE_CASH: t.saleCash,
    SALE_BANK: t.saleBank,
    SALE_PLATFORM: t.salePlatform,
    SALE_RETURN_CASH: t.saleReturnCash,
    SALE_RETURN_BANK: t.saleReturnBank,
    SALE_RETURN_PLATFORM: t.saleReturnPlatform,
    EXPENSE_CASH: t.expenseCash,
    EXPENSE_BANK: t.expenseBank,
    EXPENSE_SADAD: t.expenseSadad,
    PURCHASE_CASH: t.purchaseCash,
    PURCHASE_BANK: t.purchaseBank,
    PURCHASE_CREDIT: t.purchaseCredit,
    PURCHASE_RETURN_CASH: t.purchaseReturnCash,
    PURCHASE_RETURN_BANK: t.purchaseReturnBank,
    PURCHASE_RETURN_CREDIT: t.purchaseReturnCredit,
    COLLECTION: t.collection,
    PAYMENT: t.payment,
    DEPOSIT: t.deposit,
    WITHDRAWAL: t.withdrawal,
    TRANSFER: t.transfer,
    MANUAL: t.manual,
    OPENING_BALANCE: t.openingBalance,
    YEAR_END_CLOSING: t.yearEndClosing || 'Year End Closing',
  };
  return entryTypeKeyMap[type] || type;
}

export default function Dashboard() {
  const { t, isRTL } = useTranslation();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Chart configs
  const revenueBranchChartConfig: ChartConfig = {
    amount: {
      label: t.amountLabel,
      color: 'oklch(0.596 0.12 160)',
    },
  };

  const expenseCategoryChartConfig: ChartConfig = {
    amount: {
      label: t.amountLabel,
      color: 'oklch(0.637 0.237 25.331)',
    },
  };

  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);
        const res = await fetch('/api/dashboard');
        if (!res.ok) {
          throw new Error(t.errorLoadingData);
        }
        const json = await res.json();
        setData(json);
      } catch (err: any) {
        setError(err.message || t.error);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  // Format date in locale-aware format
  const formatDate = (dateStr: string) => {
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString(isRTL ? 'ar-SA-u-nu-latn' : 'en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return dateStr;
    }
  };

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center">
            <div className="text-destructive text-5xl mb-4">⚠</div>
            <h3 className="text-lg font-semibold mb-2">{t.errorLoadingData}</h3>
            <p className="text-muted-foreground text-sm">{error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top Stats Cards - 4 cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {loading ? (
          <>
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
          </>
        ) : (
          <>
            {/* Total Revenue */}
            <Card className="py-4 transition-shadow hover:shadow-md">
              <CardHeader className="pb-0 pt-0">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-muted-foreground">{t.totalRevenue}</p>
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-100 dark:bg-emerald-900/30">
                    <TrendingUp className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                  <CurrencyAmount amount={data?.totalRevenue ?? 0} symbolClassName="w-3.5 h-3.5" />
                </div>
                <p className="text-xs text-muted-foreground mt-1">{t.totalRevenueDesc}</p>
              </CardContent>
            </Card>

            {/* Total Expenses */}
            <Card className="py-4 transition-shadow hover:shadow-md">
              <CardHeader className="pb-0 pt-0">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-muted-foreground">{t.totalExpenses}</p>
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-red-100 dark:bg-red-900/30">
                    <TrendingDown className="h-5 w-5 text-red-600 dark:text-red-400" />
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-red-600 dark:text-red-400">
                  <CurrencyAmount amount={data?.totalExpenses ?? 0} symbolClassName="w-3.5 h-3.5" />
                </div>
                <p className="text-xs text-muted-foreground mt-1">{t.totalExpensesDesc}</p>
              </CardContent>
            </Card>

            {/* Net Income */}
            <Card className="py-4 transition-shadow hover:shadow-md">
              <CardHeader className="pb-0 pt-0">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-muted-foreground">{t.netIncome}</p>
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-100 dark:bg-teal-900/30">
                    <DollarSign className="h-5 w-5 text-teal-600 dark:text-teal-400" />
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className={`text-2xl font-bold ${(data?.netIncome ?? 0) >= 0 ? 'text-teal-600 dark:text-teal-400' : 'text-red-600 dark:text-red-400'}`}>
                  <CurrencyAmount amount={data?.netIncome ?? 0} symbolClassName="w-3.5 h-3.5" />
                </div>
                <p className="text-xs text-muted-foreground mt-1">{t.netIncomeDesc}</p>
              </CardContent>
            </Card>

            {/* Cash Balance */}
            <Card className="py-4 transition-shadow hover:shadow-md">
              <CardHeader className="pb-0 pt-0">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-muted-foreground">{t.cashBalance}</p>
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-900/30">
                    <Wallet className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-amber-600 dark:text-amber-400">
                  <CurrencyAmount amount={data?.cashBalance ?? 0} symbolClassName="w-3.5 h-3.5" />
                </div>
                <p className="text-xs text-muted-foreground mt-1">{t.cashBalanceDesc}</p>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {/* Second Row Stats - 3 cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {loading ? (
          <>
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
          </>
        ) : (
          <>
            {/* Accounts Receivable */}
            <Card className="py-4 transition-shadow hover:shadow-md">
              <CardHeader className="pb-0 pt-0">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-muted-foreground">{t.accountsReceivable}</p>
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-100 dark:bg-sky-900/30">
                    <Users className="h-5 w-5 text-sky-600 dark:text-sky-400" />
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  <CurrencyAmount amount={data?.accountsReceivable ?? 0} symbolClassName="w-3.5 h-3.5" />
                </div>
                <p className="text-xs text-muted-foreground mt-1">{t.accountsReceivableDesc}</p>
              </CardContent>
            </Card>

            {/* Accounts Payable */}
            <Card className="py-4 transition-shadow hover:shadow-md">
              <CardHeader className="pb-0 pt-0">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-muted-foreground">{t.accountsPayable}</p>
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-rose-100 dark:bg-rose-900/30">
                    <Building className="h-5 w-5 text-rose-600 dark:text-rose-400" />
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  <CurrencyAmount amount={data?.accountsPayable ?? 0} symbolClassName="w-3.5 h-3.5" />
                </div>
                <p className="text-xs text-muted-foreground mt-1">{t.accountsPayableDesc}</p>
              </CardContent>
            </Card>

            {/* Total Assets */}
            <Card className="py-4 transition-shadow hover:shadow-md">
              <CardHeader className="pb-0 pt-0">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-muted-foreground">{t.totalAssets}</p>
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-100 dark:bg-emerald-900/30">
                    <Landmark className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  <CurrencyAmount amount={data?.totalAssets ?? 0} symbolClassName="w-3.5 h-3.5" />
                </div>
                <p className="text-xs text-muted-foreground mt-1">{t.totalAssetsDesc}</p>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {loading ? (
          <>
            <ChartSkeleton />
            <ChartSkeleton />
          </>
        ) : (
          <>
            {/* Revenue by Branch */}
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                  <CardTitle className="text-base">{t.revenueByBranch}</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <ChartContainer config={revenueBranchChartConfig} className="h-64 w-full">
                  <BarChart
                    data={data?.revenueByBranch ?? []}
                    layout="vertical"
                    margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                    <YAxis
                      type="category"
                      dataKey="branch"
                      width={90}
                      tick={{ fontSize: 13 }}
                    />
                    <ChartTooltip
                      content={<ChartTooltipContent />}
                      formatter={(value: number) => [formatCurrencyWithSymbol(value), t.amountLabel]}
                    />
                    <Bar
                      dataKey="amount"
                      fill="var(--color-amount)"
                      radius={[0, 6, 6, 0]}
                      maxBarSize={36}
                    />
                  </BarChart>
                </ChartContainer>
              </CardContent>
            </Card>

            {/* Expenses by Category */}
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Receipt className="h-5 w-5 text-orange-600 dark:text-orange-400" />
                  <CardTitle className="text-base">{t.expensesByCategory}</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <ChartContainer config={expenseCategoryChartConfig} className="h-64 w-full">
                  <BarChart
                    data={(data?.expensesByCategory ?? []).slice(0, 5)}
                    layout="vertical"
                    margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                    <YAxis
                      type="category"
                      dataKey="category"
                      width={120}
                      tick={{ fontSize: 12 }}
                    />
                    <ChartTooltip
                      content={<ChartTooltipContent />}
                      formatter={(value: number) => [formatCurrencyWithSymbol(value), t.amountLabel]}
                    />
                    <Bar dataKey="amount" radius={[0, 6, 6, 0]} maxBarSize={36}>
                      {(data?.expensesByCategory ?? []).slice(0, 5).map((_, index) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={EXPENSE_COLORS[index % EXPENSE_COLORS.length]}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ChartContainer>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {/* Recent Transactions */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Receipt className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              <CardTitle className="text-base">{t.recentEntries}</CardTitle>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : (data?.recentTransactions ?? []).length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              <Receipt className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p>{t.noEntriesYet}</p>
            </div>
          ) : (
            <div className="max-h-96 overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-right">{t.entryNumber}</TableHead>
                    <TableHead className="text-right">{t.date}</TableHead>
                    <TableHead className="text-right">{t.description}</TableHead>
                    <TableHead className="text-right">{t.type}</TableHead>
                    <TableHead className="text-right">{t.amount}</TableHead>
                    <TableHead className="text-right">{t.status}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(data?.recentTransactions ?? []).map((tx) => (
                    <TableRow key={tx.id}>
                      <TableCell className="font-mono text-sm">
                        {tx.entryNumber}
                      </TableCell>
                      <TableCell className="text-sm">
                        {formatDate(tx.date)}
                      </TableCell>
                      <TableCell className="text-sm max-w-[200px] truncate">
                        {tx.description}
                      </TableCell>
                      <TableCell className="text-sm">
                        {getEntryTypeLabel(t, tx.type as JournalEntryType) || tx.type}
                      </TableCell>
                      <TableCell className="text-sm font-mono font-medium">
                        <CurrencyAmount amount={tx.amount} symbolClassName="w-3.5 h-3.5" />
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={tx.status as EntryStatus} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
