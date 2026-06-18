'use client';

import { useState, useEffect, useCallback, Fragment } from 'react';
import {
  Plus,
  Pencil,
  Trash2,
  Search,
  RefreshCw,
  Users,
  Loader2,
  DollarSign,
  FileSpreadsheet,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CUSTOMER_TYPE_LABELS, formatNumber } from '@/lib/types';
import { useTranslation } from '@/lib/i18n';
import { CurrencyAmount } from '@/components/ui/currency-symbol';
import { exportToExcel } from '@/lib/export-utils';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Customer {
  id: string;
  name: string;
  nameEn?: string;
  type: string;
  phone?: string;
  email?: string;
  balance: number;
  discountPercentage: number;
  totalSales?: number;
  totalCollections?: number;
  totalArDebit?: number;
  totalArCredit?: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// ─── Form Data ───────────────────────────────────────────────────────────────

interface CustomerFormData {
  name: string;
  nameEn: string;
  type: string;
  phone: string;
  email: string;
  discountPercentage: string;
}

const emptyForm: CustomerFormData = {
  name: '',
  nameEn: '',
  type: 'PLATFORM',
  phone: '',
  email: '',
  discountPercentage: '',
};

// ─── Type Badge Colors ───────────────────────────────────────────────────────

const CUSTOMER_TYPE_COLORS: Record<string, string> = {
  PLATFORM: 'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300',
  CASH: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  WALK_IN: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
};

// ─── Balance Display Helper ──────────────────────────────────────────────────

function BalanceCell({ balance, t }: { balance: number; t: any }) {
  if (balance > 0) {
    return (
      <span className="inline-flex items-center gap-1.5 font-medium text-orange-600 dark:text-orange-400" dir="ltr">
        <CurrencyAmount amount={balance} symbolClassName="w-3.5 h-3.5" />
        <Badge variant="outline" className="text-[9px] px-1 py-0 border-orange-300 text-orange-600 dark:border-orange-700 dark:text-orange-400">
          {t.customerReceivables}
        </Badge>
      </span>
    );
  }
  if (balance < 0) {
    return (
      <span className="font-medium text-red-600 dark:text-red-400" dir="ltr">
        <CurrencyAmount amount={balance} symbolClassName="w-3.5 h-3.5" />
      </span>
    );
  }
  return (
    <span className="font-medium text-emerald-600 dark:text-emerald-400">
      —
    </span>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function Customers() {
  const { t, isRTL, locale } = useTranslation();

  // Local helper for customer type labels
  const customerTypeLabels: Record<string, string> = {
    PLATFORM: t.platform,
    CASH: t.cashCustomer,
    WALK_IN: t.cashCustomer,
  };

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [formData, setFormData] = useState<CustomerFormData>(emptyForm);
  const [saving, setSaving] = useState(false);

  // Delete confirmation
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingCustomer, setDeletingCustomer] = useState<Customer | null>(null);
  const [deleting, setDeleting] = useState(false);

  // ─── Fetch Customers ─────────────────────────────────────────────────────

  const fetchCustomers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/customers');
      if (!res.ok) throw new Error(t.failedToFetchCategories);
      const data = await res.json();
      setCustomers(data.customers || []);
    } catch {
      toast.error(t.failedToFetchCategories);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCustomers();
  }, [fetchCustomers]);

  // ─── Toggle Expanded Row ─────────────────────────────────────────────────

  const toggleRow = (id: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // ─── Open Add Dialog ─────────────────────────────────────────────────────

  const openAddDialog = () => {
    setEditingCustomer(null);
    setFormData(emptyForm);
    setDialogOpen(true);
  };

  // ─── Open Edit Dialog ────────────────────────────────────────────────────

  const openEditDialog = (customer: Customer) => {
    setEditingCustomer(customer);
    setFormData({
      name: customer.name,
      nameEn: customer.nameEn || '',
      type: customer.type,
      phone: customer.phone || '',
      email: customer.email || '',
      discountPercentage: String(customer.discountPercentage || ''),
    });
    setDialogOpen(true);
  };

  // ─── Save Customer (Add/Edit) ────────────────────────────────────────────

  const handleSave = async () => {
    if (!formData.name.trim()) {
      toast.error(t.customerName);
      return;
    }

    setSaving(true);
    try {
      if (editingCustomer) {
        const res = await fetch(`/api/customers/${editingCustomer.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: formData.name.trim(),
            nameEn: formData.nameEn.trim() || null,
            type: formData.type,
            phone: formData.phone.trim() || null,
            email: formData.email.trim() || null,
            discountPercentage: formData.discountPercentage ? parseFloat(formData.discountPercentage) : 0,
          }),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || t.failedToUpdateCustomer);
        }
        toast.success(t.customerUpdated);
      } else {
        const res = await fetch('/api/customers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: formData.name.trim(),
            nameEn: formData.nameEn.trim() || null,
            type: formData.type,
            phone: formData.phone.trim() || null,
            email: formData.email.trim() || null,
            discountPercentage: formData.discountPercentage ? parseFloat(formData.discountPercentage) : 0,
          }),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || t.failedToAddCustomer);
        }
        toast.success(t.customerAdded);
      }
      setDialogOpen(false);
      fetchCustomers();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t.failedToUpdateCustomer);
    } finally {
      setSaving(false);
    }
  };

  // ─── Delete Customer ─────────────────────────────────────────────────────

  const handleDelete = async () => {
    if (!deletingCustomer) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/customers/${deletingCustomer.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || t.failedToDeleteCustomer);
      }
      toast.success(t.customerDeleted);
      setDeleteDialogOpen(false);
      setDeletingCustomer(null);
      fetchCustomers();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t.failedToDeleteCustomer);
    } finally {
      setDeleting(false);
    }
  };

  // ─── Filter Customers ────────────────────────────────────────────────────

  const filteredCustomers = customers.filter((customer) => {
    if (!searchQuery) return true;
    const lower = searchQuery.toLowerCase();
    return (
      customer.name.toLowerCase().includes(lower) ||
      (customer.nameEn && customer.nameEn.toLowerCase().includes(lower)) ||
      (customer.phone && customer.phone.includes(searchQuery)) ||
      (customer.email && customer.email.toLowerCase().includes(lower)) ||
      (customerTypeLabels[customer.type] || '').includes(lower)
    );
  });

  // ─── Summary totals ──────────────────────────────────────────────────────

  const totalBalance = customers.reduce((sum, c) => sum + c.balance, 0);
  const totalSalesAmount = customers.reduce((sum, c) => sum + (c.totalSales || 0), 0);
  const totalCollectionsAmount = customers.reduce((sum, c) => sum + (c.totalCollections || 0), 0);

  // ─── Render ──────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <span className="mr-3 text-muted-foreground">{t.loading}</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Header Bar ──────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-primary" />
          <h2 className="text-xl font-bold text-foreground">{t.customerManagement}</h2>
          <Badge variant="outline" className="text-[11px]">
            {formatNumber(customers.length, 0)} {t.customers}
          </Badge>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:mr-auto">
          <Button onClick={openAddDialog} size="sm">
            <Plus className="h-4 w-4 ml-1" />
            {t.addCustomer}
          </Button>

          <Button
            onClick={() => {
              exportToExcel({
                data: filteredCustomers.map((c) => ({
                  name: c.name,
                  nameEn: c.nameEn || '',
                  type: customerTypeLabels[c.type] || c.type,
                  discountPercentage: c.discountPercentage || 0,
                  phone: c.phone || '',
                  email: c.email || '',
                  totalSales: c.totalSales || 0,
                  totalCollections: c.totalCollections || 0,
                  balance: c.balance,
                })),
                columns: [
                  { key: 'name', header: t.customerName, width: 20 },
                  { key: 'nameEn', header: t.customerNameEn, width: 20 },
                  { key: 'type', header: t.type, width: 12 },
                  { key: 'discountPercentage', header: t.customerDiscount, width: 14 },
                  { key: 'phone', header: t.customerPhone, width: 15 },
                  { key: 'email', header: t.customerEmail, width: 20 },
                  { key: 'totalSales', header: t.totalRevenue, width: 15 },
                  { key: 'totalCollections', header: t.collection, width: 15 },
                  { key: 'balance', header: t.customerReceivables, width: 15 },
                ],
                sheetName: t.customers,
                fileName: `${t.customers}-${new Date().toISOString().slice(0, 10)}.xlsx`,
                title: t.customerManagement,
              });
            }}
            variant="outline"
            size="sm"
            className="gap-1"
            disabled={customers.length === 0}
          >
            <FileSpreadsheet className="h-4 w-4" />
            {t.export} Excel
          </Button>

          <Button
            onClick={fetchCustomers}
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            aria-label={t.refresh}
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>

        {/* Search */}
        <div className="relative w-full sm:w-64">
          <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t.search + '...'}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pr-9 h-9"
          />
        </div>
      </div>

      {/* ── Summary Cards ───────────────────────────────────────────────── */}
      {customers.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Card className="border-orange-200 dark:border-orange-800/40">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-orange-100 dark:bg-orange-900/30">
                  <DollarSign className="h-5 w-5 text-orange-600 dark:text-orange-400" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{t.customerReceivables}</p>
                  <p className="text-xl font-bold text-orange-600 dark:text-orange-400" dir="ltr">
                    <CurrencyAmount amount={totalBalance} symbolClassName="w-3.5 h-3.5" />
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-emerald-200 dark:border-emerald-800/40">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-emerald-100 dark:bg-emerald-900/30">
                  <DollarSign className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{t.totalRevenue}</p>
                  <p className="text-xl font-bold text-emerald-600 dark:text-emerald-400" dir="ltr">
                    <CurrencyAmount amount={totalSalesAmount} symbolClassName="w-3.5 h-3.5" />
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-teal-200 dark:border-teal-800/40">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-teal-100 dark:bg-teal-900/30">
                  <DollarSign className="h-5 w-5 text-teal-600 dark:text-teal-400" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{t.collection}</p>
                  <p className="text-xl font-bold text-teal-600 dark:text-teal-400" dir="ltr">
                    <CurrencyAmount amount={totalCollectionsAmount} symbolClassName="w-3.5 h-3.5" />
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Empty State ─────────────────────────────────────────────────── */}
      {customers.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Users className="h-16 w-16 text-muted-foreground/30 mb-4" />
            <h3 className="text-lg font-semibold text-foreground mb-2">
              {t.noCustomers}
            </h3>
            <p className="text-sm text-muted-foreground mb-6 text-center max-w-md">
              {t.addCustomer}
            </p>
            <Button onClick={openAddDialog}>
              <Plus className="h-4 w-4 ml-1" />
              {t.addCustomer}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ── Customers Table ─────────────────────────────────────────────── */}
      {customers.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <div className="max-h-[calc(100vh-280px)] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead className="text-right">{t.customerName}</TableHead>
                    <TableHead className="text-right hidden sm:table-cell">{t.customerNameEn}</TableHead>
                    <TableHead className="text-right">{t.type}</TableHead>
                    <TableHead className="text-right hidden md:table-cell">{t.customerDiscount}</TableHead>
                    <TableHead className="text-right hidden md:table-cell">{t.customerPhone}</TableHead>
                    <TableHead className="text-right hidden md:table-cell">{t.customerEmail}</TableHead>
                    <TableHead className="text-right">{t.customerReceivables}</TableHead>
                    <TableHead className="text-center">{t.actions}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredCustomers.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                        {t.noData}
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredCustomers.map((customer) => {
                      const isExpanded = expandedRows.has(customer.id);
                      const hasDetails = (customer.totalSales || 0) > 0 || (customer.totalCollections || 0) > 0;
                      return (
                        <Fragment key={customer.id}>
                          <TableRow
                            className={`cursor-pointer hover:bg-muted/60 ${!customer.isActive ? 'opacity-50' : ''}`}
                            onClick={() => hasDetails && toggleRow(customer.id)}
                          >
                            <TableCell>
                              {hasDetails ? (
                                isExpanded ? (
                                  <ChevronUp className="h-4 w-4 text-muted-foreground" />
                                ) : (
                                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                )
                              ) : (
                                <span className="w-4 h-4 inline-block" />
                              )}
                            </TableCell>
                            <TableCell className="font-medium">{customer.name}</TableCell>
                            <TableCell className="text-muted-foreground hidden sm:table-cell" dir="ltr">
                              {customer.nameEn || '—'}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant="outline"
                                className={`text-[10px] px-1.5 py-0 ${
                                  CUSTOMER_TYPE_COLORS[customer.type] || ''
                                }`}
                              >
                                {customerTypeLabels[customer.type] || customer.type}
                              </Badge>
                            </TableCell>
                            <TableCell className="hidden md:table-cell text-center">
                              {customer.discountPercentage > 0 ? `${customer.discountPercentage}%` : '—'}
                            </TableCell>
                            <TableCell className="hidden md:table-cell" dir="ltr">{customer.phone || '—'}</TableCell>
                            <TableCell className="hidden md:table-cell" dir="ltr">{customer.email || '—'}</TableCell>
                            <TableCell>
                              <BalanceCell balance={customer.balance} t={t} />
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center justify-center gap-1" onClick={(e) => e.stopPropagation()}>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7"
                                  onClick={() => openEditDialog(customer)}
                                  aria-label={t.edit}
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 text-destructive hover:text-destructive"
                                  onClick={() => {
                                    setDeletingCustomer(customer);
                                    setDeleteDialogOpen(true);
                                  }}
                                  aria-label={t.delete}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                          {/* Expanded Details Row */}
                          {isExpanded && hasDetails && (
                            <TableRow className="bg-muted/30">
                              <TableCell colSpan={9} className="p-0">
                                <div className="px-12 py-3">
                                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                                    <div className="space-y-1">
                                      <p className="text-xs text-muted-foreground">{t.totalRevenue}</p>
                                      <p className="text-sm font-mono font-semibold text-emerald-700 dark:text-emerald-400" dir="ltr">
                                        <CurrencyAmount amount={customer.totalSales || 0} symbolClassName="w-3.5 h-3.5" />
                                      </p>
                                    </div>
                                    <div className="space-y-1">
                                      <p className="text-xs text-muted-foreground">{t.collection}</p>
                                      <p className="text-sm font-mono font-semibold text-teal-700 dark:text-teal-400" dir="ltr">
                                        <CurrencyAmount amount={customer.totalCollections || 0} symbolClassName="w-3.5 h-3.5" />
                                      </p>
                                    </div>
                                    <div className="space-y-1">
                                      <p className="text-xs text-muted-foreground">{t.debit}</p>
                                      <p className="text-sm font-mono font-semibold" dir="ltr">
                                        <CurrencyAmount amount={customer.totalArDebit || 0} symbolClassName="w-3.5 h-3.5" />
                                      </p>
                                    </div>
                                    <div className="space-y-1">
                                      <p className="text-xs text-muted-foreground">{t.credit_account}</p>
                                      <p className="text-sm font-mono font-semibold" dir="ltr">
                                        <CurrencyAmount amount={customer.totalArCredit || 0} symbolClassName="w-3.5 h-3.5" />
                                      </p>
                                    </div>
                                  </div>
                                  <div className="mt-3 pt-3 border-t flex items-center justify-between">
                                    <span className="text-xs text-muted-foreground">{t.customerBalance} = {t.debit} - {t.credit_account}</span>
                                    <span
                                      className={`text-sm font-mono font-bold ${
                                        customer.balance > 0
                                          ? 'text-orange-600 dark:text-orange-400'
                                          : customer.balance < 0
                                            ? 'text-red-600 dark:text-red-400'
                                            : 'text-emerald-600 dark:text-emerald-400'
                                      }`}
                                      dir="ltr"
                                    >
                                      <CurrencyAmount amount={customer.balance} symbolClassName="w-3.5 h-3.5" />
                                    </span>
                                  </div>
                                </div>
                              </TableCell>
                            </TableRow>
                          )}
                        </Fragment>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Add/Edit Customer Dialog ────────────────────────────────────── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingCustomer ? t.editCustomer : t.addCustomer}
            </DialogTitle>
            <DialogDescription>
              {editingCustomer
                ? t.editCustomer
                : t.addCustomer}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            {/* Name & NameEn */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="name">{t.customerName} *</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder={t.customerName}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="nameEn">{t.customerNameEn}</Label>
                <Input
                  id="nameEn"
                  value={formData.nameEn}
                  onChange={(e) => setFormData({ ...formData, nameEn: e.target.value })}
                  placeholder="Customer Name"
                  dir="ltr"
                />
              </div>
            </div>

            {/* Type */}
            <div className="space-y-2">
              <Label>{t.customerType}</Label>
              <Select
                value={formData.type}
                onValueChange={(val) => setFormData({ ...formData, type: val })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PLATFORM">{t.platform}</SelectItem>
                  <SelectItem value="CASH">{t.cashCustomer}</SelectItem>
                  <SelectItem value="WALK_IN">{t.cashCustomer}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Discount Percentage */}
            <div className="space-y-2">
              <Label htmlFor="discountPercentage">{t.customerDiscount}</Label>
              <Input
                id="discountPercentage"
                type="number"
                min="0"
                max="100"
                step="0.5"
                placeholder="0"
                value={formData.discountPercentage}
                onChange={(e) => setFormData({ ...formData, discountPercentage: e.target.value })}
                dir="ltr"
              />
            </div>

            {/* Phone & Email */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="phone">{t.customerPhone}</Label>
                <Input
                  id="phone"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  placeholder="05XXXXXXXX"
                  dir="ltr"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">{t.customerEmail}</Label>
                <Input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  placeholder="email@example.com"
                  dir="ltr"
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={saving}
            >
              {t.cancel}
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 ml-1 animate-spin" />
                  {t.loading}
                </>
              ) : editingCustomer ? (
                t.update
              ) : (
                t.create
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirmation Dialog ──────────────────────────────────── */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t.confirm}</DialogTitle>
            <DialogDescription>
              {t.deleteCustomer}{' '}
              <span className="font-bold text-foreground">
                {deletingCustomer?.name}
              </span>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDeleteDialogOpen(false);
                setDeletingCustomer(null);
              }}
              disabled={deleting}
            >
              {t.cancel}
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? (
                <>
                  <Loader2 className="h-4 w-4 ml-1 animate-spin" />
                  {t.loading}
                </>
              ) : (
                t.delete
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
