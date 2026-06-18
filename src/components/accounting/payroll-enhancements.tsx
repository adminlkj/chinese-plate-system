'use client';

/**
 * Payroll Enhancements — 6 new tab components
 * ===========================================
 *
 * Exports:
 *   - AllowancesTab     (البدلات)              — AllowanceType + EmployeeAllowance management
 *   - LeavesTab         (الإجازات)             — Leave records CRUD
 *   - AttendanceTab     (الحضور)               — Daily attendance + summary cards
 *   - PeriodLocksTab    (إقفال الفترات)        — ADMIN-only period lock/unlock (Section 10)
 *   - EmployeeLedgerTab (كشف حساب الموظف)      — Employee ledger with running balance + print
 *   - PayrollSettingsTab (إعدادات الرواتب)     — Per-branch payroll settings (GOSI, deductions, etc.)
 *
 * Each component accepts `{ branches, selectedBranchId }` props — same signature
 * as the existing tabs in payroll.tsx.
 *
 * All API calls use RELATIVE paths (e.g. `/api/payroll/allowances`) — no absolute URLs.
 * All fetches gracefully handle 401/403 by showing a toast.
 *
 * Backend routes consumed:
 *   GET/POST /api/payroll/allowances
 *   PUT/DELETE /api/payroll/allowances/[id]
 *   GET/POST /api/payroll/employee-allowances
 *   PUT/DELETE /api/payroll/employee-allowances/[id]
 *   GET/POST /api/payroll/leaves
 *   PUT/DELETE /api/payroll/leaves/[id]
 *   GET/POST /api/payroll/attendance
 *   PUT/DELETE /api/payroll/attendance/[id]
 *   GET/POST /api/payroll/period-locks
 *   POST /api/payroll/period-locks/[id]/unlock
 *   DELETE /api/payroll/period-locks/[id]
 *   GET /api/payroll/employee-ledger?employeeId=...
 *   GET/POST /api/payroll/settings
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Plus,
  Pencil,
  Trash2,
  RefreshCw,
  Loader2,
  Search,
  Eye,
  Printer,
  Lock,
  LockOpen,
  AlertTriangle,
  ShieldAlert,
  CalendarDays,
  Clock,
  Settings as SettingsIcon,
  BookOpen,
  Save,
  Layers,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
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
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { useAppStore } from '@/lib/store';
import {
  printReportDocument,
  fetchCompanyInfoForPrint,
  fetchBranchInfoForPrint,
  generateReportNumber,
} from '@/lib/report-print';

// ─── Shared types ─────────────────────────────────────────────────────

export interface Branch {
  id: string;
  code: string;
  name: string;
  nameEn?: string;
}

interface EmployeeLite {
  id: string;
  code: string;
  name: string;
  nameEn?: string;
  position?: string;
  salaryType?: 'MONTHLY' | 'HOURLY';
  baseSalary?: number;
  branchId: string;
  branchNameEn?: string;
  branchName?: string;
}

// ─── Helpers (kept local to avoid touching payroll.tsx exports) ───────

const MONTHS_AR = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
];

// NOTE (PAYROLL-FIX-FINAL): All number/date formatting uses 'en-US' for money and
// 'ar-SA-u-nu-latn' for dates — Arabic month names but Latin/English digits.
// Enforces requirement "الارقام انجليزية دائما" (Numbers must always be English digits).
const AR_SA_LATN = 'ar-SA-u-nu-latn';

function formatMoney(n: number): string {
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
}

function formatDate(d: string | Date | null | undefined): string {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleDateString(AR_SA_LATN, { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatDateTime(d: string | Date | null | undefined): string {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleString(AR_SA_LATN, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ─── Shared: fetch employees by branch ────────────────────────────────

async function fetchEmployees(branchId: string, status?: string): Promise<EmployeeLite[]> {
  const params = new URLSearchParams();
  if (branchId && branchId !== 'all') params.set('branchId', branchId);
  if (status) params.set('status', status);
  params.set('pageSize', '500');
  const res = await fetch(`/api/payroll/employees?${params}`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.employees || [];
}

// ════════════════════════════════════════════════════════════════════
// 1) ALLOWANCES TAB — AllowanceType + EmployeeAllowance management
// ════════════════════════════════════════════════════════════════════

interface AllowanceType {
  id: string;
  code: string;
  name: string;
  nameEn?: string;
  category: 'ALLOWANCE' | 'DEDUCTION';
  isPercentage: boolean;
  defaultAmount: number;
  isRecurring: boolean;
  isActive: boolean;
  branchId: string;
  branchName?: string;
  branchCode?: string;
  employeeCount?: number;
}

interface EmployeeAllowance {
  id: string;
  employeeId: string;
  employeeCode?: string;
  employeeName?: string;
  allowanceTypeId: string;
  allowanceTypeCode?: string;
  allowanceTypeName?: string;
  category?: string;
  isPercentage?: boolean;
  amount: number;
  isActive: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
  notes?: string;
}

const DEFAULT_ALLOWANCE_TEMPLATES = [
  { code: 'HOUSING', name: 'بدل سكن', nameEn: 'Housing Allowance', category: 'ALLOWANCE', defaultAmount: 1000 },
  { code: 'TRANSPORT', name: 'بدل نقل', nameEn: 'Transport Allowance', category: 'ALLOWANCE', defaultAmount: 300 },
  { code: 'COMMUNICATION', name: 'بدل اتصال', nameEn: 'Communication Allowance', category: 'ALLOWANCE', defaultAmount: 200 },
  { code: 'BONUS', name: 'مكافأة', nameEn: 'Bonus', category: 'ALLOWANCE', defaultAmount: 0 },
  { code: 'COMMISSION', name: 'عمولة', nameEn: 'Commission', category: 'ALLOWANCE', defaultAmount: 0 },
  { code: 'OVERTIME', name: 'بدل عمل إضافي', nameEn: 'Overtime', category: 'ALLOWANCE', defaultAmount: 0 },
  { code: 'GOSI', name: 'خصم التأمينات', nameEn: 'GOSI Deduction', category: 'DEDUCTION', defaultAmount: 10, isPercentage: true },
  { code: 'PENALTY', name: 'غرامة', nameEn: 'Penalty', category: 'DEDUCTION', defaultAmount: 0 },
] as const;

export function AllowancesTab({ branches, selectedBranchId }: { branches: Branch[]; selectedBranchId: string }) {
  const [activeSub, setActiveSub] = useState('types');
  return (
    <div className="space-y-4">
      <Tabs value={activeSub} onValueChange={setActiveSub}>
        <TabsList>
          <TabsTrigger value="types"><Layers className="size-4" /> أنواع البدلات</TabsTrigger>
          <TabsTrigger value="employee">بدلات الموظفين</TabsTrigger>
        </TabsList>
        <TabsContent value="types" className="mt-4">
          <AllowanceTypesSection branches={branches} selectedBranchId={selectedBranchId} />
        </TabsContent>
        <TabsContent value="employee" className="mt-4">
          <EmployeeAllowancesSection branches={branches} selectedBranchId={selectedBranchId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function AllowanceTypesSection({ branches, selectedBranchId }: { branches: Branch[]; selectedBranchId: string }) {
  const [types, setTypes] = useState<AllowanceType[]>([]);
  const [defaults, setDefaults] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [creatingDefaults, setCreatingDefaults] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AllowanceType | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const fetchTypes = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedBranchId !== 'all') params.set('branchId', selectedBranchId);
      params.set('pageSize', '200');
      const res = await fetch(`/api/payroll/allowances?${params}`);
      if (res.ok) {
        const data = await res.json();
        setTypes(data.types || []);
        setDefaults(data.defaults || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [selectedBranchId]);

  useEffect(() => { fetchTypes(); }, [fetchTypes]);

  const handleCreateDefaults = async () => {
    const branchId = selectedBranchId !== 'all'
      ? selectedBranchId
      : branches[0]?.id;
    if (!branchId) {
      toast.error('اختر فرعاً محدداً لإنشاء البدلات الافتراضية');
      return;
    }
    setCreatingDefaults(true);
    try {
      await Promise.all(DEFAULT_ALLOWANCE_TEMPLATES.map((tpl) =>
        fetch('/api/payroll/allowances', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...tpl, branchId }),
        }).then(async (r) => {
          if (!r.ok) {
            const err = await r.json().catch(() => ({}));
            // 409 (duplicate code) is OK during defaults creation
            if (r.status !== 409) throw new Error(err.error || 'فشل الإنشاء');
          }
        })
      ));
      toast.success('تم إنشاء أنواع البدلات الافتراضية');
      fetchTypes();
    } catch (e: any) {
      toast.error(e.message || 'فشل إنشاء البدلات الافتراضية');
    } finally {
      setCreatingDefaults(false);
    }
  };

  const handleDelete = async (t: AllowanceType) => {
    if (!confirm(`حذف نوع البدل "${t.name}" (${t.code})؟`)) return;
    try {
      const res = await fetch(`/api/payroll/allowances/${t.id}`, { method: 'DELETE' });
      if (res.ok) {
        const data = await res.json();
        toast.success(data.softDeactivated ? 'تم تعطيل النوع (يستخدم في مسيرات سابقة)' : 'تم حذف نوع البدل');
        fetchTypes();
      } else {
        const err = await res.json();
        toast.error(err.error || 'فشل الحذف');
      }
    } catch {
      toast.error('فشل الاتصال');
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
            <div>
              <h3 className="font-semibold">أنواع البدلات والخصومات</h3>
              <p className="text-xs text-muted-foreground">قوالب البدلات لكل فرع — تُستخدم تلقائياً عند إنشاء المسير</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="icon" onClick={fetchTypes} disabled={loading}>
                <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
              </Button>
              {types.length === 0 && defaults.length > 0 && (
                <Button variant="outline" onClick={handleCreateDefaults} disabled={creatingDefaults}>
                  {creatingDefaults ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                  إنشاء البدلات الافتراضية ({defaults.length})
                </Button>
              )}
              <Button onClick={() => { setEditing(null); setDialogOpen(true); }}>
                <Plus className="size-4" /> إضافة نوع بدل
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>
          ) : types.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center gap-3">
              <Layers className="size-10 text-muted-foreground/50" />
              <div>
                <p className="text-sm text-muted-foreground">لا توجد أنواع بدلات لهذا الفرع.</p>
                {defaults.length > 0 && (
                  <p className="text-xs text-muted-foreground mt-1">يمكن إنشاء 8 بدلات افتراضية بضغطة واحدة.</p>
                )}
              </div>
              {defaults.length > 0 && (
                <Button onClick={handleCreateDefaults} disabled={creatingDefaults}>
                  {creatingDefaults ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                  إنشاء البدلات الافتراضية
                </Button>
              )}
            </div>
          ) : (
            <div className="max-h-[65vh] overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>الكود</TableHead>
                    <TableHead>الاسم</TableHead>
                    <TableHead>التصنيف</TableHead>
                    <TableHead className="text-center">نسبة؟</TableHead>
                    <TableHead className="text-left">القيمة الافتراضية</TableHead>
                    <TableHead className="text-center">متكرر</TableHead>
                    <TableHead className="text-center">نشط</TableHead>
                    <TableHead className="text-center">الموظفون</TableHead>
                    <TableHead className="text-center">إجراءات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {types.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell className="font-mono text-xs">{t.code}</TableCell>
                      <TableCell>
                        <div className="font-medium">{t.name}</div>
                        {t.nameEn && <div className="text-xs text-muted-foreground">{t.nameEn}</div>}
                      </TableCell>
                      <TableCell>
                        {t.category === 'ALLOWANCE'
                          ? <Badge className="bg-green-600 text-white hover:bg-green-600">بدل</Badge>
                          : <Badge className="bg-red-500 text-white hover:bg-red-500">خصم</Badge>}
                      </TableCell>
                      <TableCell className="text-center">
                        {t.isPercentage ? <Badge variant="outline">%</Badge> : <span className="text-xs text-muted-foreground">قيمة</span>}
                      </TableCell>
                      <TableCell className="text-left font-mono">
                        {t.isPercentage ? `${t.defaultAmount}%` : formatMoney(t.defaultAmount)}
                      </TableCell>
                      <TableCell className="text-center">
                        {t.isRecurring ? <Badge variant="outline" className="text-green-700">نعم</Badge> : <span className="text-xs text-muted-foreground">لا</span>}
                      </TableCell>
                      <TableCell className="text-center">
                        {t.isActive ? <Badge className="bg-green-600 text-white hover:bg-green-600">نشط</Badge> : <Badge variant="outline">موقوف</Badge>}
                      </TableCell>
                      <TableCell className="text-center text-sm">{t.employeeCount || 0}</TableCell>
                      <TableCell>
                        <div className="flex items-center justify-center gap-1">
                          <Button variant="ghost" size="icon" onClick={() => { setEditing(t); setDialogOpen(true); }} title="تعديل">
                            <Pencil className="size-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => handleDelete(t)} title="حذف">
                            <Trash2 className="size-4 text-red-500" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <AllowanceTypeDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
        branches={branches}
        defaultBranchId={selectedBranchId !== 'all' ? selectedBranchId : undefined}
        submitting={submitting}
        onSubmit={async (data) => {
          setSubmitting(true);
          try {
            const url = editing ? `/api/payroll/allowances/${editing.id}` : '/api/payroll/allowances';
            const method = editing ? 'PUT' : 'POST';
            const res = await fetch(url, {
              method,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(data),
            });
            if (res.ok) {
              toast.success(editing ? 'تم تعديل نوع البدل' : 'تم إضافة نوع البدل');
              setDialogOpen(false);
              fetchTypes();
            } else {
              const err = await res.json();
              toast.error(err.error || 'فشل العملية');
            }
          } catch {
            toast.error('فشل الاتصال');
          } finally {
            setSubmitting(false);
          }
        }}
      />
    </div>
  );
}

function AllowanceTypeDialog({
  open, onOpenChange, editing, branches, defaultBranchId, onSubmit, submitting,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: AllowanceType | null;
  branches: Branch[];
  defaultBranchId?: string;
  onSubmit: (data: any) => void;
  submitting: boolean;
}) {
  const [form, setForm] = useState<any>({
    code: '',
    name: '',
    nameEn: '',
    category: 'ALLOWANCE',
    isPercentage: false,
    defaultAmount: 0,
    isRecurring: true,
    isActive: true,
    branchId: '',
  });

  useEffect(() => {
    if (editing) {
      setForm({
        code: editing.code,
        name: editing.name,
        nameEn: editing.nameEn || '',
        category: editing.category,
        isPercentage: editing.isPercentage,
        defaultAmount: editing.defaultAmount,
        isRecurring: editing.isRecurring,
        isActive: editing.isActive,
        branchId: editing.branchId,
      });
    } else {
      setForm({
        code: '',
        name: '',
        nameEn: '',
        category: 'ALLOWANCE',
        isPercentage: false,
        defaultAmount: 0,
        isRecurring: true,
        isActive: true,
        branchId: defaultBranchId || branches[0]?.id || '',
      });
    }
  }, [editing, open, defaultBranchId, branches]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.code.trim()) { toast.error('الكود مطلوب'); return; }
    if (!form.name.trim()) { toast.error('الاسم مطلوب'); return; }
    if (!form.branchId) { toast.error('الفرع مطلوب'); return; }
    onSubmit({ ...form, code: form.code.trim().toUpperCase() });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? 'تعديل نوع بدل' : 'إضافة نوع بدل جديد'}</DialogTitle>
          <DialogDescription>{editing ? `تعديل: ${editing.name}` : 'أنشئ قالب بدل يمكن إعادة استخدامه لكل الموظفين'}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>الكود *</Label>
              <Input
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                placeholder="مثل: HOUSING"
                className="font-mono"
                disabled={!!editing}
                required
              />
            </div>
            <div className="space-y-2">
              <Label>التصنيف *</Label>
              <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALLOWANCE">بدل (إضافة)</SelectItem>
                  <SelectItem value="DEDUCTION">خصم (طرح)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>الاسم (عربي) *</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </div>
            <div className="space-y-2">
              <Label>الاسم (إنجليزي)</Label>
              <Input value={form.nameEn} onChange={(e) => setForm({ ...form, nameEn: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>الفرع *</Label>
              <Select value={form.branchId} onValueChange={(v) => setForm({ ...form, branchId: v })} disabled={!!editing}>
                <SelectTrigger><SelectValue placeholder="اختر الفرع" /></SelectTrigger>
                <SelectContent>
                  {branches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.nameEn || b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>القيمة الافتراضية {form.isPercentage ? '(%)' : ''}</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={form.defaultAmount}
                onChange={(e) => setForm({ ...form, defaultAmount: Number(e.target.value) })}
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3 rounded-md border p-3">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-xs">نسبة مئوية</Label>
              <Switch checked={form.isPercentage} onCheckedChange={(v) => setForm({ ...form, isPercentage: v })} />
            </div>
            <div className="flex items-center justify-between gap-2">
              <Label className="text-xs">متكرر شهرياً</Label>
              <Switch checked={form.isRecurring} onCheckedChange={(v) => setForm({ ...form, isRecurring: v })} />
            </div>
            <div className="flex items-center justify-between gap-2">
              <Label className="text-xs">نشط</Label>
              <Switch checked={form.isActive} onCheckedChange={(v) => setForm({ ...form, isActive: v })} />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button>
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="size-4 animate-spin" />}
              {editing ? 'حفظ التعديلات' : 'إضافة'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EmployeeAllowancesSection({ branches, selectedBranchId }: { branches: Branch[]; selectedBranchId: string }) {
  const [allowances, setAllowances] = useState<EmployeeAllowance[]>([]);
  const [types, setTypes] = useState<AllowanceType[]>([]);
  const [employees, setEmployees] = useState<EmployeeLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const empParams = new URLSearchParams();
      if (selectedBranchId !== 'all') empParams.set('branchId', selectedBranchId);
      empParams.set('pageSize', '500');
      const [eaRes, typesRes] = await Promise.all([
        fetch(`/api/payroll/employee-allowances?${empParams}`),
        fetch(`/api/payroll/allowances?${empParams}`),
      ]);
      if (eaRes.ok) {
        const data = await eaRes.json();
        setAllowances(data.allowances || []);
      }
      if (typesRes.ok) {
        const data = await typesRes.json();
        setTypes(data.types || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [selectedBranchId]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  useEffect(() => {
    if (dialogOpen) {
      fetchEmployees(selectedBranchId, 'ACTIVE').then(setEmployees);
    }
  }, [dialogOpen, selectedBranchId]);

  const handleDelete = async (a: EmployeeAllowance) => {
    if (!confirm(`حذف بدل "${a.allowanceTypeName}" من الموظف "${a.employeeName}"؟`)) return;
    try {
      const res = await fetch(`/api/payroll/employee-allowances/${a.id}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success('تم حذف البدل');
        fetchAll();
      } else {
        const err = await res.json();
        toast.error(err.error || 'فشل الحذف');
      }
    } catch {
      toast.error('فشل الاتصال');
    }
  };

  const handleToggleActive = async (a: EmployeeAllowance) => {
    try {
      const res = await fetch(`/api/payroll/employee-allowances/${a.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !a.isActive, amount: a.amount }),
      });
      if (res.ok) {
        toast.success(a.isActive ? 'تم تعطيل البدل' : 'تم تفعيل البدل');
        fetchAll();
      } else {
        const err = await res.json();
        toast.error(err.error || 'فشل التحديث');
      }
    } catch {
      toast.error('فشل الاتصال');
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold">بدلات الموظفين المتكررة</h3>
              <p className="text-xs text-muted-foreground">البدلات الثابتة التي تُطبق تلقائياً في كل مسير رواتب</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="icon" onClick={fetchAll} disabled={loading}>
                <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
              </Button>
              <Button onClick={() => setDialogOpen(true)} disabled={types.length === 0}>
                <Plus className="size-4" /> إسناد بدل لموظف
              </Button>
            </div>
          </div>
          {types.length === 0 && (
            <p className="text-xs text-amber-700 mt-2 flex items-center gap-1">
              <AlertTriangle className="size-3.5" /> لا توجد أنواع بدلات لهذا الفرع — أنشئ الأنواع أولاً من تبويب "أنواع البدلات".
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>
          ) : allowances.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center gap-2">
              <Layers className="size-10 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">لا توجد بدلات مسندة للموظفين.</p>
            </div>
          ) : (
            <div className="max-h-[65vh] overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>الموظف</TableHead>
                    <TableHead>البدل</TableHead>
                    <TableHead>التصنيف</TableHead>
                    <TableHead className="text-left">المبلغ</TableHead>
                    <TableHead>ساري من</TableHead>
                    <TableHead>ساري إلى</TableHead>
                    <TableHead className="text-center">الحالة</TableHead>
                    <TableHead className="text-center">إجراءات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {allowances.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell>
                        <div className="font-medium">{a.employeeName}</div>
                        <div className="text-xs text-muted-foreground">{a.employeeCode}</div>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{a.allowanceTypeName}</div>
                        <div className="text-xs text-muted-foreground font-mono">{a.allowanceTypeCode}</div>
                      </TableCell>
                      <TableCell>
                        {a.category === 'DEDUCTION'
                          ? <Badge className="bg-red-500 text-white hover:bg-red-500">خصم</Badge>
                          : <Badge className="bg-green-600 text-white hover:bg-green-600">بدل</Badge>}
                      </TableCell>
                      <TableCell className="text-left font-mono">
                        {a.isPercentage ? `${a.amount}%` : formatMoney(a.amount)}
                      </TableCell>
                      <TableCell className="text-xs">{formatDate(a.effectiveFrom)}</TableCell>
                      <TableCell className="text-xs">{a.effectiveTo ? formatDate(a.effectiveTo) : '—'}</TableCell>
                      <TableCell className="text-center">
                        <Switch checked={a.isActive} onCheckedChange={() => handleToggleActive(a)} />
                      </TableCell>
                      <TableCell className="text-center">
                        <Button variant="ghost" size="icon" onClick={() => handleDelete(a)} title="حذف">
                          <Trash2 className="size-4 text-red-500" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <AssignEmployeeAllowanceDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        employees={employees}
        types={types}
        submitting={submitting}
        onSubmit={async (data) => {
          setSubmitting(true);
          try {
            const res = await fetch('/api/payroll/employee-allowances', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(data),
            });
            if (res.ok) {
              toast.success('تم إسناد البدل للموظف');
              setDialogOpen(false);
              fetchAll();
            } else {
              const err = await res.json();
              toast.error(err.error || 'فشل الإسناد');
            }
          } catch {
            toast.error('فشل الاتصال');
          } finally {
            setSubmitting(false);
          }
        }}
      />
    </div>
  );
}

function AssignEmployeeAllowanceDialog({
  open, onOpenChange, employees, types, onSubmit, submitting,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  employees: EmployeeLite[];
  types: AllowanceType[];
  onSubmit: (data: any) => void;
  submitting: boolean;
}) {
  const [form, setForm] = useState<any>({
    employeeId: '',
    allowanceTypeId: '',
    amount: 0,
    effectiveFrom: new Date().toISOString().split('T')[0],
    effectiveTo: '',
    notes: '',
  });

  useEffect(() => {
    if (open) {
      setForm({
        employeeId: employees[0]?.id || '',
        allowanceTypeId: types[0]?.id || '',
        amount: types[0]?.defaultAmount || 0,
        effectiveFrom: new Date().toISOString().split('T')[0],
        effectiveTo: '',
        notes: '',
      });
    }
  }, [open, employees, types]);

  // Auto-fill amount when type changes
  const selectedType = types.find((t) => t.id === form.allowanceTypeId);
  useEffect(() => {
    if (selectedType && open) {
      setForm((prev: any) => ({ ...prev, amount: selectedType.defaultAmount }));
    }
  }, [form.allowanceTypeId]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.employeeId) { toast.error('اختر الموظف'); return; }
    if (!form.allowanceTypeId) { toast.error('اختر نوع البدل'); return; }
    onSubmit(form);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>إسناد بدل متكرر لموظف</DialogTitle>
          <DialogDescription>سيُطبق هذا البدل تلقائياً في كل مسير رواتب للموظف المحدد</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>الموظف *</Label>
            <Select value={form.employeeId} onValueChange={(v) => setForm({ ...form, employeeId: v })}>
              <SelectTrigger><SelectValue placeholder="اختر الموظف" /></SelectTrigger>
              <SelectContent>
                {employees.map((emp) => (
                  <SelectItem key={emp.id} value={emp.id}>
                    {emp.name} ({emp.code}) — {emp.branchNameEn || emp.branchName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>نوع البدل *</Label>
            <Select value={form.allowanceTypeId} onValueChange={(v) => setForm({ ...form, allowanceTypeId: v })}>
              <SelectTrigger><SelectValue placeholder="اختر نوع البدل" /></SelectTrigger>
              <SelectContent>
                {types.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name} ({t.code}) — {t.category === 'DEDUCTION' ? 'خصم' : 'بدل'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>المبلغ {selectedType?.isPercentage ? '(%)' : ''} *</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label>ساري من</Label>
              <Input type="date" value={form.effectiveFrom} onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>ساري إلى (اختياري)</Label>
            <Input type="date" value={form.effectiveTo} onChange={(e) => setForm({ ...form, effectiveTo: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>ملاحظات</Label>
            <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button>
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="size-4 animate-spin" />}
              إسناد البدل
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ════════════════════════════════════════════════════════════════════
// 2) LEAVES TAB
// ════════════════════════════════════════════════════════════════════

interface Leave {
  id: string;
  employeeId: string;
  employeeCode?: string;
  employeeName?: string;
  employeeNameEn?: string;
  employeePosition?: string;
  type: 'ANNUAL' | 'SICK' | 'UNPAID' | 'MATERNITY' | 'HAJJ' | 'EMERGENCY';
  startDate: string;
  endDate: string;
  days: number;
  isPaid: boolean;
  reason?: string;
  status: string;
  createdAt: string;
}

const LEAVE_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  ANNUAL: { label: 'سنوية', color: 'bg-green-600' },
  SICK: { label: 'مرضية', color: 'bg-amber-500' },
  UNPAID: { label: 'بدون أجر', color: 'bg-gray-500' },
  MATERNITY: { label: 'وضع', color: 'bg-pink-500' },
  HAJJ: { label: 'حج', color: 'bg-teal-600' },
  EMERGENCY: { label: 'طارئة', color: 'bg-red-500' },
};

export function LeavesTab({ branches, selectedBranchId }: { branches: Branch[]; selectedBranchId: string }) {
  const [leaves, setLeaves] = useState<Leave[]>([]);
  const [employees, setEmployees] = useState<EmployeeLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [filters, setFilters] = useState({
    employeeId: 'all',
    type: 'all',
    status: 'all',
    dateFrom: '',
    dateTo: '',
  });

  const fetchLeaves = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedBranchId !== 'all') params.set('branchId', selectedBranchId);
      if (filters.employeeId !== 'all') params.set('employeeId', filters.employeeId);
      if (filters.type !== 'all') params.set('type', filters.type);
      if (filters.status !== 'all') params.set('status', filters.status);
      if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
      if (filters.dateTo) params.set('dateTo', filters.dateTo);
      params.set('pageSize', '200');
      const res = await fetch(`/api/payroll/leaves?${params}`);
      if (res.ok) {
        const data = await res.json();
        setLeaves(data.leaves || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [selectedBranchId, filters]);

  useEffect(() => { fetchLeaves(); }, [fetchLeaves]);
  useEffect(() => { fetchEmployees(selectedBranchId, 'ACTIVE').then(setEmployees); }, [selectedBranchId]);

  const handleDelete = async (l: Leave) => {
    if (!confirm(`حذف إجازة "${l.employeeName}" (${l.days} يوم)؟`)) return;
    try {
      const res = await fetch(`/api/payroll/leaves/${l.id}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success('تم حذف الإجازة');
        fetchLeaves();
      } else {
        const err = await res.json();
        toast.error(err.error || 'فشل الحذف');
      }
    } catch {
      toast.error('فشل الاتصال');
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row gap-3">
            <Select value={filters.employeeId} onValueChange={(v) => setFilters({ ...filters, employeeId: v })}>
              <SelectTrigger className="w-full md:w-[180px]"><SelectValue placeholder="كل الموظفين" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الموظفين</SelectItem>
                {employees.map((emp) => (
                  <SelectItem key={emp.id} value={emp.id}>{emp.name} ({emp.code})</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filters.type} onValueChange={(v) => setFilters({ ...filters, type: v })}>
              <SelectTrigger className="w-full md:w-[140px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الأنواع</SelectItem>
                {Object.entries(LEAVE_TYPE_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filters.status} onValueChange={(v) => setFilters({ ...filters, status: v })}>
              <SelectTrigger className="w-full md:w-[140px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الحالات</SelectItem>
                <SelectItem value="PENDING">معلق</SelectItem>
                <SelectItem value="APPROVED">معتمد</SelectItem>
                <SelectItem value="REJECTED">مرفوض</SelectItem>
              </SelectContent>
            </Select>
            <Input type="date" value={filters.dateFrom} onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value })} className="w-full md:w-[150px]" />
            <Input type="date" value={filters.dateTo} onChange={(e) => setFilters({ ...filters, dateTo: e.target.value })} className="w-full md:w-[150px]" />
            <Button variant="outline" size="icon" onClick={fetchLeaves} disabled={loading}>
              <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
            <Button onClick={() => setDialogOpen(true)}>
              <Plus className="size-4" /> إضافة إجازة
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>
          ) : leaves.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center gap-2">
              <CalendarDays className="size-10 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">لا توجد إجازات. اضغط "إضافة إجازة" للبدء.</p>
            </div>
          ) : (
            <div className="max-h-[65vh] overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>الموظف</TableHead>
                    <TableHead>النوع</TableHead>
                    <TableHead>من</TableHead>
                    <TableHead>إلى</TableHead>
                    <TableHead className="text-center">الأيام</TableHead>
                    <TableHead className="text-center">مدفوعة؟</TableHead>
                    <TableHead>السبب</TableHead>
                    <TableHead>الحالة</TableHead>
                    <TableHead className="text-center">إجراء</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {leaves.map((l) => {
                    const typeInfo = LEAVE_TYPE_LABELS[l.type] || { label: l.type, color: 'bg-gray-400' };
                    return (
                      <TableRow key={l.id}>
                        <TableCell>
                          <div className="font-medium">{l.employeeName}</div>
                          <div className="text-xs text-muted-foreground">{l.employeeCode} · {l.employeePosition || '—'}</div>
                        </TableCell>
                        <TableCell><Badge className={`${typeInfo.color} text-white hover:${typeInfo.color}`}>{typeInfo.label}</Badge></TableCell>
                        <TableCell className="text-xs">{formatDate(l.startDate)}</TableCell>
                        <TableCell className="text-xs">{formatDate(l.endDate)}</TableCell>
                        <TableCell className="text-center font-mono">{l.days}</TableCell>
                        <TableCell className="text-center">
                          {l.isPaid
                            ? <Badge className="bg-green-600 text-white hover:bg-green-600">مدفوعة</Badge>
                            : <Badge className="bg-red-500 text-white hover:bg-red-500">بدون أجر</Badge>}
                        </TableCell>
                        <TableCell className="text-sm max-w-[200px] truncate" title={l.reason || ''}>{l.reason || '—'}</TableCell>
                        <TableCell>
                          {l.status === 'APPROVED'
                            ? <Badge className="bg-green-600 text-white hover:bg-green-600">معتمد</Badge>
                            : l.status === 'PENDING'
                            ? <Badge className="bg-amber-500 text-white hover:bg-amber-500">معلق</Badge>
                            : l.status === 'REJECTED'
                            ? <Badge className="bg-red-500 text-white hover:bg-red-500">مرفوض</Badge>
                            : <Badge variant="outline">{l.status}</Badge>}
                        </TableCell>
                        <TableCell className="text-center">
                          <Button variant="ghost" size="icon" onClick={() => handleDelete(l)} title="حذف">
                            <Trash2 className="size-4 text-red-500" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <LeaveDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        employees={employees}
        submitting={submitting}
        onSubmit={async (data) => {
          setSubmitting(true);
          try {
            const res = await fetch('/api/payroll/leaves', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(data),
            });
            if (res.ok) {
              toast.success('تم إضافة الإجازة');
              setDialogOpen(false);
              fetchLeaves();
            } else {
              const err = await res.json();
              toast.error(err.error || 'فشل الإضافة');
            }
          } catch {
            toast.error('فشل الاتصال');
          } finally {
            setSubmitting(false);
          }
        }}
      />
    </div>
  );
}

function LeaveDialog({
  open, onOpenChange, employees, onSubmit, submitting,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  employees: EmployeeLite[];
  onSubmit: (data: any) => void;
  submitting: boolean;
}) {
  const [form, setForm] = useState<any>({
    employeeId: '',
    type: 'ANNUAL',
    startDate: new Date().toISOString().split('T')[0],
    endDate: new Date().toISOString().split('T')[0],
    isPaid: true,
    reason: '',
    status: 'APPROVED',
  });

  useEffect(() => {
    if (open) {
      setForm({
        employeeId: employees[0]?.id || '',
        type: 'ANNUAL',
        startDate: new Date().toISOString().split('T')[0],
        endDate: new Date().toISOString().split('T')[0],
        isPaid: true,
        reason: '',
        status: 'APPROVED',
      });
    }
  }, [open, employees]);

  // Auto-compute days preview
  const days = useMemo(() => {
    if (!form.startDate || !form.endDate) return 0;
    const s = new Date(form.startDate);
    const e = new Date(form.endDate);
    if (e < s) return 0;
    return Math.round((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  }, [form.startDate, form.endDate]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.employeeId) { toast.error('اختر الموظف'); return; }
    if (!form.startDate || !form.endDate) { toast.error('التواريخ مطلوبة'); return; }
    if (new Date(form.endDate) < new Date(form.startDate)) {
      toast.error('تاريخ النهاية يجب أن يكون بعد البداية'); return;
    }
    onSubmit(form);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>إضافة إجازة</DialogTitle>
          <DialogDescription>سيتم احتساب عدد الأيام تلقائياً من التواريخ</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>الموظف *</Label>
            <Select value={form.employeeId} onValueChange={(v) => setForm({ ...form, employeeId: v })}>
              <SelectTrigger><SelectValue placeholder="اختر الموظف" /></SelectTrigger>
              <SelectContent>
                {employees.map((emp) => (
                  <SelectItem key={emp.id} value={emp.id}>
                    {emp.name} ({emp.code}) — {emp.branchNameEn || emp.branchName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>نوع الإجازة *</Label>
              <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(LEAVE_TYPE_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>الحالة</Label>
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="APPROVED">معتمد</SelectItem>
                  <SelectItem value="PENDING">معلق</SelectItem>
                  <SelectItem value="REJECTED">مرفوض</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>من تاريخ *</Label>
              <Input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} required />
            </div>
            <div className="space-y-2">
              <Label>إلى تاريخ *</Label>
              <Input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} required />
            </div>
          </div>
          <div className="flex items-center justify-between rounded-md border p-3">
            <div className="flex items-center gap-2">
              <Label>إجازة مدفوعة الأجر؟</Label>
              <span className="text-xs text-muted-foreground">(تُخصم من راتب الموظف إن "لا")</span>
            </div>
            <Switch checked={form.isPaid} onCheckedChange={(v) => setForm({ ...form, isPaid: v })} />
          </div>
          <div className="rounded-md bg-muted/40 p-2 text-sm text-center">
            عدد الأيام المحتسبة: <span className="font-bold font-mono">{days}</span>
          </div>
          <div className="space-y-2">
            <Label>السبب</Label>
            <Textarea value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} rows={2} placeholder="مثل: إجازة سنوية، ظرف عائلي..." />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button>
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="size-4 animate-spin" />}
              إضافة الإجازة
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ════════════════════════════════════════════════════════════════════
// 3) ATTENDANCE TAB
// ════════════════════════════════════════════════════════════════════

interface AttendanceRecord {
  id: string;
  employeeId: string;
  employeeCode?: string;
  employeeName?: string;
  employeeNameEn?: string;
  employeePosition?: string;
  date: string;
  status: 'PRESENT' | 'ABSENT' | 'LATE' | 'HALF_DAY' | 'OFF';
  checkIn: string | null;
  checkOut: string | null;
  workHours: number;
  lateHours: number;
  overtimeHours: number;
  notes?: string;
}

const ATTENDANCE_STATUS_LABELS: Record<string, { label: string; color: string }> = {
  PRESENT: { label: 'حاضر', color: 'bg-green-600' },
  ABSENT: { label: 'غائب', color: 'bg-red-500' },
  LATE: { label: 'متأخر', color: 'bg-amber-500' },
  HALF_DAY: { label: 'نصف يوم', color: 'bg-purple-500' },
  OFF: { label: 'إجازة', color: 'bg-gray-400' },
};

export function AttendanceTab({ branches, selectedBranchId }: { branches: Branch[]; selectedBranchId: string }) {
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [employees, setEmployees] = useState<EmployeeLite[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [filters, setFilters] = useState({
    employeeId: 'all',
    status: 'all',
    dateFrom: '',
    dateTo: '',
  });

  const fetchAttendance = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedBranchId !== 'all') params.set('branchId', selectedBranchId);
      if (filters.employeeId !== 'all') params.set('employeeId', filters.employeeId);
      if (filters.status !== 'all') params.set('status', filters.status);
      if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
      if (filters.dateTo) params.set('dateTo', filters.dateTo);
      params.set('pageSize', '500');
      const res = await fetch(`/api/payroll/attendance?${params}`);
      if (res.ok) {
        const data = await res.json();
        setRecords(data.attendance || []);
        setSummary(data.summary);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [selectedBranchId, filters]);

  useEffect(() => { fetchAttendance(); }, [fetchAttendance]);
  useEffect(() => { fetchEmployees(selectedBranchId, 'ACTIVE').then(setEmployees); }, [selectedBranchId]);

  const handleDelete = async (a: AttendanceRecord) => {
    if (!confirm(`حذف سجل حضور "${a.employeeName}" بتاريخ ${formatDate(a.date)}؟`)) return;
    try {
      const res = await fetch(`/api/payroll/attendance/${a.id}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success('تم حذف السجل');
        fetchAttendance();
      } else {
        const err = await res.json();
        toast.error(err.error || 'فشل الحذف');
      }
    } catch {
      toast.error('فشل الاتصال');
    }
  };

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card><CardContent className="p-4">
            <p className="text-xs text-muted-foreground">عدد السجلات</p>
            <p className="text-lg font-bold">{summary.count}</p>
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <p className="text-xs text-muted-foreground">إجمالي ساعات التأخير</p>
            <p className="text-lg font-bold font-mono text-amber-600">{Number(summary.totalLateHours).toFixed(2)}</p>
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <p className="text-xs text-muted-foreground">إجمالي ساعات الإضافي</p>
            <p className="text-lg font-bold font-mono text-green-600">{Number(summary.totalOvertimeHours).toFixed(2)}</p>
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <p className="text-xs text-muted-foreground">إجمالي ساعات العمل</p>
            <p className="text-lg font-bold font-mono">{Number(summary.totalWorkHours).toFixed(2)}</p>
          </CardContent></Card>
        </div>
      )}

      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row gap-3">
            <Select value={filters.employeeId} onValueChange={(v) => setFilters({ ...filters, employeeId: v })}>
              <SelectTrigger className="w-full md:w-[180px]"><SelectValue placeholder="كل الموظفين" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الموظفين</SelectItem>
                {employees.map((emp) => (
                  <SelectItem key={emp.id} value={emp.id}>{emp.name} ({emp.code})</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filters.status} onValueChange={(v) => setFilters({ ...filters, status: v })}>
              <SelectTrigger className="w-full md:w-[140px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الحالات</SelectItem>
                {Object.entries(ATTENDANCE_STATUS_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input type="date" value={filters.dateFrom} onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value })} className="w-full md:w-[150px]" />
            <Input type="date" value={filters.dateTo} onChange={(e) => setFilters({ ...filters, dateTo: e.target.value })} className="w-full md:w-[150px]" />
            <Button variant="outline" size="icon" onClick={fetchAttendance} disabled={loading}>
              <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
            <Button onClick={() => setDialogOpen(true)}>
              <Plus className="size-4" /> تسجيل حضور
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>
          ) : records.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center gap-2">
              <Clock className="size-10 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">لا توجد سجلات حضور. اضغط "تسجيل حضور" للبدء.</p>
            </div>
          ) : (
            <div className="max-h-[65vh] overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>الموظف</TableHead>
                    <TableHead>التاريخ</TableHead>
                    <TableHead>الحالة</TableHead>
                    <TableHead>دخول</TableHead>
                    <TableHead>خروج</TableHead>
                    <TableHead className="text-center">ساعات عمل</TableHead>
                    <TableHead className="text-center">تأخير</TableHead>
                    <TableHead className="text-center">إضافي</TableHead>
                    <TableHead className="text-center">إجراء</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {records.map((a) => {
                    const info = ATTENDANCE_STATUS_LABELS[a.status] || { label: a.status, color: 'bg-gray-400' };
                    return (
                      <TableRow key={a.id}>
                        <TableCell>
                          <div className="font-medium">{a.employeeName}</div>
                          <div className="text-xs text-muted-foreground">{a.employeeCode} · {a.employeePosition || '—'}</div>
                        </TableCell>
                        <TableCell className="text-xs">{formatDate(a.date)}</TableCell>
                        <TableCell><Badge className={`${info.color} text-white hover:${info.color}`}>{info.label}</Badge></TableCell>
                        <TableCell className="text-xs font-mono">{a.checkIn ? formatDateTime(a.checkIn) : '—'}</TableCell>
                        <TableCell className="text-xs font-mono">{a.checkOut ? formatDateTime(a.checkOut) : '—'}</TableCell>
                        <TableCell className="text-center font-mono">{Number(a.workHours).toFixed(2)}</TableCell>
                        <TableCell className="text-center font-mono text-amber-600">{Number(a.lateHours).toFixed(2)}</TableCell>
                        <TableCell className="text-center font-mono text-green-600">{Number(a.overtimeHours).toFixed(2)}</TableCell>
                        <TableCell className="text-center">
                          <Button variant="ghost" size="icon" onClick={() => handleDelete(a)} title="حذف">
                            <Trash2 className="size-4 text-red-500" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <AttendanceDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        employees={employees}
        submitting={submitting}
        onSubmit={async (data) => {
          setSubmitting(true);
          try {
            const res = await fetch('/api/payroll/attendance', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(data),
            });
            if (res.ok) {
              toast.success('تم تسجيل الحضور (upsert)');
              setDialogOpen(false);
              fetchAttendance();
            } else {
              const err = await res.json();
              toast.error(err.error || 'فشل التسجيل');
            }
          } catch {
            toast.error('فشل الاتصال');
          } finally {
            setSubmitting(false);
          }
        }}
      />
    </div>
  );
}

function AttendanceDialog({
  open, onOpenChange, employees, onSubmit, submitting,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  employees: EmployeeLite[];
  onSubmit: (data: any) => void;
  submitting: boolean;
}) {
  const [form, setForm] = useState<any>({
    employeeId: '',
    date: new Date().toISOString().split('T')[0],
    status: 'PRESENT',
    checkIn: '',
    checkOut: '',
    workHours: 8,
    lateHours: 0,
    overtimeHours: 0,
    notes: '',
  });

  useEffect(() => {
    if (open) {
      setForm({
        employeeId: employees[0]?.id || '',
        date: new Date().toISOString().split('T')[0],
        status: 'PRESENT',
        checkIn: '',
        checkOut: '',
        workHours: 8,
        lateHours: 0,
        overtimeHours: 0,
        notes: '',
      });
    }
  }, [open, employees]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.employeeId) { toast.error('اختر الموظف'); return; }
    if (!form.date) { toast.error('التاريخ مطلوب'); return; }
    onSubmit(form);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>تسجيل حضور موظف</DialogTitle>
          <DialogDescription>إذا كان هناك سجل لنفس الموظف في نفس اليوم، سيتم تحديثه تلقائياً</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>الموظف *</Label>
            <Select value={form.employeeId} onValueChange={(v) => setForm({ ...form, employeeId: v })}>
              <SelectTrigger><SelectValue placeholder="اختر الموظف" /></SelectTrigger>
              <SelectContent>
                {employees.map((emp) => (
                  <SelectItem key={emp.id} value={emp.id}>
                    {emp.name} ({emp.code}) — {emp.branchNameEn || emp.branchName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>التاريخ *</Label>
              <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
            </div>
            <div className="space-y-2">
              <Label>الحالة *</Label>
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(ATTENDANCE_STATUS_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>وقت الدخول</Label>
              <Input type="datetime-local" value={form.checkIn} onChange={(e) => setForm({ ...form, checkIn: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>وقت الخروج</Label>
              <Input type="datetime-local" value={form.checkOut} onChange={(e) => setForm({ ...form, checkOut: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>ساعات العمل</Label>
              <Input type="number" step="0.01" min="0" value={form.workHours} onChange={(e) => setForm({ ...form, workHours: Number(e.target.value) })} />
            </div>
            <div className="space-y-2">
              <Label>ساعات التأخير</Label>
              <Input type="number" step="0.01" min="0" value={form.lateHours} onChange={(e) => setForm({ ...form, lateHours: Number(e.target.value) })} />
            </div>
            <div className="space-y-2">
              <Label>ساعات العمل الإضافي</Label>
              <Input type="number" step="0.01" min="0" value={form.overtimeHours} onChange={(e) => setForm({ ...form, overtimeHours: Number(e.target.value) })} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>ملاحظات</Label>
            <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button>
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="size-4 animate-spin" />}
              تسجيل الحضور
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ════════════════════════════════════════════════════════════════════
// 4) PERIOD LOCKS TAB — THE MOST IMPORTANT TAB
// ════════════════════════════════════════════════════════════════════

interface PeriodLock {
  id: string;
  branchId: string;
  branchName?: string;
  branchNameEn?: string;
  branchCode?: string;
  month: number;
  year: number;
  lockedAt: string;
  lockedBy: string;
  lockedByName?: string;
  reason?: string;
  unlockedAt: string | null;
  unlockedBy?: string;
  unlockedByName?: string;
  unlockReason?: string;
  isActive: boolean;
}

export function PeriodLocksTab({ branches, selectedBranchId }: { branches: Branch[]; selectedBranchId: string }) {
  const [locks, setLocks] = useState<PeriodLock[]>([]);
  const [loading, setLoading] = useState(true);
  const [lockDialogOpen, setLockDialogOpen] = useState(false);
  const [unlockTarget, setUnlockTarget] = useState<PeriodLock | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const user = useAppStore((s) => s.user);
  const isAdmin = user?.role === 'ADMIN';

  const fetchLocks = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedBranchId !== 'all') params.set('branchId', selectedBranchId);
      params.set('pageSize', '200');
      const res = await fetch(`/api/payroll/period-locks?${params}`);
      if (res.ok) {
        const data = await res.json();
        setLocks(data.locks || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [selectedBranchId]);

  useEffect(() => { fetchLocks(); }, [fetchLocks]);

  const handleLock = async (data: any) => {
    setSubmitting(true);
    try {
      const res = await fetch('/api/payroll/period-locks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        toast.success('تم إقفال الفترة بنجاح');
        setLockDialogOpen(false);
        fetchLocks();
      } else {
        const err = await res.json();
        toast.error(err.error || 'فشل الإقفال');
      }
    } catch {
      toast.error('فشل الاتصال');
    } finally {
      setSubmitting(false);
    }
  };

  const handleUnlock = async (lock: PeriodLock, reason: string) => {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/payroll/period-locks/${lock.id}/unlock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      if (res.ok) {
        toast.success('تمت إعادة فتح الفترة — تم تسجيل العملية كحرجة (CRITICAL)');
        setUnlockTarget(null);
        fetchLocks();
      } else {
        const err = await res.json();
        toast.error(err.error || 'فشل إعادة الفتح');
      }
    } catch {
      toast.error('فشل الاتصال');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (lock: PeriodLock) => {
    if (!confirm(`حذف سجل قفل فترة ${lock.month}/${lock.year} نهائياً؟ يُفضّل استخدام "إعادة فتح" للحفاظ على السجل التدقيقي.`)) return;
    try {
      const res = await fetch(`/api/payroll/period-locks/${lock.id}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success('تم حذف السجل');
        fetchLocks();
      } else {
        const err = await res.json();
        toast.error(err.error || 'فشل الحذف');
      }
    } catch {
      toast.error('فشل الاتصال');
    }
  };

  return (
    <div className="space-y-4">
      {/* Warning banner */}
      <Card className="border-amber-300 bg-amber-50">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <ShieldAlert className="size-5 text-amber-700 mt-0.5 shrink-0" />
            <div className="text-sm">
              <p className="font-bold text-amber-900">إقفال الفترات يحمي بيانات الرواتب من التعديل</p>
              <p className="text-amber-800 mt-1">
                عند إقفال فترة (فرع + شهر + سنة)، تُحظر جميع عمليات الرواتب: إنشاء، تعديل، اعتماد، إلغاء، ودفع.
                إعادة الفتح تتطلب صلاحية مدير النظام (ADMIN) وتُسجَّل كعملية حرجة (CRITICAL) في سجل التدقيق.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold">أقفال فترات الرواتب</h3>
              <p className="text-xs text-muted-foreground">{locks.filter(l => l.isActive).length} فترة مقفلة نشطة من إجمالي {locks.length} سجل</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="icon" onClick={fetchLocks} disabled={loading}>
                <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
              </Button>
              {isAdmin ? (
                <Button onClick={() => setLockDialogOpen(true)} className="bg-red-600 hover:bg-red-700">
                  <Lock className="size-4" /> إقفال فترة جديدة
                </Button>
              ) : (
                <Badge variant="outline" className="text-amber-700">إقفال/فتح الفترات يتطلب صلاحية ADMIN</Badge>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>
          ) : locks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center gap-2">
              <Lock className="size-10 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">لا توجد أقفال فترات. كل الفترات مفتوحة للتعديل.</p>
            </div>
          ) : (
            <div className="max-h-[65vh] overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>الفرع</TableHead>
                    <TableHead>الفترة</TableHead>
                    <TableHead>إقفال بتاريخ</TableHead>
                    <TableHead>أقفل بواسطة</TableHead>
                    <TableHead>السبب</TableHead>
                    <TableHead>الحالة</TableHead>
                    <TableHead>إعادة الفتح</TableHead>
                    <TableHead className="text-center">إجراءات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {locks.map((l) => (
                    <TableRow key={l.id} className={l.isActive ? '' : 'opacity-60'}>
                      <TableCell className="text-sm">
                        <div className="font-medium">{l.branchNameEn || l.branchName}</div>
                        <div className="text-xs text-muted-foreground font-mono">{l.branchCode}</div>
                      </TableCell>
                      <TableCell className="font-medium">{MONTHS_AR[l.month - 1]} {l.year}</TableCell>
                      <TableCell className="text-xs">{formatDateTime(l.lockedAt)}</TableCell>
                      <TableCell className="text-sm">{l.lockedByName || '—'}</TableCell>
                      <TableCell className="text-sm max-w-[200px] truncate" title={l.reason || ''}>{l.reason || '—'}</TableCell>
                      <TableCell>
                        {l.isActive
                          ? <Badge className="bg-red-500 text-white hover:bg-red-500"><Lock className="size-3 ml-1" /> مقفلة</Badge>
                          : <Badge className="bg-green-600 text-white hover:bg-green-600"><LockOpen className="size-3 ml-1" /> مفتوحة</Badge>}
                      </TableCell>
                      <TableCell className="text-xs">
                        {l.unlockedAt ? (
                          <>
                            <div>{formatDateTime(l.unlockedAt)}</div>
                            <div className="text-muted-foreground">{l.unlockedByName || '—'}</div>
                            <div className="text-muted-foreground text-xs max-w-[160px] truncate" title={l.unlockReason || ''}>
                              السبب: {l.unlockReason || '—'}
                            </div>
                          </>
                        ) : '—'}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-center gap-1">
                          {isAdmin && l.isActive && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setUnlockTarget(l)}
                              className="text-amber-700 border-amber-300 hover:bg-amber-50"
                              title="إعادة فتح الفترة (تتطلب سبباً)"
                            >
                              <LockOpen className="size-4" /> إعادة فتح
                            </Button>
                          )}
                          {isAdmin && !l.isActive && (
                            <Button variant="ghost" size="icon" onClick={() => handleDelete(l)} title="حذف السجل">
                              <Trash2 className="size-4 text-red-500" />
                            </Button>
                          )}
                          {!isAdmin && (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <LockPeriodDialog
        open={lockDialogOpen}
        onOpenChange={setLockDialogOpen}
        branches={branches}
        defaultBranchId={selectedBranchId !== 'all' ? selectedBranchId : undefined}
        submitting={submitting}
        onSubmit={handleLock}
      />

      <UnlockPeriodDialog
        lock={unlockTarget}
        onOpenChange={(v) => !v && setUnlockTarget(null)}
        submitting={submitting}
        onSubmit={(reason) => unlockTarget && handleUnlock(unlockTarget, reason)}
      />
    </div>
  );
}

function LockPeriodDialog({
  open, onOpenChange, branches, defaultBranchId, onSubmit, submitting,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  branches: Branch[];
  defaultBranchId?: string;
  onSubmit: (data: any) => void;
  submitting: boolean;
}) {
  const now = new Date();
  const [form, setForm] = useState<any>({
    branchId: '',
    month: now.getMonth() + 1,
    year: now.getFullYear(),
    reason: '',
  });

  useEffect(() => {
    if (open) {
      setForm({
        branchId: defaultBranchId || branches[0]?.id || '',
        month: now.getMonth() + 1,
        year: now.getFullYear(),
        reason: '',
      });
    }
  }, [open, defaultBranchId, branches]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.branchId) { toast.error('الفرع مطلوب'); return; }
    if (!form.reason.trim()) { toast.error('السبب مطلوب (للسجل التدقيقي)'); return; }
    onSubmit(form);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-600">
            <Lock className="size-5" /> إقفال فترة رواتب
          </DialogTitle>
          <DialogDescription>
            سيتم منع جميع عمليات الرواتب (إنشاء، تعديل، اعتماد، إلغاء، دفع) لهذه الفترة.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-800 flex items-start gap-2">
            <AlertTriangle className="size-4 mt-0.5 shrink-0" />
            <div>
              <strong>تحذير:</strong> إقفال الفترة يحمي البيانات من التعديل. لإعادة الفتح لاحقاً،
              يجب أن تكون مدير نظام (ADMIN) مع تقديم سبب إلزامي يُسجَّل كعملية حرجة.
            </div>
          </div>
          <div className="space-y-2">
            <Label>الفرع *</Label>
            <Select value={form.branchId} onValueChange={(v) => setForm({ ...form, branchId: v })}>
              <SelectTrigger><SelectValue placeholder="اختر الفرع" /></SelectTrigger>
              <SelectContent>
                {branches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.nameEn || b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>الشهر *</Label>
              <Select value={String(form.month)} onValueChange={(v) => setForm({ ...form, month: Number(v) })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MONTHS_AR.map((m, i) => <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>السنة *</Label>
              <Input type="number" value={form.year} onChange={(e) => setForm({ ...form, year: Number(e.target.value) })} min="2000" max="2100" required />
            </div>
          </div>
          <div className="space-y-2">
            <Label>السبب *</Label>
            <Textarea value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} rows={3} placeholder="مثل: إقفال نهائي بعد دفع الرواتب..." required />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button>
            <Button type="submit" disabled={submitting} className="bg-red-600 hover:bg-red-700">
              {submitting && <Loader2 className="size-4 animate-spin" />}
              <Lock className="size-4" /> تأكيد الإقفال
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function UnlockPeriodDialog({
  lock, onOpenChange, onSubmit, submitting,
}: {
  lock: PeriodLock | null;
  onOpenChange: (v: boolean) => void;
  onSubmit: (reason: string) => void;
  submitting: boolean;
}) {
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (lock) setReason('');
  }, [lock]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) { toast.error('سبب إعادة الفتح مطلوب إلزامياً'); return; }
    onSubmit(reason.trim());
  };

  return (
    <Dialog open={!!lock} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-amber-700">
            <LockOpen className="size-5" /> إعادة فتح فترة رواتب
          </DialogTitle>
          <DialogDescription>
            {lock && (
              <>
                سيتم إعادة فتح فترة <strong>{MONTHS_AR[lock.month - 1]} {lock.year}</strong> للفرع{' '}
                <strong>{lock.branchNameEn || lock.branchName}</strong>.
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 flex items-start gap-2">
            <ShieldAlert className="size-4 mt-0.5 shrink-0" />
            <div>
              <strong>تنبيه أمني:</strong> إعادة فتح فترة مقفلة عملية <strong>حرجة (CRITICAL)</strong>{' '}
              تُسجَّل في سجل التدقيق. تأكد من وجود سبب مشروع لذلك.
            </div>
          </div>
          <div className="space-y-2">
            <Label>سبب إعادة الفتح *</Label>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="مثل: تصحيح خطأ في احتساب ساعات العمل..." required />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>تراجع</Button>
            <Button type="submit" disabled={submitting || !reason.trim()} className="bg-amber-600 hover:bg-amber-700">
              {submitting && <Loader2 className="size-4 animate-spin" />}
              <LockOpen className="size-4" /> تأكيد إعادة الفتح
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ════════════════════════════════════════════════════════════════════
// 5) EMPLOYEE LEDGER TAB
// ════════════════════════════════════════════════════════════════════

interface LedgerEntry {
  id: string;
  date: string;
  type: 'ADVANCE' | 'SALARY' | 'ADVANCE_SETTLEMENT' | 'MANUAL_DEBIT' | 'MANUAL_CREDIT';
  description: string;
  debit: number;
  credit: number;
  balance: number;
  referenceType?: string;
  referenceId?: string;
  journalEntryId?: string;
  createdAt: string;
}

const LEDGER_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  ADVANCE: { label: 'سلفة', color: 'bg-amber-500' },
  SALARY: { label: 'راتب', color: 'bg-green-600' },
  ADVANCE_SETTLEMENT: { label: 'تسوية سلفة', color: 'bg-teal-600' },
  MANUAL_DEBIT: { label: 'قيد مدين', color: 'bg-red-500' },
  MANUAL_CREDIT: { label: 'قيد دائن', color: 'bg-purple-500' },
};

export function EmployeeLedgerTab({ branches, selectedBranchId }: { branches: Branch[]; selectedBranchId: string }) {
  const [employees, setEmployees] = useState<EmployeeLite[]>([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [ledger, setLedger] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const user = useAppStore((s) => s.user);

  useEffect(() => {
    fetchEmployees(selectedBranchId).then((emps) => {
      setEmployees(emps);
      if (emps.length && !selectedEmployeeId) {
        setSelectedEmployeeId(emps[0].id);
      } else if (selectedEmployeeId && !emps.find(e => e.id === selectedEmployeeId)) {
        setSelectedEmployeeId(emps[0]?.id || '');
      }
    });
  }, [selectedBranchId]);

  const fetchLedger = useCallback(async () => {
    if (!selectedEmployeeId) { toast.error('اختر الموظف'); return; }
    setLoading(true);
    try {
      const params = new URLSearchParams({ employeeId: selectedEmployeeId });
      if (dateFrom) params.set('dateFrom', dateFrom);
      if (dateTo) params.set('dateTo', dateTo);
      params.set('pageSize', '500');
      const res = await fetch(`/api/payroll/employee-ledger?${params}`);
      if (res.ok) {
        setLedger(await res.json());
      } else {
        const err = await res.json();
        toast.error(err.error || 'فشل تحميل الكشف');
      }
    } catch {
      toast.error('فشل الاتصال');
    } finally {
      setLoading(false);
    }
  }, [selectedEmployeeId, dateFrom, dateTo]);

  useEffect(() => {
    if (selectedEmployeeId) fetchLedger();
  }, [selectedEmployeeId, dateFrom, dateTo, fetchLedger]);

  const handlePrint = async () => {
    if (!ledger) return;
    const [company, branch] = await Promise.all([
      fetchCompanyInfoForPrint(),
      fetchBranchInfoForPrint(ledger.employee.branchId || ''),
    ]);
    const emp = ledger.employee;
    const s = ledger.summary;

    const entryRows = (ledger.entries || []).map((e: LedgerEntry, i: number) => {
      const typeInfo = LEDGER_TYPE_LABELS[e.type] || { label: e.type, color: '' };
      return `
        <tr>
          <td class="num">${i + 1}</td>
          <td>${formatDate(e.date)}</td>
          <td><span class="badge">${typeInfo.label}</span></td>
          <td style="text-align:right">${escapeHtmlBasic(e.description || '—')}</td>
          <td class="num" style="color:#b91c1c">${e.debit ? formatMoney(e.debit) : '—'}</td>
          <td class="num" style="color:#047857">${e.credit ? formatMoney(e.credit) : '—'}</td>
          <td class="num"><strong>${formatMoney(e.balance)}</strong></td>
        </tr>`;
    }).join('');

    const contentHtml = `
      <div class="section">
        <h3 style="margin:0 0 8px">بيانات الموظف</h3>
        <div class="meta-grid">
          <div><span>الكود:</span> <strong>${emp.code}</strong></div>
          <div><span>الاسم:</span> <strong>${emp.name}</strong></div>
          <div><span>الوظيفة:</span> ${emp.position || '—'}</div>
          <div><span>الفرع:</span> ${branch?.name || '—'}</div>
        </div>
      </div>

      <div class="section">
        <h3 style="margin:0 0 8px">ملخص الحساب</h3>
        <div class="summary-grid cols-3">
          <div class="summary-card">
            <label>إجمالي المدين (سلف مصروفة)</label>
            <div class="value red">${formatMoney(s.totalDebit)}</div>
          </div>
          <div class="summary-card">
            <label>إجمالي الدائن (رواتب + تسويات)</label>
            <div class="value green">${formatMoney(s.totalCredit)}</div>
          </div>
          <div class="summary-card">
            <label>الرصيد الحالي</label>
            <div class="value ${s.closingBalance >= 0 ? 'red' : 'green'}">${formatMoney(s.closingBalance)}</div>
          </div>
        </div>
        <p class="text-sm text-muted">عدد القيود: ${s.entryCount}</p>
      </div>

      ${entryRows ? `
      <div class="section">
        <h3 style="margin:0 0 8px">قيود كشف الحساب</h3>
        <table>
          <thead>
            <tr>
              <th>#</th><th>التاريخ</th><th>النوع</th><th style="text-align:right">البيان</th>
              <th>مدين</th><th>دائن</th><th>الرصيد</th>
            </tr>
          </thead>
          <tbody>${entryRows}</tbody>
        </table>
      </div>` : '<div class="section"><p>لا توجد قيود في هذه الفترة.</p></div>'}

      <div class="section" style="margin-top:30px;display:flex;justify-content:space-between">
        <div>توقيع المدير: ____________________</div>
        <div>توقيع المحاسب: ____________________</div>
        <div>الختم: ____________________</div>
      </div>
    `;

    printReportDocument({
      title: 'كشف حساب موظف',
      titleEn: 'Employee Ledger Statement',
      subtitle: emp.name,
      reportNumber: generateReportNumber('EL'),
      company,
      branch,
      period: { from: dateFrom || 'البداية', to: dateTo || 'اليوم' },
      generatedBy: user?.name || '—',
      contentHtml,
      format: 'A4',
      orientation: 'portrait',
    });
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row gap-3 md:items-end">
            <div className="space-y-1 flex-1 min-w-[200px]">
              <Label className="text-xs">الموظف</Label>
              <Select value={selectedEmployeeId} onValueChange={setSelectedEmployeeId}>
                <SelectTrigger><SelectValue placeholder="اختر الموظف" /></SelectTrigger>
                <SelectContent>
                  {employees.map((emp) => (
                    <SelectItem key={emp.id} value={emp.id}>
                      {emp.name} ({emp.code}) — {emp.branchNameEn || emp.branchName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">من تاريخ</Label>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-40" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">إلى تاريخ</Label>
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-40" />
            </div>
            <Button variant="outline" size="icon" onClick={fetchLedger} disabled={loading || !selectedEmployeeId}>
              <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
            {ledger && (
              <Button variant="outline" onClick={handlePrint} disabled={loading}>
                <Printer className="size-4" /> طباعة / PDF
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {!selectedEmployeeId && (
        <Card><CardContent className="p-12 text-center text-sm text-muted-foreground">
          <BookOpen className="size-10 mx-auto mb-2 text-muted-foreground/50" />
          اختر موظفاً لعرض كشف حسابه.
        </CardContent></Card>
      )}

      {selectedEmployeeId && loading && (
        <Card><CardContent className="p-12 text-center">
          <Loader2 className="size-6 animate-spin text-muted-foreground mx-auto" />
        </CardContent></Card>
      )}

      {ledger && !loading && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card><CardContent className="p-4">
              <p className="text-xs text-muted-foreground">إجمالي المدين (سلف)</p>
              <p className="text-lg font-bold font-mono text-red-600">{formatMoney(ledger.summary.totalDebit)}</p>
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <p className="text-xs text-muted-foreground">إجمالي الدائن (رواتب)</p>
              <p className="text-lg font-bold font-mono text-green-600">{formatMoney(ledger.summary.totalCredit)}</p>
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <p className="text-xs text-muted-foreground">الرصيد الحالي</p>
              <p className={`text-lg font-bold font-mono ${ledger.summary.closingBalance >= 0 ? 'text-red-600' : 'text-green-600'}`}>
                {formatMoney(ledger.summary.closingBalance)}
              </p>
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <p className="text-xs text-muted-foreground">عدد القيود</p>
              <p className="text-lg font-bold">{ledger.summary.entryCount}</p>
            </CardContent></Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center justify-between">
                <span>قيود كشف الحساب</span>
                <span className="text-xs font-normal text-muted-foreground">
                  {ledger.employee.name} ({ledger.employee.code})
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {ledger.entries?.length ? (
                <div className="max-h-[60vh] overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10">#</TableHead>
                        <TableHead>التاريخ</TableHead>
                        <TableHead>النوع</TableHead>
                        <TableHead>البيان</TableHead>
                        <TableHead className="text-left">مدين</TableHead>
                        <TableHead className="text-left">دائن</TableHead>
                        <TableHead className="text-left">الرصيد</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {ledger.entries.map((e: LedgerEntry, i: number) => {
                        const typeInfo = LEDGER_TYPE_LABELS[e.type] || { label: e.type, color: 'bg-gray-400' };
                        return (
                          <TableRow key={e.id}>
                            <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
                            <TableCell className="text-xs">{formatDate(e.date)}</TableCell>
                            <TableCell><Badge className={`${typeInfo.color} text-white hover:${typeInfo.color}`}>{typeInfo.label}</Badge></TableCell>
                            <TableCell className="text-sm max-w-[280px]">{e.description || '—'}</TableCell>
                            <TableCell className="text-left font-mono text-red-600">{e.debit ? formatMoney(e.debit) : '—'}</TableCell>
                            <TableCell className="text-left font-mono text-green-600">{e.credit ? formatMoney(e.credit) : '—'}</TableCell>
                            <TableCell className="text-left font-mono font-bold">{formatMoney(e.balance)}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="p-6 text-center text-sm text-muted-foreground">لا توجد قيود في هذه الفترة</div>
              )}
            </CardContent>
          </Card>

          <p className="text-xs text-muted-foreground px-2">
            <strong className="text-red-600">مدين</strong> = مبالغ استلمها الموظف كسلف —{' '}
            <strong className="text-green-600">دائن</strong> = رواتب وتسويات تُخصم من رصيد السلف —{' '}
            <strong>الرصيد</strong> = المدين − الدائن (الموجب يعني أن الشركة تستحق على الموظف)
          </p>
        </>
      )}
    </div>
  );
}

// Simple HTML escape for ledger descriptions in print
function escapeHtmlBasic(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ════════════════════════════════════════════════════════════════════
// 6) PAYROLL SETTINGS TAB
// ════════════════════════════════════════════════════════════════════

interface PayrollSettings {
  id?: string;
  branchId: string;
  workingDaysPerMonth: number;
  standardWorkHoursPerDay: number;
  overtimeRateMultiplier: number;
  lateDeductionPerHour: number;
  absenceDeductionPerDay: number;
  gosiEnabled: boolean;
  gosiEmployerRate: number;
  gosiEmployeeRate: number;
  gosiSalaryCap: number;
  isDefault?: boolean;
}

export function PayrollSettingsTab({ branches, selectedBranchId }: { branches: Branch[]; selectedBranchId: string }) {
  const [branchId, setBranchId] = useState<string>(selectedBranchId !== 'all' ? selectedBranchId : (branches[0]?.id || ''));
  const [settings, setSettings] = useState<PayrollSettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (selectedBranchId !== 'all' && selectedBranchId !== branchId) {
      setBranchId(selectedBranchId);
    }
  }, [selectedBranchId]);

  const fetchSettings = useCallback(async () => {
    if (!branchId) { toast.error('اختر فرعاً'); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/payroll/settings?branchId=${branchId}`);
      if (res.ok) {
        setSettings(await res.json());
      } else {
        const err = await res.json();
        toast.error(err.error || 'فشل تحميل الإعدادات');
      }
    } catch {
      toast.error('فشل الاتصال');
    } finally {
      setLoading(false);
    }
  }, [branchId]);

  useEffect(() => { if (branchId) fetchSettings(); }, [branchId, fetchSettings]);

  const handleSave = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      const res = await fetch('/api/payroll/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...settings, branchId }),
      });
      if (res.ok) {
        const updated = await res.json();
        setSettings({ ...settings, ...updated, isDefault: false });
        toast.success('تم حفظ إعدادات الرواتب للفرع');
      } else {
        const err = await res.json();
        toast.error(err.error || 'فشل الحفظ');
      }
    } catch {
      toast.error('فشل الاتصال');
    } finally {
      setSaving(false);
    }
  };

  const update = (key: keyof PayrollSettings, value: any) => {
    if (!settings) return;
    setSettings({ ...settings, [key]: value });
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div className="flex items-center gap-2">
              <SettingsIcon className="size-5 text-primary" />
              <div>
                <h3 className="font-semibold">إعدادات الرواتب للفرع</h3>
                <p className="text-xs text-muted-foreground">تُستخدم تلقائياً عند إنشاء مسيرات الرواتب</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-xs">الفرع:</Label>
              <Select value={branchId} onValueChange={setBranchId}>
                <SelectTrigger className="w-[200px]"><SelectValue placeholder="اختر الفرع" /></SelectTrigger>
                <SelectContent>
                  {branches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.nameEn || b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" size="icon" onClick={fetchSettings} disabled={loading || !branchId}>
                <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {!branchId && (
        <Card><CardContent className="p-12 text-center text-sm text-muted-foreground">
          <SettingsIcon className="size-10 mx-auto mb-2 text-muted-foreground/50" />
          اختر فرعاً لعرض/تعديل الإعدادات.
        </CardContent></Card>
      )}

      {branchId && loading && (
        <Card><CardContent className="p-12 text-center">
          <Loader2 className="size-6 animate-spin text-muted-foreground mx-auto" />
        </CardContent></Card>
      )}

      {branchId && settings && !loading && (
        <>
          {settings.isDefault && (
            <Card className="border-amber-300 bg-amber-50">
              <CardContent className="p-3">
                <p className="text-xs text-amber-800 flex items-center gap-2">
                  <AlertTriangle className="size-4" />
                  هذا الفرع يستخدم الإعدادات الافتراضية. عدّلها ثم احفظ لتخصيصها.
                </p>
              </CardContent>
            </Card>
          )}

          {/* Working Days */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <CalendarDays className="size-4" /> أيام وساعات العمل
              </CardTitle>
              <CardDescription className="text-xs">الإعدادات الأساسية لاحتساب الرواتب الشهرية</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>أيام العمل في الشهر</Label>
                  <Input type="number" min="1" max="31" value={settings.workingDaysPerMonth} onChange={(e) => update('workingDaysPerMonth', Number(e.target.value))} />
                  <p className="text-xs text-muted-foreground">الافتراضي: 30</p>
                </div>
                <div className="space-y-2">
                  <Label>ساعات العمل القياسية / يوم</Label>
                  <Input type="number" step="0.5" min="1" max="24" value={settings.standardWorkHoursPerDay} onChange={(e) => update('standardWorkHoursPerDay', Number(e.target.value))} />
                  <p className="text-xs text-muted-foreground">الافتراضي: 8</p>
                </div>
                <div className="space-y-2">
                  <Label>معامل العمل الإضافي</Label>
                  <Input type="number" step="0.1" min="1" max="3" value={settings.overtimeRateMultiplier} onChange={(e) => update('overtimeRateMultiplier', Number(e.target.value))} />
                  <p className="text-xs text-muted-foreground">الافتراضي: 1.5 (أي 150% من السعر بالساعة)</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Deductions */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <AlertTriangle className="size-4" /> خصومات التأخير والغياب
              </CardTitle>
              <CardDescription className="text-xs">اتركها 0 لاستخدام السعر بالساعة/باليوم تلقائياً</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>خصم التأخير (ريال/ساعة)</Label>
                  <Input type="number" step="0.01" min="0" value={settings.lateDeductionPerHour} onChange={(e) => update('lateDeductionPerHour', Number(e.target.value))} />
                  <p className="text-xs text-muted-foreground">0 = استخدام السعر بالساعة (الراتب / أيام / ساعات)</p>
                </div>
                <div className="space-y-2">
                  <Label>خصم الغياب (ريال/يوم)</Label>
                  <Input type="number" step="0.01" min="0" value={settings.absenceDeductionPerDay} onChange={(e) => update('absenceDeductionPerDay', Number(e.target.value))} />
                  <p className="text-xs text-muted-foreground">0 = استخدام الراتب اليومي (الراتب / أيام العمل)</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* GOSI */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <ShieldAlert className="size-4" /> التأمينات الاجتماعية (GOSI)
              </CardTitle>
              <CardDescription className="text-xs">إعدادات التأمينات السعودية</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <Label>تفعيل خصم GOSI تلقائياً</Label>
                  <p className="text-xs text-muted-foreground">عند التفعيل، سيُخصم من الموظفين تلقائياً في كل مسير</p>
                </div>
                <Switch checked={settings.gosiEnabled} onCheckedChange={(v) => update('gosiEnabled', v)} />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>نسبة اشتراك صاحب العمل (%)</Label>
                  <Input type="number" step="0.01" min="0" max="100" value={settings.gosiEmployerRate} onChange={(e) => update('gosiEmployerRate', Number(e.target.value))} disabled={!settings.gosiEnabled} />
                  <p className="text-xs text-muted-foreground">الافتراضي: 12%</p>
                </div>
                <div className="space-y-2">
                  <Label>نسبة اشتراك الموظف (%)</Label>
                  <Input type="number" step="0.01" min="0" max="100" value={settings.gosiEmployeeRate} onChange={(e) => update('gosiEmployeeRate', Number(e.target.value))} disabled={!settings.gosiEnabled} />
                  <p className="text-xs text-muted-foreground">الافتراضي: 10% (يُخصم من راتب الموظف)</p>
                </div>
                <div className="space-y-2">
                  <Label>السقف الأعلى لراتب GOSI</Label>
                  <Input type="number" step="0.01" min="0" value={settings.gosiSalaryCap} onChange={(e) => update('gosiSalaryCap', Number(e.target.value))} disabled={!settings.gosiEnabled} />
                  <p className="text-xs text-muted-foreground">الافتراضي: 45,000 ريال</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Save bar */}
          <div className="flex justify-end gap-2 sticky bottom-0 bg-background py-3 border-t">
            <Button variant="outline" onClick={fetchSettings} disabled={saving}>إعادة تعيين</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              حفظ الإعدادات
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
