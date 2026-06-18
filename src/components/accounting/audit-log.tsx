'use client';

import { useState, useEffect, useCallback, Fragment } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Shield,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  Loader2,
  Download,
  Search,
  Calendar,
  X,
  ChevronDown,
  ChevronUp,
  Activity,
  Clock,
  User,
  FileText,
  Hash,
} from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { useAppStore } from '@/lib/store';
import { exportToExcel } from '@/lib/export-utils';
import { toast } from 'sonner';

// ============================================================================
// Interfaces
// ============================================================================

interface AuditLogEntry {
  id: string;
  action: string;
  entity: string;
  entityId: string;
  entityNumber?: string;
  description: string;
  severity: string;
  category: string;
  userId: string;
  userName: string;
  branch?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
  createdAt: string;
}

interface AuditLogStats {
  totalEvents: number;
  criticalEvents: number;
  warningEvents: number;
  recentActivity: number;
}

// ============================================================================
// Constants
// ============================================================================

const ACTION_TYPES = [
  'CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT', 'FINALIZE', 'RETURN',
  'POST', 'CLOSE', 'EXPORT', 'IMPORT', 'RESTORE', 'RECOVER', 'PURGE',
  'SETTINGS_CHANGE', 'PERMISSION_CHANGE',
] as const;

const ENTITY_TYPES = [
  'POS_INVOICE', 'JOURNAL_ENTRY', 'PRODUCT', 'CUSTOMER', 'USER',
  'ACCOUNT', 'SHIFT', 'STOCK_TAKE', 'STOCK_TRANSFER', 'TRANSACTION',
  'SETTING', 'BACKUP', 'SYSTEM', 'AUTH',
] as const;

const CATEGORY_TYPES = [
  'AUTH', 'POS', 'ACCOUNTING', 'INVENTORY', 'USERS', 'SETTINGS', 'SYSTEM', 'BACKUP',
] as const;

const SEVERITY_TYPES = ['INFO', 'WARNING', 'CRITICAL'] as const;

const PAGE_SIZE = 50;

// ============================================================================
// Helpers
// ============================================================================

function useAuthHeaders() {
  const authToken = useAppStore((s) => s.authToken);
  return { Authorization: `Bearer ${authToken}` };
}

function getActionBadgeClasses(action: string): string {
  const map: Record<string, string> = {
    CREATE: 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-900/40 dark:text-emerald-300 dark:border-emerald-700',
    UPDATE: 'bg-teal-100 text-teal-800 border-teal-300 dark:bg-teal-900/40 dark:text-teal-300 dark:border-teal-700',
    DELETE: 'bg-red-100 text-red-800 border-red-300 dark:bg-red-900/40 dark:text-red-300 dark:border-red-700',
    LOGIN: 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-900/40 dark:text-emerald-300 dark:border-emerald-700',
    LOGOUT: 'bg-gray-100 text-gray-800 border-gray-300 dark:bg-gray-800/40 dark:text-gray-300 dark:border-gray-600',
    FINALIZE: 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-900/40 dark:text-emerald-300 dark:border-emerald-700',
    RETURN: 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-700',
    POST: 'bg-teal-100 text-teal-800 border-teal-300 dark:bg-teal-900/40 dark:text-teal-300 dark:border-teal-700',
    CLOSE: 'bg-gray-100 text-gray-800 border-gray-300 dark:bg-gray-800/40 dark:text-gray-300 dark:border-gray-600',
    EXPORT: 'bg-sky-100 text-sky-800 border-sky-300 dark:bg-sky-900/40 dark:text-sky-300 dark:border-sky-700',
    IMPORT: 'bg-sky-100 text-sky-800 border-sky-300 dark:bg-sky-900/40 dark:text-sky-300 dark:border-sky-700',
    RESTORE: 'bg-purple-100 text-purple-800 border-purple-300 dark:bg-purple-900/40 dark:text-purple-300 dark:border-purple-700',
    RECOVER: 'bg-purple-100 text-purple-800 border-purple-300 dark:bg-purple-900/40 dark:text-purple-300 dark:border-purple-700',
    PURGE: 'bg-red-100 text-red-800 border-red-300 dark:bg-red-900/40 dark:text-red-300 dark:border-red-700',
    SETTINGS_CHANGE: 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-700',
    PERMISSION_CHANGE: 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-700',
  };
  return map[action] || 'bg-gray-100 text-gray-800 border-gray-300 dark:bg-gray-800/40 dark:text-gray-300 dark:border-gray-600';
}

function getSeverityBadgeClasses(severity: string): string {
  const map: Record<string, string> = {
    INFO: 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-900/40 dark:text-emerald-300 dark:border-emerald-700',
    WARNING: 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-700',
    CRITICAL: 'bg-red-100 text-red-800 border-red-300 dark:bg-red-900/40 dark:text-red-300 dark:border-red-700',
  };
  return map[severity] || 'bg-gray-100 text-gray-800 border-gray-300 dark:bg-gray-800/40 dark:text-gray-300 dark:border-gray-600';
}

function formatDateTime(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleString('ar-SA-u-nu-latn', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  } catch {
    return dateStr;
  }
}

// ============================================================================
// Stats Card Component
// ============================================================================

function StatCard({
  icon,
  label,
  value,
  accent = 'emerald',
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  accent?: 'emerald' | 'amber' | 'red';
}) {
  const accentClasses = {
    emerald: {
      iconBg: 'bg-emerald-100 dark:bg-emerald-900/40',
      iconText: 'text-emerald-600 dark:text-emerald-400',
      border: 'border-emerald-200 dark:border-emerald-800',
      gradient: 'from-emerald-50 to-transparent dark:from-emerald-950/30',
    },
    amber: {
      iconBg: 'bg-amber-100 dark:bg-amber-900/40',
      iconText: 'text-amber-600 dark:text-amber-400',
      border: 'border-amber-200 dark:border-amber-800',
      gradient: 'from-amber-50 to-transparent dark:from-amber-950/30',
    },
    red: {
      iconBg: 'bg-red-100 dark:bg-red-900/40',
      iconText: 'text-red-600 dark:text-red-400',
      border: 'border-red-200 dark:border-red-800',
      gradient: 'from-red-50 to-transparent dark:from-red-950/30',
    },
  };
  const c = accentClasses[accent];

  return (
    <Card className={`${c.border} bg-gradient-to-bl ${c.gradient}`}>
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <div className={`p-2.5 rounded-xl ${c.iconBg}`}>
            <div className={c.iconText}>{icon}</div>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-muted-foreground truncate">{label}</p>
            <p className={`text-lg font-bold font-mono ${c.iconText} truncate`}>{value}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Empty State Component
// ============================================================================

function EmptyState({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <Card>
      <CardContent className="p-12 text-center">
        <div className="mx-auto w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
          {icon}
        </div>
        <p className="text-lg font-medium text-muted-foreground">{title}</p>
        <p className="text-sm text-muted-foreground mt-1">{description}</p>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Action Label Helper
// ============================================================================

function getActionLabel(action: string, t: Record<string, string>): string {
  const key = `action${action.charAt(0)}${action.slice(1).toLowerCase()}`;
  // Map specific actions to translation keys
  const actionKeyMap: Record<string, string> = {
    CREATE: 'actionCreate',
    UPDATE: 'actionUpdate',
    DELETE: 'actionDelete',
    LOGIN: 'actionLogin',
    LOGOUT: 'actionLogout',
    FINALIZE: 'actionFinalize',
    RETURN: 'actionReturn',
    POST: 'actionPost',
    CLOSE: 'actionClose',
    EXPORT: 'actionExport',
    IMPORT: 'actionImport',
    RESTORE: 'actionRestore',
    RECOVER: 'actionRecover',
    PURGE: 'actionPurge',
    SETTINGS_CHANGE: 'actionSettingsChange',
    PERMISSION_CHANGE: 'actionPermissionChange',
  };
  const translationKey = actionKeyMap[action];
  if (translationKey && t[translationKey]) return t[translationKey];
  if (t[key]) return t[key];
  return action;
}

function getEntityLabel(entity: string, t: Record<string, string>): string {
  const entityKeyMap: Record<string, string> = {
    POS_INVOICE: 'entityPosInvoice',
    JOURNAL_ENTRY: 'entityJournalEntry',
    PRODUCT: 'entityProduct',
    CUSTOMER: 'entityCustomer',
    USER: 'entityUser',
    ACCOUNT: 'entityAccount',
    SHIFT: 'entityShift',
    STOCK_TAKE: 'entityStockTake',
    STOCK_TRANSFER: 'entityStockTransfer',
    TRANSACTION: 'entityTransaction',
    SETTING: 'entitySetting',
    BACKUP: 'entityBackup',
    SYSTEM: 'entitySystem',
    AUTH: 'entityAuth',
  };
  const translationKey = entityKeyMap[entity];
  if (translationKey && t[translationKey]) return t[translationKey];
  return entity;
}

function getSeverityLabel(severity: string, t: Record<string, string>): string {
  const map: Record<string, string> = {
    INFO: 'severityInfo',
    WARNING: 'severityWarning',
    CRITICAL: 'severityCritical',
  };
  const key = map[severity];
  if (key && t[key]) return t[key];
  return severity;
}

function getCategoryLabel(category: string, t: Record<string, string>): string {
  const map: Record<string, string> = {
    AUTH: 'categoryAuth',
    POS: 'categoryPos',
    ACCOUNTING: 'categoryAccounting',
    INVENTORY: 'categoryInventory',
    USERS: 'categoryUsers',
    SETTINGS: 'categorySettings',
    SYSTEM: 'categorySystem',
    BACKUP: 'categoryBackup',
  };
  const key = map[category];
  if (key && t[key]) return t[key];
  return category;
}

// ============================================================================
// Main Component
// ============================================================================

export default function AuditLog() {
  const { t, isRTL } = useTranslation();
  const headers = useAuthHeaders();

  // ---- State ----
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [stats, setStats] = useState<AuditLogStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [statsLoading, setStatsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  // ---- Filters ----
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [actionFilter, setActionFilter] = useState('ALL');
  const [entityFilter, setEntityFilter] = useState('ALL');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [severityFilter, setSeverityFilter] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  // ---- Pagination ----
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [totalCount, setTotalCount] = useState(0);

  // ---- Fetch Stats ----
  const fetchStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('days', '30');
      const res = await fetch(`/api/audit-logs/stats?${params.toString()}`, { headers });
      if (res.ok) {
        const data = await res.json();
        setStats(data);
      }
    } catch {
      // silently fail - stats are optional
    } finally {
      setStatsLoading(false);
    }
  }, []);

  // ---- Fetch Logs ----
  const fetchLogs = useCallback(async (resetOffset = true) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (dateFrom) params.set('dateFrom', dateFrom);
      if (dateTo) params.set('dateTo', dateTo);
      if (actionFilter && actionFilter !== 'ALL') params.set('action', actionFilter);
      if (entityFilter && entityFilter !== 'ALL') params.set('entity', entityFilter);
      if (categoryFilter && categoryFilter !== 'ALL') params.set('category', categoryFilter);
      if (severityFilter && severityFilter !== 'ALL') params.set('severity', severityFilter);
      if (searchQuery.trim()) params.set('search', searchQuery.trim());

      const currentOffset = resetOffset ? 0 : offset;
      params.set('limit', String(PAGE_SIZE));
      params.set('offset', String(currentOffset));

      const res = await fetch(`/api/audit-logs?${params.toString()}`, { headers });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || t.failedToFetchData || 'Failed to fetch data');
      }
      const json = await res.json();

      if (resetOffset) {
        setLogs(Array.isArray(json) ? json : json.logs || []);
        setOffset(0);
      } else {
        const newLogs = Array.isArray(json) ? json : json.logs || [];
        setLogs((prev) => [...prev, ...newLogs]);
      }

      const fetchedLogs = Array.isArray(json) ? json : json.logs || [];
      setTotalCount(json.total || fetchedLogs.length);
      setHasMore(fetchedLogs.length >= PAGE_SIZE);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t.failedToFetchData || 'Failed to fetch data';
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, actionFilter, entityFilter, categoryFilter, severityFilter, searchQuery, offset, t.failedToFetchData, headers]);

  // ---- Initial Load ----
  useEffect(() => {
    fetchStats();
    fetchLogs(true);
  }, []);

  // ---- Toggle Row Expansion ----
  const toggleRow = (id: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // ---- Clear Filters ----
  const clearFilters = () => {
    setDateFrom('');
    setDateTo('');
    setActionFilter('ALL');
    setEntityFilter('ALL');
    setCategoryFilter('ALL');
    setSeverityFilter('ALL');
    setSearchQuery('');
  };

  const hasActiveFilters = dateFrom || dateTo || actionFilter !== 'ALL' || entityFilter !== 'ALL' || categoryFilter !== 'ALL' || severityFilter !== 'ALL' || searchQuery.trim();

  // ---- Load More ----
  const handleLoadMore = () => {
    const newOffset = offset + PAGE_SIZE;
    setOffset(newOffset);

    const fetchMore = async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (dateFrom) params.set('dateFrom', dateFrom);
        if (dateTo) params.set('dateTo', dateTo);
        if (actionFilter && actionFilter !== 'ALL') params.set('action', actionFilter);
        if (entityFilter && entityFilter !== 'ALL') params.set('entity', entityFilter);
        if (categoryFilter && categoryFilter !== 'ALL') params.set('category', categoryFilter);
        if (severityFilter && severityFilter !== 'ALL') params.set('severity', severityFilter);
        if (searchQuery.trim()) params.set('search', searchQuery.trim());
        params.set('limit', String(PAGE_SIZE));
        params.set('offset', String(newOffset));

        const res = await fetch(`/api/audit-logs?${params.toString()}`, { headers });
        if (!res.ok) {
          throw new Error(t.failedToFetchData || 'Failed to fetch data');
        }
        const json = await res.json();
        const newLogs = Array.isArray(json) ? json : json.logs || [];
        setLogs((prev) => [...prev, ...newLogs]);
        setHasMore(newLogs.length >= PAGE_SIZE);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : t.failedToFetchData || 'Failed to fetch data';
        toast.error(message);
      } finally {
        setLoading(false);
      }
    };
    fetchMore();
  };

  // ---- Export ----
  const handleExport = () => {
    if (logs.length === 0) return;

    exportToExcel({
      data: logs.map((log) => ({
        time: formatDateTime(log.createdAt),
        user: log.userName,
        action: getActionLabel(log.action, t),
        entity: getEntityLabel(log.entity, t),
        reference: log.entityNumber || log.entityId,
        description: log.description,
        severity: getSeverityLabel(log.severity, t),
        category: getCategoryLabel(log.category, t),
        branch: log.branch || '',
      })),
      columns: [
        { key: 'time', header: t.date || 'الوقت', width: 20 },
        { key: 'user', header: t.user || 'المستخدم', width: 18 },
        { key: 'action', header: t.type || 'الإجراء', width: 16 },
        { key: 'entity', header: t.description || 'الكيان', width: 16 },
        { key: 'reference', header: t.reference || 'المرجع', width: 18 },
        { key: 'description', header: t.description || 'الوصف', width: 30 },
        { key: 'severity', header: t.status || 'الأهمية', width: 12 },
        { key: 'category', header: t.classification || 'الفئة', width: 14 },
        { key: 'branch', header: t.branch || 'الفرع', width: 14 },
      ],
      sheetName: t.auditLog || 'سجل المراجعة',
      fileName: `audit-log-${new Date().toISOString().slice(0, 10)}.xlsx`,
      title: t.auditLog || 'سجل المراجعة',
    });
  };

  // ============================================================================
  // RENDER
  // ============================================================================

  return (
    <div className="space-y-4" dir={isRTL ? 'rtl' : 'ltr'}>
      {/* Header */}
      <Card className="border-emerald-200 dark:border-emerald-800">
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-xl text-emerald-700 dark:text-emerald-400 flex items-center gap-2">
                <Shield className="size-5" />
                {t.auditLog || 'سجل المراجعة'}
              </CardTitle>
              <CardDescription>
                {t.auditTrail || 'تتبع جميع العمليات والتغييرات في النظام'}
              </CardDescription>
            </div>
            <Button
              onClick={handleExport}
              disabled={logs.length === 0 || loading}
              variant="outline"
              size="sm"
              className="gap-1.5 border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-400 dark:hover:bg-emerald-950/30"
            >
              <Download className="size-4" />
              <span className="hidden sm:inline">{t.exportAuditLog || 'تصدير سجل المراجعة'}</span>
            </Button>
          </div>
        </CardHeader>
      </Card>

      {/* Stats Cards */}
      <div className="grid gap-4 grid-cols-2 sm:grid-cols-4">
        {statsLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <Skeleton className="h-16 w-full" />
              </CardContent>
            </Card>
          ))
        ) : (
          <>
            <StatCard
              icon={<Activity className="size-5" />}
              label={t.totalEvents || 'إجمالي الأحداث'}
              value={stats?.totalEvents ?? 0}
              accent="emerald"
            />
            <StatCard
              icon={<ShieldAlert className="size-5" />}
              label={t.criticalEvents || 'أحداث حرجة'}
              value={stats?.criticalEvents ?? 0}
              accent="red"
            />
            <StatCard
              icon={<AlertTriangle className="size-5" />}
              label={t.warningEvents || 'أحداث تحذيرية'}
              value={stats?.warningEvents ?? 0}
              accent="amber"
            />
            <StatCard
              icon={<Clock className="size-5" />}
              label={t.recentActivity || 'النشاط الأخير'}
              value={stats?.recentActivity ?? 0}
              accent="emerald"
            />
          </>
        )}
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col gap-3">
            {/* Search Bar */}
            <div className="relative">
              <Search className="absolute top-1/2 -translate-y-1/2 size-4 text-muted-foreground start-3" />
              <Input
                placeholder={t.search || 'بحث في الوصف أو الرقم...'}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="ps-9"
              />
            </div>

            {/* Filter Row */}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
              {/* Date From */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                  <Calendar className="size-3" />
                  {t.dateFrom || 'من تاريخ'}
                </label>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm shadow-xs focus:border-ring focus:ring-ring/50 focus:ring-[3px] focus:outline-none"
                />
              </div>

              {/* Date To */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                  <Calendar className="size-3" />
                  {t.dateTo || 'إلى تاريخ'}
                </label>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm shadow-xs focus:border-ring focus:ring-ring/50 focus:ring-[3px] focus:outline-none"
                />
              </div>

              {/* Action Type */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">{t.filterByAction || 'تصفية بالإجراء'}</label>
                <Select value={actionFilter} onValueChange={setActionFilter}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">{t.all || 'الكل'}</SelectItem>
                    {ACTION_TYPES.map((action) => (
                      <SelectItem key={action} value={action}>
                        {getActionLabel(action, t)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Entity Type */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">{t.filterByEntity || 'تصفية بالكيان'}</label>
                <Select value={entityFilter} onValueChange={setEntityFilter}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">{t.all || 'الكل'}</SelectItem>
                    {ENTITY_TYPES.map((entity) => (
                      <SelectItem key={entity} value={entity}>
                        {getEntityLabel(entity, t)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Category */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">{t.filterByCategory || 'تصفية بالفئة'}</label>
                <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">{t.all || 'الكل'}</SelectItem>
                    {CATEGORY_TYPES.map((cat) => (
                      <SelectItem key={cat} value={cat}>
                        {getCategoryLabel(cat, t)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Severity */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">{t.filterBySeverity || 'تصفية بالأهمية'}</label>
                <Select value={severityFilter} onValueChange={setSeverityFilter}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">{t.all || 'الكل'}</SelectItem>
                    {SEVERITY_TYPES.map((sev) => (
                      <SelectItem key={sev} value={sev}>
                        {getSeverityLabel(sev, t)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-2 flex-wrap">
              <Button
                onClick={() => fetchLogs(true)}
                disabled={loading}
                size="sm"
                className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                {loading ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
                {t.show || 'عرض'}
              </Button>
              {hasActiveFilters && (
                <Button
                  onClick={clearFilters}
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                >
                  <X className="size-4" />
                  {t.clearFilters || 'مسح الفلاتر'}
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Error State */}
      {error && (
        <Card className="border-destructive/50">
          <CardContent className="p-4">
            <div className="flex items-center gap-3 text-destructive">
              <AlertTriangle className="size-5" />
              <p className="text-sm font-medium">{error}</p>
            </div>
            <Button onClick={() => fetchLogs(true)} variant="outline" className="mt-3" size="sm">
              {t.retry || 'إعادة المحاولة'}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Loading State */}
      {loading && logs.length === 0 && (
        <div className="space-y-4">
          <Card>
            <CardContent className="p-4">
              <Skeleton className="h-64 w-full" />
            </CardContent>
          </Card>
        </div>
      )}

      {/* Data Table */}
      {!loading && !error && logs.length === 0 ? (
        <EmptyState
          icon={<ShieldCheck className="size-8 text-muted-foreground" />}
          title={t.noAuditLogs || 'لا توجد سجلات مراجعة'}
          description={t.noAuditLogsDescription || 'قم بتعديل الفلاتر أو تأكد من وجود نشاط في النظام'}
        />
      ) : logs.length > 0 ? (
        <Card>
          <CardContent className="p-0">
            {/* Custom scrollbar styling */}
            <style jsx>{`
              .audit-scroll::-webkit-scrollbar {
                width: 6px;
              }
              .audit-scroll::-webkit-scrollbar-track {
                background: transparent;
              }
              .audit-scroll::-webkit-scrollbar-thumb {
                background: #d1d5db;
                border-radius: 3px;
              }
              .audit-scroll::-webkit-scrollbar-thumb:hover {
                background: #9ca3af;
              }
              .dark .audit-scroll::-webkit-scrollbar-thumb {
                background: #4b5563;
              }
              .dark .audit-scroll::-webkit-scrollbar-thumb:hover {
                background: #6b7280;
              }
            `}</style>
            <div className="max-h-[65vh] overflow-y-auto audit-scroll">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted/95 backdrop-blur z-10">
                  <tr className="border-b">
                    <th className="py-3 px-3 font-medium text-muted-foreground text-start">
                      <div className="flex items-center gap-1"><Clock className="size-3" /> {t.date || 'الوقت'}</div>
                    </th>
                    <th className="py-3 px-3 font-medium text-muted-foreground text-start">
                      <div className="flex items-center gap-1"><User className="size-3" /> {t.user || 'المستخدم'}</div>
                    </th>
                    <th className="py-3 px-3 font-medium text-muted-foreground text-start">
                      <div className="flex items-center gap-1"><Activity className="size-3" /> {t.type || 'الإجراء'}</div>
                    </th>
                    <th className="py-3 px-3 font-medium text-muted-foreground text-start">
                      <div className="flex items-center gap-1"><FileText className="size-3" /> {t.description || 'الكيان'}</div>
                    </th>
                    <th className="py-3 px-3 font-medium text-muted-foreground text-start">
                      <div className="flex items-center gap-1"><Hash className="size-3" /> {t.reference || 'المرجع'}</div>
                    </th>
                    <th className="py-3 px-3 font-medium text-muted-foreground text-start hidden md:table-cell">
                      {t.description || 'الوصف'}
                    </th>
                    <th className="py-3 px-3 font-medium text-muted-foreground text-start">
                      {t.status || 'الأهمية'}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => {
                    const isExpanded = expandedRows.has(log.id);
                    return (
                      <Fragment key={log.id}>
                        <tr className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                        {/* Main Row */}
                        <td className="py-2.5 px-3 whitespace-nowrap font-mono text-xs" dir="ltr">
                          {formatDateTime(log.createdAt)}
                        </td>
                        <td className="py-2.5 px-3 font-medium text-sm">
                          {log.userName}
                        </td>
                        <td className="py-2.5 px-3">
                          <Badge variant="outline" className={`text-xs ${getActionBadgeClasses(log.action)}`}>
                            {getActionLabel(log.action, t)}
                          </Badge>
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="flex flex-col gap-0.5">
                            <span className="text-sm">{getEntityLabel(log.entity, t)}</span>
                            {log.details && (
                              <button
                                onClick={() => toggleRow(log.id)}
                                className="text-xs text-emerald-600 dark:text-emerald-400 hover:underline flex items-center gap-0.5 w-fit"
                              >
                                {isExpanded ? (
                                  <>
                                    <ChevronUp className="size-3" />
                                    {t.hideDetails || 'إخفاء التفاصيل'}
                                  </>
                                ) : (
                                  <>
                                    <ChevronDown className="size-3" />
                                    {t.viewDetails || 'عرض التفاصيل'}
                                  </>
                                )}
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 font-mono text-xs" dir="ltr">
                          {log.entityNumber || log.entityId?.slice(0, 8) || '-'}
                        </td>
                        <td className="py-2.5 px-3 text-muted-foreground text-sm max-w-[200px] truncate hidden md:table-cell">
                          {log.description}
                        </td>
                        <td className="py-2.5 px-3">
                          <Badge variant="outline" className={`text-xs ${getSeverityBadgeClasses(log.severity)}`}>
                            {getSeverityLabel(log.severity, t)}
                          </Badge>
                        </td>
                      </tr>
                      {isExpanded && log.details && (
                        <tr key={`${log.id}-details`} className="border-b border-emerald-200/50 dark:border-emerald-800/50 bg-emerald-50/50 dark:bg-emerald-950/20">
                          <td colSpan={7} className="py-3 px-6">
                            <div className="text-xs">
                              <div className="font-medium text-emerald-700 dark:text-emerald-400 mb-2">
                                {t.details || 'التفاصيل'}
                              </div>
                              <pre className="whitespace-pre-wrap text-muted-foreground bg-background/50 dark:bg-background/30 rounded-md p-3 border border-border/50 overflow-x-auto text-xs leading-relaxed" dir="ltr">
                                {JSON.stringify(log.details, null, 2)}
                              </pre>
                              {log.ipAddress && (
                                <div className="mt-2 text-muted-foreground">
                                  IP: <span className="font-mono" dir="ltr">{log.ipAddress}</span>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination Footer */}
            <div className="border-t p-3 flex items-center justify-between gap-2 bg-muted/30">
              <p className="text-xs text-muted-foreground">
                {t.showingOf || 'عرض'} {logs.length} {t.of || 'من'} {totalCount}
              </p>
              {hasMore && (
                <Button
                  onClick={handleLoadMore}
                  disabled={loading}
                  variant="outline"
                  size="sm"
                  className="gap-1.5 text-xs"
                >
                  {loading ? <Loader2 className="size-3 animate-spin" /> : <ChevronDown className="size-3" />}
                  {t.loadMore || 'تحميل المزيد'}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
