'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Plus,
  Pencil,
  Trash2,
  ChevronDown,
  ChevronLeft,
  Search,
  RefreshCw,
  FolderTree,
  Database,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { ScrollArea } from '@/components/ui/scroll-area';
import { CurrencyAmount } from '@/components/ui/currency-symbol';
import { useTranslation } from '@/lib/i18n';
import { formatNumber } from '@/lib/types';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Account {
  id: string;
  code: string;
  name: string;
  nameEn?: string;
  type: string;
  parentId?: string;
  branch: string;
  level: number;
  openingBalance: number;
  currentBalance: number;
  isActive: boolean;
  isSystem: boolean;
  description?: string;
  children?: Account[];
}

// ─── Constants ───────────────────────────────────────────────────────────────

const ACCOUNT_TYPE_LABELS_LOCAL = (t: any) => ({
  ASSET: t.asset,
  LIABILITY: t.liability,
  EQUITY: t.equity,
  REVENUE: t.revenue,
  EXPENSE: t.expense,
});

const ACCOUNT_TYPE_ORDER = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'];

const ACCOUNT_TYPE_COLORS: Record<string, string> = {
  ASSET: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  LIABILITY: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  EQUITY: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300',
  REVENUE: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  EXPENSE: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300',
};

const ACCOUNT_TYPE_BORDER_COLORS: Record<string, string> = {
  ASSET: 'border-r-blue-500 dark:border-r-blue-400',
  LIABILITY: 'border-r-red-500 dark:border-r-red-400',
  EQUITY: 'border-r-purple-500 dark:border-r-purple-400',
  REVENUE: 'border-r-green-500 dark:border-r-green-400',
  EXPENSE: 'border-r-orange-500 dark:border-r-orange-400',
};

function getBranchLabel(key: string, t: any): string {
  switch(key) {
    case 'CHINA_TOWN': return t.branchChinaTown;
    case 'PALACE_INDIA': return t.branchPalaceIndia;
    default: return key;
  }
}

const BRANCH_COLORS: Record<string, string> = {
  CHINA_TOWN: 'bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300',
  PALACE_INDIA: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function flattenAccounts(accounts: Account[]): Account[] {
  const result: Account[] = [];
  for (const account of accounts) {
    result.push(account);
    if (account.children && account.children.length > 0) {
      result.push(...flattenAccounts(account.children));
    }
  }
  return result;
}

function filterTree(accounts: Account[], query: string, accountTypeLabels: Record<string, string>): Account[] {
  if (!query) return accounts;
  const lower = query.toLowerCase();

  function matches(account: Account): boolean {
    return (
      account.name.toLowerCase().includes(lower) ||
      (account.nameEn && account.nameEn.toLowerCase().includes(lower)) ||
      account.code.toLowerCase().includes(lower) ||
      accountTypeLabels[account.type]?.includes(lower)
    );
  }

  function filterNode(account: Account): Account | null {
    const filteredChildren = account.children
      ? account.children
          .map(filterNode)
          .filter((a): a is Account => a !== null)
      : [];

    if (matches(account) || filteredChildren.length > 0) {
      return { ...account, children: filteredChildren };
    }
    return null;
  }

  return accounts.map(filterNode).filter((a): a is Account => a !== null);
}

// ─── Account Form Data ───────────────────────────────────────────────────────

interface AccountFormData {
  code: string;
  name: string;
  nameEn: string;
  type: string;
  parentId: string;
  branch: string;
  openingBalance: string;
  description: string;
}

const emptyForm: AccountFormData = {
  code: '',
  name: '',
  nameEn: '',
  type: 'ASSET',
  parentId: '',
  branch: 'CHINA_TOWN',
  openingBalance: '0',
  description: '',
};

// ─── Account Tree Node Component ────────────────────────────────────────────

function AccountTreeNode({
  account,
  allAccounts,
  onEdit,
  onDelete,
  expandedIds,
  toggleExpand,
}: {
  account: Account;
  allAccounts: Account[];
  onEdit: (account: Account) => void;
  onDelete: (account: Account) => void;
  expandedIds: Set<string>;
  toggleExpand: (id: string) => void;
}) {
  const { t } = useTranslation();
  const ACCOUNT_TYPE_LABELS = ACCOUNT_TYPE_LABELS_LOCAL(t);
  const hasChildren = account.children && account.children.length > 0;
  const isExpanded = expandedIds.has(account.id);
  const indent = account.level > 1 ? `pr-${Math.min((account.level - 1) * 8, 32)}` : '';

  return (
    <>
      <div
        className={`flex items-center gap-2 border-b border-border/50 py-2.5 px-3 hover:bg-muted/40 transition-colors ${indent} ${
          !account.isActive ? 'opacity-50' : ''
        }`}
        style={{
          paddingRight: account.level > 1 ? `${(account.level - 1) * 24 + 12}px` : '12px',
        }}
      >
        {/* Expand/Collapse Button */}
        <button
          onClick={() => hasChildren && toggleExpand(account.id)}
          className={`flex-shrink-0 flex items-center justify-center w-6 h-6 rounded transition-colors ${
            hasChildren
              ? 'hover:bg-muted cursor-pointer'
              : 'cursor-default'
          }`}
          aria-label={hasChildren ? (isExpanded ? t.collapse : t.expand) : undefined}
        >
          {hasChildren ? (
            isExpanded ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronLeft className="h-4 w-4 text-muted-foreground" />
            )
          ) : (
            <span className="w-4 h-4" />
          )}
        </button>

        {/* Account Code Badge */}
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-muted text-muted-foreground flex-shrink-0" dir="ltr">
          {account.code}
        </span>

        {/* Account Name */}
        <span className="flex-shrink-0 font-semibold text-foreground min-w-[120px] mr-1.5">
          {account.name}
        </span>

        {/* English Name */}
        {account.nameEn && (
          <span className="flex-shrink-0 text-sm text-muted-foreground min-w-[100px]" dir="ltr">
            {account.nameEn}
          </span>
        )}

        {/* Type Badge */}
        <Badge
          variant="outline"
          className={`flex-shrink-0 text-[10px] px-1.5 py-0 ${
            ACCOUNT_TYPE_COLORS[account.type] || ''
          }`}
        >
          {ACCOUNT_TYPE_LABELS[account.type] || account.type}
        </Badge>

        {/* Branch Badge */}
        {account.branch && (
          <Badge
            variant="outline"
            className={`flex-shrink-0 text-[10px] px-1.5 py-0 ${
              BRANCH_COLORS[account.branch] || ''
            }`}
          >
            {getBranchLabel(account.branch, t)}
          </Badge>
        )}

        {/* Spacer */}
        <span className="flex-1" />

        {/* Opening Balance */}
        <span className="flex-shrink-0 text-sm text-muted-foreground min-w-[120px] text-left" dir="ltr">
          {account.openingBalance !== 0 ? <CurrencyAmount amount={account.openingBalance} symbolClassName="w-3.5 h-3.5" /> : '—'}
        </span>

        {/* Current Balance */}
        <span
          className={`flex-shrink-0 text-sm font-medium min-w-[120px] text-left ${
            account.currentBalance > 0
              ? 'text-green-600 dark:text-green-400'
              : account.currentBalance < 0
                ? 'text-red-600 dark:text-red-400'
                : 'text-muted-foreground'
          }`}
          dir="ltr"
        >
          <CurrencyAmount amount={account.currentBalance} symbolClassName="w-3.5 h-3.5" />
        </span>

        {/* Actions */}
        <div className="flex-shrink-0 flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => onEdit(account)}
            aria-label={t.edit}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          {!account.isSystem && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-destructive hover:text-destructive"
              onClick={() => onDelete(account)}
              aria-label={t.delete}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {/* Children */}
      {hasChildren && isExpanded && (
        <div>
          {account.children!.map((child) => (
            <AccountTreeNode
              key={child.id}
              account={child}
              allAccounts={allAccounts}
              onEdit={onEdit}
              onDelete={onDelete}
              expandedIds={expandedIds}
              toggleExpand={toggleExpand}
            />
          ))}
        </div>
      )}
    </>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function ChartOfAccounts() {
  const { t, isRTL, locale } = useTranslation();

  const ACCOUNT_TYPE_LABELS = ACCOUNT_TYPE_LABELS_LOCAL(t);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [flatAccounts, setFlatAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [formData, setFormData] = useState<AccountFormData>(emptyForm);
  const [saving, setSaving] = useState(false);

  // Delete confirmation
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState<Account | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Seed loading
  const [seeding, setSeeding] = useState(false);

  // ─── Fetch Accounts ──────────────────────────────────────────────────────

  const fetchAccounts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/accounts');
      if (!res.ok) throw new Error(t.failedToFetchCategories);
      const data: Account[] = await res.json();
      setAccounts(data);
      setFlatAccounts(flattenAccounts(data));
      // Auto-expand all parent accounts on first load
      const parentIds = new Set<string>();
      function collectParentIds(accs: Account[]) {
        for (const a of accs) {
          if (a.children && a.children.length > 0) {
            parentIds.add(a.id);
            collectParentIds(a.children);
          }
        }
      }
      collectParentIds(data);
      setExpandedIds(parentIds);
    } catch {
      toast.error(t.failedToFetchCategories);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  // ─── Toggle Expand ───────────────────────────────────────────────────────

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  // ─── Seed Default Accounts ───────────────────────────────────────────────

  const handleSeed = async () => {
    setSeeding(true);
    try {
      const res = await fetch('/api/accounts/seed', { method: 'POST' });
      if (!res.ok) {
        const data = await res.json();
      throw new Error(data.error || t.failedToSeed);
      }
      toast.success(t.seedSuccess);
      fetchAccounts();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t.failedToSeed);
    } finally {
      setSeeding(false);
    }
  };

  // ─── Open Add Dialog ─────────────────────────────────────────────────────

  const openAddDialog = () => {
    setEditingAccount(null);
    setFormData(emptyForm);
    setDialogOpen(true);
  };

  // ─── Open Edit Dialog ────────────────────────────────────────────────────

  const openEditDialog = (account: Account) => {
    setEditingAccount(account);
    setFormData({
      code: account.code,
      name: account.name,
      nameEn: account.nameEn || '',
      type: account.type,
      parentId: account.parentId || '',
      branch: account.branch || 'CHINA_TOWN',
      openingBalance: String(account.openingBalance),
      description: account.description || '',
    });
    setDialogOpen(true);
  };

  // ─── Save Account (Add/Edit) ─────────────────────────────────────────────

  const handleSave = async () => {
    if (!formData.code.trim() || !formData.name.trim()) {
      toast.error(t.accountCode + ' & ' + t.accountName);
      return;
    }

    setSaving(true);
    try {
      if (editingAccount) {
        // Update
        const res = await fetch(`/api/accounts/${editingAccount.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: formData.name.trim(),
            nameEn: formData.nameEn.trim() || null,
            openingBalance: parseFloat(formData.openingBalance) || 0,
            branchId: formData.branch,
            description: formData.description.trim() || null,
          }),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || t.failedToUpdateAccount);
        }
        toast.success(t.accountUpdated);
      } else {
        // Create
        // Determine the level based on parentId
        let level = 1;
        if (formData.parentId) {
          const parent = flatAccounts.find((a) => a.id === formData.parentId);
          level = parent ? parent.level + 1 : 1;
        }

        const res = await fetch('/api/accounts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code: formData.code.trim(),
            name: formData.name.trim(),
            nameEn: formData.nameEn.trim() || null,
            type: formData.type,
            parentId: formData.parentId || null,
            branchId: formData.branch,
            level,
            openingBalance: parseFloat(formData.openingBalance) || 0,
            description: formData.description.trim() || null,
          }),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || t.failedToAddAccount);
        }
        toast.success(t.accountAdded);
      }
      setDialogOpen(false);
      fetchAccounts();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t.failedToUpdateAccount);
    } finally {
      setSaving(false);
    }
  };

  // ─── Delete Account ──────────────────────────────────────────────────────

  const handleDelete = async () => {
    if (!deletingAccount) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/accounts/${deletingAccount.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || t.failedToDeleteAccount);
      }
      toast.success(t.accountDeleted);
      setDeleteDialogOpen(false);
      setDeletingAccount(null);
      fetchAccounts();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t.failedToDeleteAccount);
    } finally {
      setDeleting(false);
    }
  };

  // ─── Group Accounts by Type ──────────────────────────────────────────────

  const filteredAccounts = filterTree(accounts, searchQuery, ACCOUNT_TYPE_LABELS);

  const groupedAccounts = ACCOUNT_TYPE_ORDER.map((type) => ({
    type,
    label: ACCOUNT_TYPE_LABELS[type],
    accounts: filteredAccounts.filter((a) => a.type === type),
    borderColor: ACCOUNT_TYPE_BORDER_COLORS[type],
    badgeColor: ACCOUNT_TYPE_COLORS[type],
  })).filter((g) => g.accounts.length > 0);

  // ─── Parent Account Options ──────────────────────────────────────────────

  const parentOptions = flatAccounts.filter(
    (a) => a.id !== editingAccount?.id
  );

  // ─── Check if branch is applicable ───────────────────────────────────────

  const isBranchApplicable =
    formData.type === 'REVENUE' || formData.type === 'EXPENSE';

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
          <FolderTree className="h-5 w-5 text-primary" />
          <h2 className="text-xl font-bold text-foreground">{t.chartOfAccounts}</h2>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:mr-auto">
          <Button onClick={openAddDialog} size="sm">
            <Plus className="h-4 w-4 ml-1" />
            {t.addAccount}
          </Button>

          {flatAccounts.length === 0 && (
            <Button onClick={handleSeed} variant="outline" size="sm" disabled={seeding}>
              {seeding ? (
                <Loader2 className="h-4 w-4 ml-1 animate-spin" />
              ) : (
                <Database className="h-4 w-4 ml-1" />
              )}
              {t.seedDefaultAccounts}
            </Button>
          )}

          <Button
            onClick={fetchAccounts}
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

      {/* ── Empty State ─────────────────────────────────────────────────── */}
      {flatAccounts.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <FolderTree className="h-16 w-16 text-muted-foreground/30 mb-4" />
            <h3 className="text-lg font-semibold text-foreground mb-2">
              {t.noAccounts}
            </h3>
            <p className="text-sm text-muted-foreground mb-6 text-center max-w-md">
              {t.seedDefaultAccounts}
            </p>
            <div className="flex gap-3">
              <Button onClick={handleSeed} disabled={seeding}>
                {seeding ? (
                  <Loader2 className="h-4 w-4 ml-1 animate-spin" />
                ) : (
                  <Database className="h-4 w-4 ml-1" />
                )}
                {t.seedDefaultAccounts}
              </Button>
              <Button onClick={openAddDialog} variant="outline">
                <Plus className="h-4 w-4 ml-1" />
                {t.addAccount}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Account Tree by Type Group ──────────────────────────────────── */}
      {groupedAccounts.map((group) => (
        <Card key={group.type} className={`overflow-hidden border-r-4 ${group.borderColor}`}>
          <Collapsible defaultOpen>
            <CollapsibleTrigger asChild>
              <CardHeader className="py-3 px-4 cursor-pointer hover:bg-muted/30 transition-colors">
                <div className="flex items-center gap-3">
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  <CardTitle className="text-base font-bold">
                    {group.label}
                  </CardTitle>
                  <Badge
                    variant="outline"
                    className={`text-[11px] ${group.badgeColor}`}
                  >
                    {formatNumber(group.accounts.length, 0)}
                  </Badge>
                </div>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="p-0">
                <ScrollArea className="w-full">
                  {/* Table Header */}
                  <div className="flex items-center gap-2 bg-muted/50 border-b px-3 py-2 text-xs font-medium text-muted-foreground">
                    <span className="w-6" /> {/* expand button space */}
                    <span className="w-20">{t.accountCode}</span>
                    <span className="min-w-[120px]">{t.accountName}</span>
                    <span className="min-w-[100px]">{t.accountNameEn}</span>
                    <span className="min-w-[70px]">{t.accountType}</span>
                    <span className="min-w-[70px]">{t.branch}</span>
                    <span className="flex-1" />
                    <span className="min-w-[120px] text-left" dir="ltr">{t.openingBalance}</span>
                    <span className="min-w-[120px] text-left" dir="ltr">{t.currentBalance}</span>
                    <span className="min-w-[72px]">{t.actions}</span>
                  </div>

                  {/* Tree Rows */}
                  {group.accounts.map((account) => (
                    <AccountTreeNode
                      key={account.id}
                      account={account}
                      allAccounts={flatAccounts}
                      onEdit={openEditDialog}
                      onDelete={(acc) => {
                        setDeletingAccount(acc);
                        setDeleteDialogOpen(true);
                      }}
                      expandedIds={expandedIds}
                      toggleExpand={toggleExpand}
                    />
                  ))}

                  {group.accounts.length === 0 && (
                    <div className="py-8 text-center text-sm text-muted-foreground">
                      {t.noAccounts}
                    </div>
                  )}
                </ScrollArea>
              </CardContent>
            </CollapsibleContent>
          </Collapsible>
        </Card>
      ))}

      {/* ── Add/Edit Account Dialog ─────────────────────────────────────── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingAccount ? t.editAccount : t.addAccount}
            </DialogTitle>
            <DialogDescription>
              {editingAccount
                ? t.editAccount
                : t.addAccount}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            {/* Code & Name */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="code">{t.accountCode} *</Label>
                <Input
                  id="code"
                  value={formData.code}
                  onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                  placeholder={t.accountCode}
                  dir="ltr"
                  disabled={!!editingAccount}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="name">{t.accountName} *</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder={t.accountName}
                />
              </div>
            </div>

            {/* English Name */}
            <div className="space-y-2">
              <Label htmlFor="nameEn">{t.accountNameEn}</Label>
              <Input
                id="nameEn"
                value={formData.nameEn}
                onChange={(e) => setFormData({ ...formData, nameEn: e.target.value })}
                placeholder={t.accountNameEn}
                dir="ltr"
              />
            </div>

            {/* Type & Parent */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>{t.accountType}</Label>
                <Select
                  value={formData.type}
                  onValueChange={(val) =>
                    setFormData({
                      ...formData,
                      type: val,
                      branch: val === 'REVENUE' || val === 'EXPENSE' ? formData.branch : 'CHINA_TOWN',
                    })
                  }
                  disabled={!!editingAccount}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ACCOUNT_TYPE_ORDER.map((type) => (
                      <SelectItem key={type} value={type}>
                        {ACCOUNT_TYPE_LABELS[type]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>{t.parentAccount}</Label>
                <Select
                  value={formData.parentId}
                  onValueChange={(val) =>
                    setFormData({ ...formData, parentId: val === '__none__' ? '' : val })
                  }
                  disabled={!!editingAccount}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={t.parentAccount} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— {t.none} —</SelectItem>
                    {parentOptions.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        <span className="inline-flex items-center gap-1.5">
                          <span className="inline-flex items-center px-1 py-0 rounded text-[9px] font-mono font-medium bg-muted text-muted-foreground" dir="ltr">
                            {a.code}
                          </span>
                          <span>{a.name}</span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Branch & Opening Balance */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>{t.branch}</Label>
                <Select
                  value={formData.branch}
                  onValueChange={(val) => setFormData({ ...formData, branch: val })}
                  disabled={!isBranchApplicable}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CHINA_TOWN">{t.branchChinaTown}</SelectItem>
                    <SelectItem value="PALACE_INDIA">{t.branchPalaceIndia}</SelectItem>
                  </SelectContent>
                </Select>
                {!isBranchApplicable && (
                  <p className="text-[11px] text-muted-foreground">
                    {t.branch}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="openingBalance">{t.openingBalance}</Label>
                <Input
                  id="openingBalance"
                  type="number"
                  value={formData.openingBalance}
                  onChange={(e) =>
                    setFormData({ ...formData, openingBalance: e.target.value })
                  }
                  dir="ltr"
                  min="0"
                  step="0.01"
                />
              </div>
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label htmlFor="description">{t.description}</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) =>
                  setFormData({ ...formData, description: e.target.value })
                }
                placeholder={t.description}
                rows={3}
              />
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
              ) : editingAccount ? (
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
              {t.deleteAccount}{' '}
              <span className="font-bold text-foreground">
                {deletingAccount?.name}
              </span>
              <span className="inline-flex items-center px-1 py-0 rounded text-[9px] font-mono font-medium bg-muted text-muted-foreground mr-1" dir="ltr">
                {deletingAccount?.code}
              </span>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDeleteDialogOpen(false);
                setDeletingAccount(null);
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
