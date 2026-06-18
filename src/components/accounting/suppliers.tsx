'use client';

import { useState, useEffect, useCallback, Fragment } from 'react';
import {
  Plus,
  Pencil,
  Trash2,
  Search,
  RefreshCw,
  Truck,
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

import { formatNumber } from '@/lib/types';
import { useTranslation } from '@/lib/i18n';
import { CurrencyAmount } from '@/components/ui/currency-symbol';
import { exportToExcel } from '@/lib/export-utils';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Supplier {
  id: string;
  name: string;
  nameEn?: string;
  phone?: string;
  email?: string;
  balance: number;
  totalPurchases?: number;
  totalPayments?: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// ─── Form Data ───────────────────────────────────────────────────────────────

interface SupplierFormData {
  name: string;
  nameEn: string;
  phone: string;
  email: string;
}

const emptyForm: SupplierFormData = {
  name: '',
  nameEn: '',
  phone: '',
  email: '',
};

// ─── Balance Display Helper ──────────────────────────────────────────────────

function BalanceCell({ balance, t }: { balance: number; t: any }) {
  if (balance > 0) {
    return (
      <span className="inline-flex items-center gap-1.5 font-medium text-orange-600 dark:text-orange-400" dir="ltr">
        <CurrencyAmount amount={balance} symbolClassName="w-3.5 h-3.5" />
        <Badge variant="outline" className="text-[9px] px-1 py-0 border-orange-300 text-orange-600 dark:border-orange-700 dark:text-orange-400">
          {t.supplierPayables}
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

export default function Suppliers() {
  const { t, isRTL, locale } = useTranslation();

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [formData, setFormData] = useState<SupplierFormData>(emptyForm);
  const [saving, setSaving] = useState(false);

  // Delete confirmation
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingSupplier, setDeletingSupplier] = useState<Supplier | null>(null);
  const [deleting, setDeleting] = useState(false);

  // ─── Fetch Suppliers ─────────────────────────────────────────────────────

  const fetchSuppliers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/suppliers');
      if (!res.ok) throw new Error(t.failedToFetchCategories);
      const data: Supplier[] = await res.json();
      setSuppliers(data);
    } catch {
      toast.error(t.failedToFetchCategories);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSuppliers();
  }, [fetchSuppliers]);

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
    setEditingSupplier(null);
    setFormData(emptyForm);
    setDialogOpen(true);
  };

  // ─── Open Edit Dialog ────────────────────────────────────────────────────

  const openEditDialog = (supplier: Supplier) => {
    setEditingSupplier(supplier);
    setFormData({
      name: supplier.name,
      nameEn: supplier.nameEn || '',
      phone: supplier.phone || '',
      email: supplier.email || '',
    });
    setDialogOpen(true);
  };

  // ─── Save Supplier (Add/Edit) ────────────────────────────────────────────

  const handleSave = async () => {
    if (!formData.name.trim()) {
      toast.error(t.supplierName);
      return;
    }

    setSaving(true);
    try {
      if (editingSupplier) {
        const res = await fetch(`/api/suppliers/${editingSupplier.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: formData.name.trim(),
            nameEn: formData.nameEn.trim() || null,
            phone: formData.phone.trim() || null,
            email: formData.email.trim() || null,
          }),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || t.failedToUpdateSupplier);
        }
        toast.success(t.supplierUpdated);
      } else {
        const res = await fetch('/api/suppliers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: formData.name.trim(),
            nameEn: formData.nameEn.trim() || null,
            phone: formData.phone.trim() || null,
            email: formData.email.trim() || null,
          }),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || t.failedToAddSupplier);
        }
        toast.success(t.supplierAdded);
      }
      setDialogOpen(false);
      fetchSuppliers();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t.failedToUpdateSupplier);
    } finally {
      setSaving(false);
    }
  };

  // ─── Delete Supplier ─────────────────────────────────────────────────────

  const handleDelete = async () => {
    if (!deletingSupplier) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/suppliers/${deletingSupplier.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || t.failedToDeleteSupplier);
      }
      toast.success(t.supplierDeleted);
      setDeleteDialogOpen(false);
      setDeletingSupplier(null);
      fetchSuppliers();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t.failedToDeleteSupplier);
    } finally {
      setDeleting(false);
    }
  };

  // ─── Filter Suppliers ────────────────────────────────────────────────────

  const filteredSuppliers = suppliers.filter((supplier) => {
    if (!searchQuery) return true;
    const lower = searchQuery.toLowerCase();
    return (
      supplier.name.toLowerCase().includes(lower) ||
      (supplier.nameEn && supplier.nameEn.toLowerCase().includes(lower)) ||
      (supplier.phone && supplier.phone.includes(searchQuery)) ||
      (supplier.email && supplier.email.toLowerCase().includes(lower))
    );
  });

  // ─── Summary totals ──────────────────────────────────────────────────────

  const totalBalance = suppliers.reduce((sum, s) => sum + s.balance, 0);
  const totalPurchasesAmount = suppliers.reduce((sum, s) => sum + (s.totalPurchases || 0), 0);
  const totalPaymentsAmount = suppliers.reduce((sum, s) => sum + (s.totalPayments || 0), 0);

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
          <Truck className="h-5 w-5 text-primary" />
          <h2 className="text-xl font-bold text-foreground">{t.supplierManagement}</h2>
          <Badge variant="outline" className="text-[11px]">
            {formatNumber(suppliers.length, 0)}
          </Badge>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:mr-auto">
          <Button onClick={openAddDialog} size="sm">
            <Plus className="h-4 w-4 ml-1" />
            {t.addSupplier}
          </Button>

          <Button
            onClick={() => {
              exportToExcel({
                data: filteredSuppliers.map((s) => ({
                  name: s.name,
                  nameEn: s.nameEn || '',
                  phone: s.phone || '',
                  email: s.email || '',
                  totalPurchases: s.totalPurchases || 0,
                  totalPayments: s.totalPayments || 0,
                  balance: s.balance,
                })),
                columns: [
                  { key: 'name', header: t.supplierName, width: 20 },
                  { key: 'nameEn', header: t.supplierNameEn, width: 20 },
                  { key: 'phone', header: t.supplierPhone, width: 15 },
                  { key: 'email', header: t.supplierEmail, width: 20 },
                  { key: 'totalPurchases', header: t.purchase, width: 15 },
                  { key: 'totalPayments', header: t.payment, width: 15 },
                  { key: 'balance', header: t.supplierPayables, width: 15 },
                ],
                sheetName: t.suppliers,
                fileName: `${t.suppliers}-${new Date().toISOString().slice(0, 10)}.xlsx`,
                title: t.supplierManagement,
              });
            }}
            variant="outline"
            size="sm"
            className="gap-1"
            disabled={suppliers.length === 0}
          >
            <FileSpreadsheet className="h-4 w-4" />
            {t.export} Excel
          </Button>

          <Button
            onClick={fetchSuppliers}
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
      {suppliers.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Card className="border-orange-200 dark:border-orange-800/40">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-orange-100 dark:bg-orange-900/30">
                  <DollarSign className="h-5 w-5 text-orange-600 dark:text-orange-400" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{t.supplierPayables}</p>
                  <p className="text-xl font-bold text-orange-600 dark:text-orange-400" dir="ltr">
                    <CurrencyAmount amount={totalBalance} symbolClassName="w-3.5 h-3.5" />
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-amber-200 dark:border-amber-800/40">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-amber-100 dark:bg-amber-900/30">
                  <DollarSign className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{t.totalExpenses}</p>
                  <p className="text-xl font-bold text-amber-600 dark:text-amber-400" dir="ltr">
                    <CurrencyAmount amount={totalPurchasesAmount} symbolClassName="w-3.5 h-3.5" />
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
                  <p className="text-sm text-muted-foreground">{t.payment}</p>
                  <p className="text-xl font-bold text-teal-600 dark:text-teal-400" dir="ltr">
                    <CurrencyAmount amount={totalPaymentsAmount} symbolClassName="w-3.5 h-3.5" />
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Empty State ─────────────────────────────────────────────────── */}
      {suppliers.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Truck className="h-16 w-16 text-muted-foreground/30 mb-4" />
            <h3 className="text-lg font-semibold text-foreground mb-2">
              {t.noSuppliers}
            </h3>
            <p className="text-sm text-muted-foreground mb-6 text-center max-w-md">
              {t.addSupplier}
            </p>
            <Button onClick={openAddDialog}>
              <Plus className="h-4 w-4 ml-1" />
              {t.addSupplier}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ── Suppliers Table ─────────────────────────────────────────────── */}
      {suppliers.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <div className="max-h-[calc(100vh-280px)] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead className="text-right">{t.supplierName}</TableHead>
                    <TableHead className="text-right hidden sm:table-cell">{t.supplierNameEn}</TableHead>
                    <TableHead className="text-right hidden md:table-cell">{t.supplierPhone}</TableHead>
                    <TableHead className="text-right hidden md:table-cell">{t.supplierEmail}</TableHead>
                    <TableHead className="text-right">{t.supplierPayables}</TableHead>
                    <TableHead className="text-center">{t.actions}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredSuppliers.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                        {t.noData}
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredSuppliers.map((supplier) => {
                      const isExpanded = expandedRows.has(supplier.id);
                      const hasDetails = (supplier.totalPurchases || 0) > 0 || (supplier.totalPayments || 0) > 0;
                      return (
                        <Fragment key={supplier.id}>
                          <TableRow
                            className={`cursor-pointer hover:bg-muted/60 ${!supplier.isActive ? 'opacity-50' : ''}`}
                            onClick={() => hasDetails && toggleRow(supplier.id)}
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
                            <TableCell className="font-medium">{supplier.name}</TableCell>
                            <TableCell className="text-muted-foreground hidden sm:table-cell" dir="ltr">
                              {supplier.nameEn || '—'}
                            </TableCell>
                            <TableCell className="hidden md:table-cell" dir="ltr">{supplier.phone || '—'}</TableCell>
                            <TableCell className="hidden md:table-cell" dir="ltr">{supplier.email || '—'}</TableCell>
                            <TableCell>
                              <BalanceCell balance={supplier.balance} t={t} />
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center justify-center gap-1" onClick={(e) => e.stopPropagation()}>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7"
                                  onClick={() => openEditDialog(supplier)}
                                  aria-label={t.edit}
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 text-destructive hover:text-destructive"
                                  onClick={() => {
                                    setDeletingSupplier(supplier);
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
                              <TableCell colSpan={7} className="p-0">
                                <div className="px-12 py-3">
                                  <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-1">
                                      <p className="text-xs text-muted-foreground">{t.purchase}</p>
                                      <p className="text-sm font-mono font-semibold text-amber-700 dark:text-amber-400" dir="ltr">
                                        <CurrencyAmount amount={supplier.totalPurchases || 0} symbolClassName="w-3.5 h-3.5" />
                                      </p>
                                    </div>
                                    <div className="space-y-1">
                                      <p className="text-xs text-muted-foreground">{t.payment}</p>
                                      <p className="text-sm font-mono font-semibold text-teal-700 dark:text-teal-400" dir="ltr">
                                        <CurrencyAmount amount={supplier.totalPayments || 0} symbolClassName="w-3.5 h-3.5" />
                                      </p>
                                    </div>
                                  </div>
                                  <div className="mt-3 pt-3 border-t flex items-center justify-between">
                                    <span className="text-xs text-muted-foreground">{t.supplierBalance} = {t.purchase} - {t.payment}</span>
                                    <span
                                      className={`text-sm font-mono font-bold ${
                                        supplier.balance > 0
                                          ? 'text-orange-600 dark:text-orange-400'
                                          : supplier.balance < 0
                                            ? 'text-red-600 dark:text-red-400'
                                            : 'text-emerald-600 dark:text-emerald-400'
                                      }`}
                                      dir="ltr"
                                    >
                                      <CurrencyAmount amount={supplier.balance} symbolClassName="w-3.5 h-3.5" />
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

      {/* ── Add/Edit Supplier Dialog ────────────────────────────────────── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingSupplier ? t.editSupplier : t.addSupplier}
            </DialogTitle>
            <DialogDescription>
              {editingSupplier
                ? t.editSupplier
                : t.addSupplier}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            {/* Name & NameEn */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="name">{t.supplierName} *</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder={t.supplierName}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="nameEn">{t.supplierNameEn}</Label>
                <Input
                  id="nameEn"
                  value={formData.nameEn}
                  onChange={(e) => setFormData({ ...formData, nameEn: e.target.value })}
                  placeholder="Supplier Name"
                  dir="ltr"
                />
              </div>
            </div>

            {/* Phone & Email */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="phone">{t.supplierPhone}</Label>
                <Input
                  id="phone"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  placeholder="05XXXXXXXX"
                  dir="ltr"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">{t.supplierEmail}</Label>
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
              ) : editingSupplier ? (
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
              {t.deleteSupplier}{' '}
              <span className="font-bold text-foreground">
                {deletingSupplier?.name}
              </span>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDeleteDialogOpen(false);
                setDeletingSupplier(null);
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
