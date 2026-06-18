'use client';

import { useState, useCallback, useEffect, Fragment } from 'react';
import { format } from 'date-fns';
import { arSA } from 'date-fns/locale/ar-SA';
import { enUS } from 'date-fns/locale/en-US';
import {
  ChevronDown,
  ChevronUp,
  Filter,
  Search,
  Edit,
  X,
  Check,
  Send,
  Undo2,
  CalendarIcon,
  Loader2,
  AlertCircle,
  Plus,
  Trash2,
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
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';

import {
  JournalEntryWithLines,
  JournalEntryType,
  EntryStatus,
  AccountWithBalance,
} from '@/lib/types';
import { CurrencyAmount } from '@/components/ui/currency-symbol';
import { exportToExcel } from '@/lib/export-utils';
import { AccountCodeBadge } from '@/components/accounting/account-code-badge';
import { useTranslation } from '@/lib/i18n';

// Currency display uses CurrencyAmount component

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

// Status badge colors
function StatusBadge({ status }: { status: EntryStatus }) {
  const { t } = useTranslation();
  const statusLabelMap: Record<EntryStatus, string> = {
    DRAFT: t.draft,
    POSTED: t.posted,
    CANCELLED: t.cancelled,
    RETURNED: t.returned,
  };
  const label = statusLabelMap[status] || status;
  switch (status) {
    case 'POSTED':
      return (
        <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800">
          {label}
        </Badge>
      );
    case 'DRAFT':
      return (
        <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border-amber-200 dark:border-amber-800">
          {label}
        </Badge>
      );
    case 'CANCELLED':
      return (
        <Badge className="bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300 border-red-200 dark:border-red-800">
          {label}
        </Badge>
      );
    default:
      return <Badge>{label}</Badge>;
  }
}

// Entry type label
function EntryTypeBadge({ type }: { type: JournalEntryType }) {
  const { t } = useTranslation();
  const typeLabelMap: Partial<Record<JournalEntryType, string>> = {
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
  return (
    <Badge variant="outline" className="text-xs font-normal">
      {typeLabelMap[type] || type}
    </Badge>
  );
}

// Edit line type for the edit dialog
let _editLineKeyCounter = 0;

interface EditLine {
  _key: number;
  accountId: string;
  accountCode: string;
  accountName: string;
  debit: number;
  credit: number;
}

export default function GeneralJournal() {
  const { t, isRTL } = useTranslation();

  // Helper: status label
  const getStatusLabel = (status: EntryStatus): string => {
    const map: Record<EntryStatus, string> = {
      DRAFT: t.draft,
      POSTED: t.posted,
      CANCELLED: t.cancelled,
      RETURNED: t.returned,
    };
    return map[status] || status;
  };

  // Helper: entry type label
  const getEntryTypeLabel = (type: JournalEntryType): string => {
    const map: Partial<Record<JournalEntryType, string>> = {
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
    return map[type] || type;
  };

  // Filter state
  const [dateFrom, setDateFrom] = useState<Date | undefined>();
  const [dateTo, setDateTo] = useState<Date | undefined>();
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  // Data state
  const [entries, setEntries] = useState<JournalEntryWithLines[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Expanded rows
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  // Edit dialog state
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<JournalEntryWithLines | null>(null);
  const [editDescription, setEditDescription] = useState('');
  const [editDate, setEditDate] = useState<Date | undefined>();
  const [editLines, setEditLines] = useState<EditLine[]>([]);
  const [saving, setSaving] = useState(false);

  // Accounts for edit dialog
  const [accounts, setAccounts] = useState<AccountWithBalance[]>([]);

  // Action loading
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Fetch journal entries
  const fetchEntries = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'ALL') params.set('status', statusFilter);
      if (typeFilter !== 'ALL') params.set('type', typeFilter);
      if (dateFrom) params.set('dateFrom', dateFrom.toISOString().split('T')[0]);
      if (dateTo) params.set('dateTo', dateTo.toISOString().split('T')[0]);
      params.set('page', String(page));
      params.set('pageSize', String(pageSize));
      if (searchQuery.trim()) params.set('search', searchQuery.trim());

      const res = await fetch(`/api/journal-entries?${params.toString()}`);
      if (!res.ok) throw new Error(t.failedToFetchData);
      const data = await res.json();

      setEntries(data.entries as JournalEntryWithLines[]);
      setTotal(data.total);
    } catch (err: any) {
      setError(err.message || t.errorLoadingData);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, typeFilter, dateFrom, dateTo, page, pageSize, searchQuery, t]);

  // Fetch accounts for edit dialog
  const fetchAccounts = useCallback(async () => {
    try {
      const res = await fetch('/api/accounts');
      if (!res.ok) return;
      const data = await res.json();
      // Flatten tree to list for dropdown
      const flat: AccountWithBalance[] = [];
      const flatten = (nodes: any[]) => {
        for (const node of nodes) {
          flat.push(node);
          if (node.children?.length) flatten(node.children);
        }
      };
      flatten(data);
      setAccounts(flat.filter((a) => a.isActive));
    } catch {
      // Silently fail
    }
  }, []);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  // Toggle expanded row
  const toggleRow = (id: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Handle post entry
  const handlePost = async (id: string) => {
    setActionLoading(id);
    try {
      const res = await fetch(`/api/journal-entries/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'post' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t.failedToPostEntry);
      toast.success(t.entryPostedSuccess);
      fetchEntries();
    } catch (err: any) {
      toast.error(err.message || t.failedToPostEntry);
    } finally {
      setActionLoading(null);
    }
  };

  // Handle unpost entry (return to draft)
  const handleUnpost = async (id: string) => {
    setActionLoading(id);
    try {
      const res = await fetch(`/api/journal-entries/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'unpost' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t.failedToUnpostEntry);
      toast.success(t.entryUnpostedSuccess);
      fetchEntries();
    } catch (err: any) {
      toast.error(err.message || t.failedToUnpostEntry);
    } finally {
      setActionLoading(null);
    }
  };

  // Handle delete entry (draft only)
  const handleDelete = async (id: string) => {
    // Confirm before deleting - journal entries are critical accounting data
    if (!window.confirm(t.confirmDeleteEntry || 'هل أنت متأكد من حذف هذا القيد؟ لا يمكن التراجع عن هذا الإجراء.')) {
      return;
    }
    setActionLoading(id);
    try {
      const res = await fetch(`/api/journal-entries/${id}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t.failedToDeleteEntry);
      toast.success(t.entryDeletedSuccess);
      fetchEntries();
    } catch (err: any) {
      toast.error(err.message || t.failedToDeleteEntry);
    } finally {
      setActionLoading(null);
    }
  };

  // Open edit dialog
  const openEditDialog = (entry: JournalEntryWithLines) => {
    setEditingEntry(entry);
    setEditDescription(entry.description);
    setEditDate(new Date(entry.date));
    setEditLines(
      entry.lines.map((l) => ({
        _key: ++_editLineKeyCounter,
        accountId: l.accountId,
        accountCode: l.accountCode,
        accountName: l.accountName,
        debit: l.debit,
        credit: l.credit,
      }))
    );
    setEditDialogOpen(true);
  };

  // Handle edit line change
  const updateEditLine = (index: number, field: keyof EditLine, value: any) => {
    setEditLines((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      // If account is changed, update code and name
      if (field === 'accountId') {
        const account = accounts.find((a) => a.id === value);
        if (account) {
          next[index].accountCode = account.code;
          next[index].accountName = account.name;
        }
      }
      return next;
    });
  };

  // Add new line
  const addEditLine = () => {
    setEditLines((prev) => [
      ...prev,
      { _key: ++_editLineKeyCounter, accountId: '', accountCode: '', accountName: '', debit: 0, credit: 0 },
    ]);
  };

  // Remove line
  const removeEditLine = (index: number) => {
    setEditLines((prev) => prev.filter((_, i) => i !== index));
  };

  // Save edit
  const saveEdit = async () => {
    if (!editingEntry) return;

    // Validate lines
    const validLines = editLines.filter((l) => l.accountId);
    if (validLines.length < 2) {
      toast.error(t.entryMinLines);
      return;
    }

    const totalDebit = validLines.reduce((s, l) => s + (l.debit || 0), 0);
    const totalCredit = validLines.reduce((s, l) => s + (l.credit || 0), 0);
    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      toast.error(t.entryUnbalancedMsg);
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/journal-entries/${editingEntry.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: editDescription,
          date: editDate?.toISOString(),
          lines: validLines.map((l) => ({
            accountId: l.accountId,
            debit: l.debit || 0,
            credit: l.credit || 0,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t.failedToUpdateEntry);
      toast.success(t.entryUpdatedSuccess);
      setEditDialogOpen(false);
      fetchEntries();
    } catch (err: any) {
      toast.error(err.message || t.failedToUpdateEntry);
    } finally {
      setSaving(false);
    }
  };

  // Pagination
  const totalPages = Math.ceil(total / pageSize);

  // Entry type options for filter
  const entryTypeOptions: { value: string; label: string }[] = (
    Object.keys({
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
      COLLECTION: t.collection,
      PAYMENT: t.payment,
      DEPOSIT: t.deposit,
      WITHDRAWAL: t.withdrawal,
      TRANSFER: t.transfer,
      MANUAL: t.manual,
      OPENING_BALANCE: t.openingBalance,
    }) as JournalEntryType[]
  ).map((key) => ({ value: key, label: getEntryTypeLabel(key) }));

  return (
    <div className="space-y-4">
      {/* Filter Bar */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Filter className="h-5 w-5 text-primary" />
            {t.filterEntries}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
            {/* Date From */}
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">{t.dateFrom}</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className="w-full justify-start text-right font-normal h-9"
                  >
                    <CalendarIcon className="ml-2 h-4 w-4" />
                    {dateFrom ? formatDate(dateFrom.toISOString(), isRTL) : t.selectDate}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={dateFrom}
                    onSelect={setDateFrom}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>

            {/* Date To */}
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">{t.dateTo}</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className="w-full justify-start text-right font-normal h-9"
                  >
                    <CalendarIcon className="ml-2 h-4 w-4" />
                    {dateTo ? formatDate(dateTo.toISOString(), isRTL) : t.selectDate}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={dateTo}
                    onSelect={setDateTo}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>

            {/* Status Filter */}
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">{t.status}</label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">{t.all}</SelectItem>
                  <SelectItem value="DRAFT">{t.draft}</SelectItem>
                  <SelectItem value="POSTED">{t.posted}</SelectItem>
                  <SelectItem value="CANCELLED">{t.cancelled}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Type Filter */}
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">{t.type}</label>
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="w-full h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">{t.all}</SelectItem>
                  {entryTypeOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Search */}
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">{t.search}</label>
              <div className="relative">
                <Search className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={t.entryNumberOrDescription}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pr-8 h-9"
                />
              </div>
            </div>

            {/* Apply Button */}
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground invisible">{t.applyFilter}</label>
              <Button onClick={() => { setPage(1); fetchEntries(); }} className="w-full h-9">
                <Filter className="h-4 w-4 ml-1" />
                {t.applyFilter}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Journal Entries Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center justify-between">
            <span>{t.journal}</span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const exportData = entries.flatMap((entry) =>
                    entry.lines.length > 0
                      ? entry.lines.map((line, idx) => ({
                          entryNumber: entry.entryNumber,
                          date: formatDate(entry.date, isRTL),
                          description: idx === 0 ? entry.description : '',
                          type: idx === 0 ? getEntryTypeLabel(entry.type) : '',
                          status: idx === 0 ? getStatusLabel(entry.status) : '',
                          amount: idx === 0 ? entry.amount : '',
                          accountCode: line.accountCode,
                          accountName: line.accountName,
                          debit: line.debit,
                          credit: line.credit,
                        }))
                      : [{
                          entryNumber: entry.entryNumber,
                          date: formatDate(entry.date, isRTL),
                          description: entry.description,
                          type: getEntryTypeLabel(entry.type),
                          status: getStatusLabel(entry.status),
                          amount: entry.amount,
                          accountCode: '',
                          accountName: '',
                          debit: 0,
                          credit: 0,
                        }]
                  );
                  exportToExcel({
                    data: exportData,
                    columns: [
                      { key: 'entryNumber', header: t.entryNumber, width: 12 },
                      { key: 'date', header: t.date, width: 14 },
                      { key: 'description', header: t.description, width: 30 },
                      { key: 'type', header: t.type, width: 15 },
                      { key: 'status', header: t.status, width: 10 },
                      { key: 'amount', header: t.amount, width: 15 },
                      { key: 'accountCode', header: t.accountCode, width: 12 },
                      { key: 'accountName', header: t.accountName, width: 25 },
                      { key: 'debit', header: t.debit, width: 15 },
                      { key: 'credit', header: t.credit_account, width: 15 },
                    ],
                    sheetName: t.journal,
                    fileName: `journal-${new Date().toISOString().slice(0, 10)}.xlsx`,
                    title: t.journal,
                  });
                }}
                disabled={entries.length === 0}
                className="gap-1"
              >
                <FileSpreadsheet className="h-4 w-4" />
                {t.exportExcel}
              </Button>
              <span className="text-sm font-normal text-muted-foreground">
                {t.total}: {total} {t.entry}
              </span>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6 space-y-3">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : error ? (
            <div className="p-6 text-center">
              <AlertCircle className="h-12 w-12 text-destructive mx-auto mb-3" />
              <p className="text-destructive font-medium">{error}</p>
              <Button variant="outline" className="mt-3" onClick={fetchEntries}>
                {t.retry}
              </Button>
            </div>
          ) : entries.length === 0 ? (
            <div className="p-6 text-center text-muted-foreground">
              <p className="text-lg">{t.noJournalEntries}</p>
              <p className="text-sm mt-1">{t.noEntriesWithFilter}</p>
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8"></TableHead>
                    <TableHead className="text-right">{t.entryNumber}</TableHead>
                    <TableHead className="text-right">{t.transactionNumber}</TableHead>
                    <TableHead className="text-right">{t.date}</TableHead>
                    <TableHead className="text-right">{t.description}</TableHead>
                    <TableHead className="text-right">{t.type}</TableHead>
                    <TableHead className="text-right">{t.amount}</TableHead>
                    <TableHead className="text-right">{t.status}</TableHead>
                    <TableHead className="text-right">{t.actions}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((entry) => {
                    const isExpanded = expandedRows.has(entry.id);
                    return (
                      <Fragment key={entry.id}>
                        <TableRow
                          className="cursor-pointer hover:bg-muted/60"
                          onClick={() => toggleRow(entry.id)}
                        >
                          <TableCell>
                            {isExpanded ? (
                              <ChevronUp className="h-4 w-4 text-muted-foreground" />
                            ) : (
                              <ChevronDown className="h-4 w-4 text-muted-foreground" />
                            )}
                          </TableCell>
                          <TableCell className="font-mono font-medium text-primary">
                            {entry.entryNumber}
                          </TableCell>
                          <TableCell>
                            {entry.transactionNumber ? (
                              <Badge variant="outline" className="text-xs font-mono text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-800">
                                {entry.transactionNumber}
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground text-xs">—</span>
                            )}
                          </TableCell>
                          <TableCell>{formatDate(entry.date, isRTL)}</TableCell>
                          <TableCell className="max-w-[200px] truncate">
                            {entry.description}
                          </TableCell>
                          <TableCell>
                            <EntryTypeBadge type={entry.type} />
                          </TableCell>
                          <TableCell className="font-mono">
                          <CurrencyAmount amount={entry.amount} symbolClassName="w-3.5 h-3.5" />
                          </TableCell>
                          <TableCell>
                            <StatusBadge status={entry.status} />
                          </TableCell>
                          <TableCell>
                            <div
                              className="flex items-center gap-1"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {entry.status === 'DRAFT' && (
                                <>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 px-2 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/30"
                                    disabled={actionLoading === entry.id}
                                    onClick={() => handlePost(entry.id)}
                                    title={t.postEntry}
                                  >
                                    {actionLoading === entry.id ? (
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                      <Send className="h-4 w-4" />
                                    )}
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 px-2 text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/30"
                                    onClick={() => openEditDialog(entry)}
                                    title={t.edit}
                                  >
                                    <Edit className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 px-2 text-red-600 hover:text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30"
                                    disabled={actionLoading === entry.id}
                                    onClick={() => handleDelete(entry.id)}
                                    title={t.delete}
                                  >
                                    {actionLoading === entry.id ? (
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                      <Trash2 className="h-4 w-4" />
                                    )}
                                  </Button>
                                </>
                              )}
                              {entry.status === 'POSTED' && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 px-2 text-amber-600 hover:text-amber-700 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950/30"
                                  disabled={actionLoading === entry.id}
                                  onClick={() => handleUnpost(entry.id)}
                                  title={t.returnToDraft}
                                >
                                  {actionLoading === entry.id ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : (
                                    <Undo2 className="h-4 w-4" />
                                  )}
                                </Button>
                              )}
                              {entry.status === 'CANCELLED' && (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                        {/* Expanded Lines */}
                        {isExpanded && (
                          <TableRow className="bg-muted/30">
                            <TableCell colSpan={9} className="p-0">
                              <div className="px-12 py-3">
                                <Table>
                                  <TableHeader>
                                    <TableRow>
                                      <TableHead className="text-right h-8">
                                        {t.account}
                                      </TableHead>
                                      <TableHead className="text-right h-8">
                                        {t.debit}
                                      </TableHead>
                                      <TableHead className="text-right h-8">
                                        {t.credit_account}
                                      </TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {entry.lines.map((line) => (
                                      <TableRow key={line.id}>
                                        <TableCell className="py-1.5">
                                          <AccountCodeBadge code={line.accountCode} name={line.accountName} />
                                        </TableCell>
                                        <TableCell className="py-1.5 font-mono text-sm">
                                          {line.debit > 0 ? (
                                            <span className="text-emerald-700 dark:text-emerald-400">
                                              <CurrencyAmount amount={line.debit} symbolClassName="w-3.5 h-3.5" />
                                            </span>
                                          ) : (
                                            <span className="text-muted-foreground">—</span>
                                          )}
                                        </TableCell>
                                        <TableCell className="py-1.5 font-mono text-sm">
                                          {line.credit > 0 ? (
                                            <span className="text-orange-700 dark:text-orange-400">
                                              <CurrencyAmount amount={line.credit} symbolClassName="w-3.5 h-3.5" />
                                            </span>
                                          ) : (
                                            <span className="text-muted-foreground">—</span>
                                          )}
                                        </TableCell>
                                      </TableRow>
                                    ))}
                                    {/* Totals row */}
                                    <TableRow className="border-t-2 border-primary/20">
                                      <TableCell className="py-1.5 font-bold text-sm">
                                        {t.total}
                                      </TableCell>
                                      <TableCell className="py-1.5 font-mono font-bold text-sm text-emerald-700 dark:text-emerald-400">
                                        <CurrencyAmount amount={entry.lines.reduce((s, l) => s + l.debit, 0)} symbolClassName="w-3.5 h-3.5" />
                                      </TableCell>
                                      <TableCell className="py-1.5 font-mono font-bold text-sm text-orange-700 dark:text-orange-400">
                                        <CurrencyAmount amount={entry.lines.reduce((s, l) => s + l.credit, 0)} symbolClassName="w-3.5 h-3.5" />
                                      </TableCell>
                                    </TableRow>
                                  </TableBody>
                                </Table>
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t">
                  <span className="text-sm text-muted-foreground">
                    {t.page} {page} {t.of} {totalPages}
                  </span>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page <= 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                    >
                      {t.previous}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page >= totalPages}
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    >
                      {t.next}
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Edit Entry Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Edit className="h-5 w-5 text-primary" />
              {t.editEntry} {editingEntry?.entryNumber}
            </DialogTitle>
            <DialogDescription>
              {t.editEntryDesc}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Description */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">{t.description}</label>
                <Input
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  placeholder={t.entryDescription}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{t.date}</label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className="w-full justify-start text-right font-normal"
                    >
                      <CalendarIcon className="ml-2 h-4 w-4" />
                      {editDate ? formatDate(editDate.toISOString(), isRTL) : t.selectDate}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={editDate}
                      onSelect={setEditDate}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            {/* Lines */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">{t.journalLines}</label>
                <Button variant="outline" size="sm" onClick={addEditLine}>
                  <Plus className="h-4 w-4 ml-1" />
                  {t.addLine}
                </Button>
              </div>

              <div className="border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-right">{t.account}</TableHead>
                      <TableHead className="text-right w-36">{t.debit}</TableHead>
                      <TableHead className="text-right w-36">{t.credit_account}</TableHead>
                      <TableHead className="w-10"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {editLines.map((line, idx) => (
                      <TableRow key={line._key}>
                        <TableCell>
                          <Select
                            value={line.accountId}
                            onValueChange={(val) =>
                              updateEditLine(idx, 'accountId', val)
                            }
                          >
                            <SelectTrigger className="h-8 text-sm">
                              <SelectValue placeholder={t.selectAccount} />
                            </SelectTrigger>
                            <SelectContent>
                              {accounts
                                .filter((a) => a.level > 1)
                                .map((acc) => (
                                  <SelectItem key={acc.id} value={acc.id}>
                                    <span className="inline-flex items-center gap-1.5">
                                      <span className="inline-flex items-center px-1 py-0 rounded text-[9px] font-mono font-medium bg-muted text-muted-foreground" dir="ltr">
                                        {acc.code}
                                      </span>
                                      <span>{acc.name}</span>
                                    </span>
                                  </SelectItem>
                                ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            className="h-8 text-sm font-mono"
                            value={line.debit || ''}
                            onChange={(e) =>
                              updateEditLine(
                                idx,
                                'debit',
                                parseFloat(e.target.value) || 0
                              )
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            className="h-8 text-sm font-mono"
                            value={line.credit || ''}
                            onChange={(e) =>
                              updateEditLine(
                                idx,
                                'credit',
                                parseFloat(e.target.value) || 0
                              )
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                            onClick={() => removeEditLine(idx)}
                            disabled={editLines.length <= 2}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Balance indicator */}
              <div
                className={`flex items-center justify-between p-2 rounded-md text-sm ${
                  Math.abs(
                    editLines.reduce((s, l) => s + (l.debit || 0), 0) -
                      editLines.reduce((s, l) => s + (l.credit || 0), 0)
                  ) < 0.01
                    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300'
                    : 'bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300'
                }`}
              >
                <span>{t.debit}: <CurrencyAmount amount={editLines.reduce((s, l) => s + (l.debit || 0), 0)} symbolClassName="w-3.5 h-3.5" /></span>
                <span>
                  {Math.abs(
                    editLines.reduce((s, l) => s + (l.debit || 0), 0) -
                      editLines.reduce((s, l) => s + (l.credit || 0), 0)
                  ) < 0.01 ? (
                    <span className="flex items-center gap-1">
                      <Check className="h-4 w-4" /> {t.balanced}
                    </span>
                  ) : (
                    <span className="flex items-center gap-1">
                      <X className="h-4 w-4" /> {t.unbalanced} ({t.difference}:{' '}
                      <CurrencyAmount amount={Math.abs(
                        editLines.reduce((s, l) => s + (l.debit || 0), 0) -
                          editLines.reduce((s, l) => s + (l.credit || 0), 0)
                      )} symbolClassName="w-3.5 h-3.5" />
                      )
                    </span>
                  )}
                </span>
                <span>{t.credit_account}: <CurrencyAmount amount={editLines.reduce((s, l) => s + (l.credit || 0), 0)} symbolClassName="w-3.5 h-3.5" /></span>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditDialogOpen(false)}
              disabled={saving}
            >
              {t.cancel}
            </Button>
            <Button onClick={saveEdit} disabled={saving}>
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin ml-1" />
              ) : (
                <Check className="h-4 w-4 ml-1" />
              )}
              {t.saveChanges}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
