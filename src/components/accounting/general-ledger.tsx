'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import { format } from 'date-fns';
import { arSA } from 'date-fns/locale/ar-SA';
import { enUS } from 'date-fns/locale/en-US';
import {
  Printer,
  CalendarIcon,
  Loader2,
  AlertCircle,
  BookOpen,
  Search,
  ChevronDown,
  FileSpreadsheet,
} from 'lucide-react';
import { toast } from 'sonner';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableFooter,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';

import {
  AccountWithBalance,
  LedgerEntry,
  AccountType,
  NORMAL_BALANCE,
} from '@/lib/types';
import { CurrencyAmount } from '@/components/ui/currency-symbol';
import { exportToExcel } from '@/lib/export-utils';
import { printReportDocument, fetchCompanyInfoForPrint, generateReportNumber } from '@/lib/report-print';
import { useAppStore } from '@/lib/store';
import { AccountCodeBadge } from '@/components/accounting/account-code-badge';
import { useTranslation } from '@/lib/i18n';

// Format date based on locale
// NOTE (PAYROLL-FIX-FINAL): always force Latin/English digits even when using
// the Arabic locale (for month names) — per "الارقام انجليزية دائما" requirement.
function formatDate(dateStr: string, useArabicLocale: boolean): string {
  try {
    const formatted = format(new Date(dateStr), 'dd/MM/yyyy', { locale: useArabicLocale ? arSA : enUS });
    return formatted.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
  } catch {
    return dateStr;
  }
}

// Account type color
function accountTypeColor(type: AccountType): string {
  switch (type) {
    case 'ASSET':
      return 'text-blue-700 dark:text-blue-400';
    case 'LIABILITY':
      return 'text-orange-700 dark:text-orange-400';
    case 'EQUITY':
      return 'text-purple-700 dark:text-purple-400';
    case 'REVENUE':
      return 'text-emerald-700 dark:text-emerald-400';
    case 'EXPENSE':
      return 'text-red-700 dark:text-red-400';
    default:
      return '';
  }
}

// Flat list item with depth for hierarchical display
interface FlatAccountItem {
  id: string;
  code: string;
  name: string;
  type: string;
  depth: number;
  isParent: boolean;
  childCount: number;
}

export default function GeneralLedger() {
  const { t, isRTL } = useTranslation();
  const { user } = useAppStore();

  // Helper: account type label
  const getAccountTypeLabel = (type: AccountType): string => {
    const map: Record<string, string> = {
      ASSET: t.asset,
      LIABILITY: t.liability,
      EQUITY: t.equity,
      REVENUE: t.revenue,
      EXPENSE: t.expense,
    };
    return map[type] || type;
  };

  // Filter state
  const [selectedAccountId, setSelectedAccountId] = useState<string>('');
  const [dateFrom, setDateFrom] = useState<Date | undefined>();
  const [dateTo, setDateTo] = useState<Date | undefined>();

  // Data state
  const [accounts, setAccounts] = useState<AccountWithBalance[]>([]);
  const [ledgerEntries, setLedgerEntries] = useState<LedgerEntry[]>([]);
  const [accountInfo, setAccountInfo] = useState<AccountWithBalance | null>(null);
  const [openingBalance, setOpeningBalance] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accountPopoverOpen, setAccountPopoverOpen] = useState(false);

  // Fetch accounts
  const fetchAccounts = useCallback(async () => {
    setAccountsLoading(true);
    try {
      const res = await fetch('/api/accounts');
      if (!res.ok) throw new Error(t.failedToFetchAccounts);
      const data = await res.json();
      // Flatten tree
      const flat: AccountWithBalance[] = [];
      const flatten = (nodes: any[]) => {
        for (const node of nodes) {
          flat.push(node);
          if (node.children?.length) flatten(node.children);
        }
      };
      flatten(data);
      setAccounts(flat.filter((a) => a.isActive));
    } catch (err: any) {
      toast.error(t.failedToFetchAccounts);
    } finally {
      setAccountsLoading(false);
    }
  }, [t]);

  // Fetch ledger data
  const fetchLedger = useCallback(async () => {
    if (!selectedAccountId) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('accountId', selectedAccountId);
      if (dateFrom) params.set('dateFrom', dateFrom.toISOString().split('T')[0]);
      if (dateTo) params.set('dateTo', dateTo.toISOString().split('T')[0]);

      const res = await fetch(`/api/reports/ledger?${params.toString()}`);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || t.failedToFetchData);
      }
      const data: LedgerEntry[] = await res.json();
      setLedgerEntries(data);

      // Set account info
      const acc = accounts.find((a) => a.id === selectedAccountId);
      setAccountInfo(acc || null);

      // Calculate opening balance
      if (acc) {
        if (data.length > 0) {
          const first = data[0];
          const normalBal = NORMAL_BALANCE[acc.type as AccountType];
          if (normalBal === 'DEBIT') {
            setOpeningBalance(first.balance - (first.debit - first.credit));
          } else {
            setOpeningBalance(first.balance - (first.credit - first.debit));
          }
        } else {
          setOpeningBalance(acc.currentBalance);
        }
      }
    } catch (err: any) {
      setError(err.message || t.errorLoadingData);
    } finally {
      setLoading(false);
    }
  }, [selectedAccountId, dateFrom, dateTo, accounts, t]);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  useEffect(() => {
    fetchLedger();
  }, [fetchLedger]);

  // Compute totals
  const totals = useMemo(() => {
    const totalDebit = ledgerEntries.reduce((s, e) => s + e.debit, 0);
    const totalCredit = ledgerEntries.reduce((s, e) => s + e.credit, 0);
    const lastBalance = ledgerEntries.length > 0 ? ledgerEntries[ledgerEntries.length - 1].balance : openingBalance;
    return { totalDebit, totalCredit, lastBalance };
  }, [ledgerEntries, openingBalance]);

  // Handle print
  const handlePrint = async () => {
    if (!accountInfo || ledgerEntries.length === 0) return;
    let html = '';

    // Account info
    html += `<div class="card">
      <div class="card-header">${t.accountInfo}</div>
      <div class="summary-row"><span class="font-mono">${accountInfo.code}</span> <span>${accountInfo.name}</span></div>
      <div class="summary-row"><span>${t.accountType}</span><span>${getAccountTypeLabel(accountInfo.type)}</span></div>
      <div class="summary-row"><span>${t.currentBalance}</span><span class="num font-bold">${accountInfo.currentBalance.toFixed(2)}</span></div>
    </div>`;

    // Ledger table
    html += `<table><thead><tr>
      <th>${t.date}</th><th>${t.entryNumber}</th><th>${t.description}</th><th class="text-left">${t.debit}</th><th class="text-left">${t.credit_account}</th><th class="text-left">${t.balance}</th>
    </tr></thead><tbody>`;

    // Opening balance
    html += `<tr class="total-row">
      <td colspan="3" class="text-center text-muted">${t.openingBalance}</td>
      <td class="num">${openingBalance >= 0 ? openingBalance.toFixed(2) : ''}</td>
      <td class="num">${openingBalance < 0 ? Math.abs(openingBalance).toFixed(2) : ''}</td>
      <td class="num font-bold">${Math.abs(openingBalance).toFixed(2)}</td>
    </tr>`;

    for (const entry of ledgerEntries) {
      html += `<tr>
        <td class="text-sm">${formatDate(entry.date, isRTL)}</td>
        <td class="font-mono text-sm">${entry.entryNumber}</td>
        <td>${entry.description}</td>
        <td class="num">${entry.debit > 0 ? entry.debit.toFixed(2) : '—'}</td>
        <td class="num">${entry.credit > 0 ? entry.credit.toFixed(2) : '—'}</td>
        <td class="num font-bold">${Math.abs(entry.balance).toFixed(2)}${entry.balance < 0 ? ` (${t.creditShort})` : ''}</td>
      </tr>`;
    }

    // Totals
    html += `<tr class="total-row">
      <td colspan="3" class="text-center">${t.total}</td>
      <td class="num">${totals.totalDebit.toFixed(2)}</td>
      <td class="num">${totals.totalCredit.toFixed(2)}</td>
      <td class="num">${Math.abs(totals.lastBalance).toFixed(2)}${totals.lastBalance < 0 ? ` (${t.creditShort})` : ''}</td>
    </tr>`;
    html += `</tbody></table>`;

    const dateSubtitle = [
      dateFrom && `${t.from}: ${formatDate(dateFrom.toISOString(), isRTL)}`,
      dateTo && `${t.to}: ${formatDate(dateTo.toISOString(), isRTL)}`,
    ].filter(Boolean).join(' · ');

    const company = await fetchCompanyInfoForPrint();

    const success = printReportDocument({
      title: `${t.ledger} — ${accountInfo.code} ${accountInfo.name}`,
      titleEn: 'General Ledger',
      subtitle: dateSubtitle || undefined,
      reportNumber: generateReportNumber('GL'),
      company,
      period: {
        from: dateFrom ? formatDate(dateFrom.toISOString(), isRTL) : '—',
        to: dateTo ? formatDate(dateTo.toISOString(), isRTL) : '—',
      },
      generatedBy: user?.name || '—',
      contentHtml: html,
      format: 'A4',
      orientation: 'landscape',
    });

    if (!success) {
      toast.error(t.failedToOpenPrint);
    }
  };

  // Build a flat hierarchical list for the account dropdown (parents first, then children indented)
  const flatAccountList = useMemo(() => {
    type AccountNode = AccountWithBalance & { children: AccountNode[] };
    const accountMap = new Map<string, AccountNode>();
    const roots: AccountNode[] = [];

    for (const acc of accounts) {
      accountMap.set(acc.id, { ...acc, children: [] });
    }

    for (const acc of accounts) {
      const node = accountMap.get(acc.id)!;
      if (acc.parentId && accountMap.has(acc.parentId)) {
        accountMap.get(acc.parentId)!.children.push(node);
      } else {
        roots.push(node);
      }
    }

    // Sort roots and children recursively by code
    const sortChildren = (nodes: AccountNode[]) => {
      nodes.sort((a, b) => a.code.localeCompare(b.code));
      for (const node of nodes) {
        sortChildren(node.children);
      }
    };
    sortChildren(roots);

    // Flatten into a list with depth info
    const result: FlatAccountItem[] = [];
    const flattenWithDepth = (
      nodes: AccountNode[],
      depth: number
    ) => {
      for (const node of nodes) {
        result.push({
          id: node.id,
          code: node.code,
          name: node.name,
          type: node.type,
          depth,
          isParent: node.children.length > 0,
          childCount: node.children.length,
        });
        if (node.children.length > 0) {
          flattenWithDepth(node.children, depth + 1);
        }
      }
    };
    flattenWithDepth(roots, 0);

    return result;
  }, [accounts]);

  // Find selected account name for display
  const selectedAccountName = useMemo(() => {
    if (!selectedAccountId) return '';
    const acc = accounts.find((a) => a.id === selectedAccountId);
    return acc ? `${acc.code} ${acc.name}` : '';
  }, [selectedAccountId, accounts]);

  // Tree connector prefix for hierarchical display
  const getTreePrefix = (depth: number, isParent: boolean): string => {
    if (depth === 0) return '';
    const indent = '\u00A0\u00A0'.repeat(depth - 1);
    return indent + '\u2514\u00A0'; // └ followed by space
  };

  return (
    <div className="space-y-4">
      {/* Account Selection & Filters */}
      <Card className="no-print">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-primary" />
            {t.ledger}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {/* Account Select - Custom dropdown with hierarchy */}
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">{t.account}</label>
              <Popover open={accountPopoverOpen} onOpenChange={setAccountPopoverOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className="w-full justify-between text-right font-normal h-9"
                  >
                    {selectedAccountId ? (
                      <span className="truncate">{selectedAccountName}</span>
                    ) : (
                      <span className="text-muted-foreground">{t.selectAccount}</span>
                    )}
                    <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[360px] p-0" align="start">
                  <div className="max-h-80 overflow-y-auto">
                    {accountsLoading ? (
                      <div className="p-3 text-sm text-muted-foreground text-center">
                        <Loader2 className="h-4 w-4 animate-spin mx-auto mb-1" />
                        {t.loading}
                      </div>
                    ) : flatAccountList.length === 0 ? (
                      <div className="p-3 text-sm text-muted-foreground text-center">
                        {t.noAccounts}
                      </div>
                    ) : (
                      flatAccountList.map((item) => {
                        const isSelected = selectedAccountId === item.id;
                        const prefix = getTreePrefix(item.depth, item.isParent);
                        return (
                          <div
                            key={item.id}
                            className={`flex items-center gap-1 px-3 py-2 cursor-pointer hover:bg-muted/60 transition-colors ${
                              isSelected ? 'bg-primary/10 text-primary font-medium' : ''
                            } ${item.depth > 0 ? 'text-sm' : 'font-semibold text-sm'}`}
                            onClick={() => {
                              setSelectedAccountId(item.id);
                              setAccountPopoverOpen(false);
                            }}
                          >
                            <span className="text-muted-foreground text-xs whitespace-pre" dir="ltr">
                              {prefix}
                            </span>
                            <span className={`inline-flex items-center px-1 py-0 rounded text-[9px] font-mono font-medium ${item.depth > 0 ? 'bg-muted text-muted-foreground' : 'bg-primary/10 text-primary'} ml-1`} dir="ltr">
                              {item.code}
                            </span>
                            <span className={item.depth > 0 ? '' : 'font-semibold'}>{item.name}</span>
                            {item.isParent && (
                              <span className="text-[10px] text-muted-foreground mr-auto">
                                ({item.childCount})
                              </span>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </PopoverContent>
              </Popover>
            </div>

            {/* Date From */}
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground flex items-center gap-1">
                <CalendarIcon className="h-3 w-3" />
                {t.dateFrom}
              </label>
              <input
                type="date"
                value={dateFrom ? dateFrom.toISOString().split('T')[0] : ''}
                onChange={(e) => setDateFrom(e.target.value ? new Date(e.target.value) : undefined)}
                className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm shadow-xs focus:border-ring focus:ring-ring/50 focus:ring-[3px] focus:outline-none h-9"
                dir="ltr"
              />
            </div>

            {/* Date To */}
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground flex items-center gap-1">
                <CalendarIcon className="h-3 w-3" />
                {t.dateTo}
              </label>
              <input
                type="date"
                value={dateTo ? dateTo.toISOString().split('T')[0] : ''}
                onChange={(e) => setDateTo(e.target.value ? new Date(e.target.value) : undefined)}
                className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm shadow-xs focus:border-ring focus:ring-ring/50 focus:ring-[3px] focus:outline-none h-9"
                dir="ltr"
              />
            </div>

            {/* Export & Print Buttons */}
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground invisible">{t.actions}</label>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1"
                  onClick={() => {
                    const exportData = [
                      { date: t.openingBalance, entryNumber: '', description: '', debit: openingBalance >= 0 ? openingBalance : 0, credit: openingBalance < 0 ? Math.abs(openingBalance) : 0, balance: Math.abs(openingBalance) },
                      ...ledgerEntries.map((entry) => ({
                        date: formatDate(entry.date, isRTL),
                        entryNumber: entry.entryNumber,
                        description: entry.description,
                        debit: entry.debit,
                        credit: entry.credit,
                        balance: entry.balance,
                      })),
                    ];
                    exportToExcel({
                      data: exportData,
                      columns: [
                        { key: 'date', header: t.date, width: 14 },
                        { key: 'entryNumber', header: t.entryNumber, width: 12 },
                        { key: 'description', header: t.description, width: 30 },
                        { key: 'debit', header: t.debit, width: 15 },
                        { key: 'credit', header: t.credit_account, width: 15 },
                        { key: 'balance', header: t.balance, width: 15 },
                      ],
                      sheetName: t.ledger,
                      fileName: `ledger-${accountInfo?.code || ''}-${new Date().toISOString().slice(0, 10)}.xlsx`,
                      title: `${t.ledger} - ${accountInfo?.code || ''} ${accountInfo?.name || ''}`,
                    });
                  }}
                  disabled={!selectedAccountId || ledgerEntries.length === 0}
                >
                  <FileSpreadsheet className="h-4 w-4" />
                  {t.exportExcel}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1"
                  onClick={handlePrint}
                  disabled={!selectedAccountId || ledgerEntries.length === 0}
                >
                  <Printer className="h-4 w-4" />
                  {t.print}
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Account Info */}
      {accountInfo && (
        <Card className="no-print">
          <CardContent className="pt-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="col-span-2">
                <span className="text-xs text-muted-foreground">{t.account}</span>
                <div className="mt-1">
                  <AccountCodeBadge code={accountInfo.code} name={accountInfo.name} />
                </div>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">{t.accountType}</span>
                <p className={`font-bold text-lg ${accountTypeColor(accountInfo.type)}`}>
                  {getAccountTypeLabel(accountInfo.type)}
                </p>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">{t.currentBalance}</span>
                <p className="font-mono font-bold text-lg text-primary">
                  <CurrencyAmount amount={accountInfo.currentBalance} symbolClassName="w-3.5 h-3.5" />
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Ledger Table */}
      <Card>
        <CardContent className="p-0">
          {!selectedAccountId ? (
            <div className="p-10 text-center text-muted-foreground">
              <Search className="h-16 w-16 mx-auto mb-4 opacity-30" />
              <p className="text-lg">{t.selectAccountToView}</p>
              <p className="text-sm mt-1">{t.selectAccountFromList}</p>
            </div>
          ) : loading ? (
            <div className="p-6 space-y-3">
              {[...Array(6)].map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : error ? (
            <div className="p-6 text-center">
              <AlertCircle className="h-12 w-12 text-destructive mx-auto mb-3" />
              <p className="text-destructive font-medium">{error}</p>
              <Button variant="outline" className="mt-3" onClick={fetchLedger}>
                {t.retry}
              </Button>
            </div>
          ) : ledgerEntries.length === 0 ? (
            <div className="p-10 text-center text-muted-foreground">
              <BookOpen className="h-16 w-16 mx-auto mb-4 opacity-30" />
              <p className="text-lg">{t.noEntriesForAccount}</p>
              <p className="text-sm mt-1">
                {t.openingBalance}: <CurrencyAmount amount={openingBalance} symbolClassName="w-3.5 h-3.5" />
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">{t.date}</TableHead>
                  <TableHead className="text-right">{t.entryNumber}</TableHead>
                  <TableHead className="text-right">{t.description}</TableHead>
                  <TableHead className="text-right">{t.debit}</TableHead>
                  <TableHead className="text-right">{t.credit_account}</TableHead>
                  <TableHead className="text-right">{t.balance}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {/* Opening Balance Row */}
                <TableRow className="bg-muted/40 font-medium">
                  <TableCell colSpan={3} className="text-center text-muted-foreground">
                    {t.openingBalance}
                  </TableCell>
                  <TableCell className="font-mono text-right">
                    {openingBalance >= 0 ? <CurrencyAmount amount={openingBalance} symbolClassName="w-3.5 h-3.5" /> : ''}
                  </TableCell>
                  <TableCell className="font-mono text-right">
                    {openingBalance < 0 ? <CurrencyAmount amount={Math.abs(openingBalance)} symbolClassName="w-3.5 h-3.5" /> : ''}
                  </TableCell>
                  <TableCell className="font-mono text-right font-bold">
                    <CurrencyAmount amount={Math.abs(openingBalance)} symbolClassName="w-3.5 h-3.5" bold />
                  </TableCell>
                </TableRow>

                {/* Ledger Entries */}
                {ledgerEntries.map((entry) => (
                  <TableRow key={entry.entryNumber}>
                    <TableCell className="text-sm">
                      {formatDate(entry.date, isRTL)}
                    </TableCell>
                    <TableCell>
                      <span className="font-mono text-sm text-primary">
                        {entry.entryNumber}
                      </span>
                    </TableCell>
                    <TableCell className="max-w-[250px] truncate text-sm">
                      {entry.description}
                    </TableCell>
                    <TableCell className="font-mono text-right text-sm">
                      {entry.debit > 0 ? (
                        <span className="text-emerald-700 dark:text-emerald-400">
                          <CurrencyAmount amount={entry.debit} symbolClassName="w-3.5 h-3.5" />
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-right text-sm">
                      {entry.credit > 0 ? (
                        <span className="text-orange-700 dark:text-orange-400">
                          <CurrencyAmount amount={entry.credit} symbolClassName="w-3.5 h-3.5" />
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-right font-bold text-sm">
                      <span
                        className={
                          entry.balance >= 0
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : 'text-red-700 dark:text-red-400'
                        }
                      >
                        <CurrencyAmount amount={Math.abs(entry.balance)} symbolClassName="w-3.5 h-3.5" />
                        {entry.balance < 0 && (
                          <span className="text-xs mr-1">({t.credit_account})</span>
                        )}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>

              {/* Totals Footer */}
              <TableFooter>
                <TableRow className="font-bold">
                  <TableCell colSpan={3} className="text-center">
                    {t.total}
                  </TableCell>
                  <TableCell className="font-mono text-right text-emerald-700 dark:text-emerald-400">
                    <CurrencyAmount amount={totals.totalDebit} symbolClassName="w-3.5 h-3.5" />
                  </TableCell>
                  <TableCell className="font-mono text-right text-orange-700 dark:text-orange-400">
                    <CurrencyAmount amount={totals.totalCredit} symbolClassName="w-3.5 h-3.5" />
                  </TableCell>
                  <TableCell className="font-mono text-right">
                    <span
                      className={
                        totals.lastBalance >= 0
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : 'text-red-700 dark:text-red-400'
                      }
                    >
                      <CurrencyAmount amount={Math.abs(totals.lastBalance)} symbolClassName="w-3.5 h-3.5" />
                      {totals.lastBalance < 0 && (
                        <span className="text-xs mr-1">({t.credit_account})</span>
                      )}
                    </span>
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
