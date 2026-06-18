'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Plus,
  Pencil,
  Trash2,
  Search,
  RefreshCw,
  Loader2,
  Banknote,
  Users,
  HandCoins,
  FileSpreadsheet,
  CheckCircle2,
  XCircle,
  Printer,
  Eye,
  ArrowRight,
  AlertTriangle,
  Wallet,
  Calendar,
  TrendingUp,
  Ban,
  ChevronLeft,
  Check,
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useAppStore } from '@/lib/store';
import { useTranslation } from '@/lib/i18n';
import {
  printReportDocument,
  fetchCompanyInfoForPrint,
  fetchBranchInfoForPrint,
  generateReportNumber,
} from '@/lib/report-print';
import {
  AllowancesTab,
  LeavesTab,
  AttendanceTab,
  PeriodLocksTab,
  EmployeeLedgerTab,
  PayrollSettingsTab,
} from '@/components/accounting/payroll-enhancements';

// ─── Types ────────────────────────────────────────────────────────────

interface Branch {
  id: string;
  code: string;
  name: string;
  nameEn?: string;
}

interface Employee {
  id: string;
  code: string;
  name: string;
  nameEn?: string;
  iqamaNumber?: string;
  phone?: string;
  email?: string;
  position?: string;
  salaryType: 'MONTHLY' | 'HOURLY';
  baseSalary: number;
  status: 'ACTIVE' | 'INACTIVE';
  hireDate: string;
  branchId: string;
  branchName?: string;
  branchNameEn?: string;
  branchCode?: string;
  notes?: string;
  createdAt: string;
}

interface Advance {
  id: string;
  number: string;
  employeeId: string;
  employeeCode?: string;
  employeeName?: string;
  employeeNameEn?: string;
  employeePosition?: string;
  branchId: string;
  branchName?: string;
  branchCode?: string;
  amount: number;
  date: string;
  reason?: string;
  status: 'PENDING' | 'SETTLED';
  settledAmount: number;
  remaining: number;
  journalEntryId?: string;
  notes?: string;
  createdAt: string;
}

interface PayrollItem {
  id: string;
  employeeId: string;
  employeeCode?: string;
  employeeName?: string;
  employeeNameEn?: string;
  employeePosition?: string;
  salaryType?: string;
  baseSalary?: number;
  workDays: number;
  workHours: number;
  baseAmount: number;
  allowances: number;
  deductions: number;
  advanceAmount: number;
  grossAmount: number;
  netAmount: number;
  notes?: string;
  // Structured allowances (Section 4)
  housingAllowance?: number;
  transportAllowance?: number;
  communicationAllowance?: number;
  bonusAmount?: number;
  commissionAmount?: number;
  otherAllowances?: number;
  // Structured deductions
  gosiDeduction?: number;
  absenceDeduction?: number;
  lateDeduction?: number;
  otherDeductions?: number;
  // Leave/Attendance summary (Section 5)
  annualLeaveDays?: number;
  sickLeaveDays?: number;
  absenceDays?: number;
  lateHours?: number;
}

interface PayrollPayment {
  id: string;
  amount: number;
  paymentMethod: 'CASH' | 'BANK_TRANSFER' | 'CHEQUE';
  date: string;
  reference?: string;
  journalEntryId?: string;
  notes?: string;
  createdAt: string;
}

interface PayrollRun {
  id: string;
  number: string;
  branchId: string;
  branchName?: string;
  branchNameEn?: string;
  branchCode?: string;
  month: number;
  year: number;
  status: 'DRAFT' | 'GENERATED' | 'APPROVED' | 'PAID' | 'VOIDED';
  totalBase: number;
  totalAllowances: number;
  totalDeductions: number;
  totalAdvances: number;
  totalGross: number;
  totalNet: number;
  totalPaid: number;
  remainingToPay: number;
  employeeCount: number;
  itemCount?: number;
  paymentCount?: number;
  generatedAt?: string | null;
  approvedAt?: string | null;
  paidAt?: string | null;
  voidedAt?: string | null;
  voidReason?: string;
  accrualJournalEntryId?: string;
  notes?: string;
  createdAt: string;
  items?: PayrollItem[];
  payments?: PayrollPayment[];
  // Period-lock info (Section 10)
  periodLocked?: boolean;
  periodLockInfo?: {
    lockedAt: string;
    lockedByName?: string;
    reason?: string;
  } | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────

const MONTHS_AR = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
];

// NOTE (PAYROLL-FIX-FINAL): All number/date formatting uses 'en-US' for money and
// 'ar-SA-u-nu-latn' for dates — Arabic month names but Latin/English digits.
// This enforces the requirement "الارقام انجليزية دائما" (Numbers must always be English digits).
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

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  DRAFT: { label: 'مسودة', color: 'bg-gray-500' },
  GENERATED: { label: 'مُنشأ', color: 'bg-blue-500' },
  APPROVED: { label: 'معتمد', color: 'bg-amber-500' },
  PAID: { label: 'مدفوع', color: 'bg-green-600' },
  VOIDED: { label: 'ملغي', color: 'bg-red-500' },
  ACTIVE: { label: 'نشط', color: 'bg-green-600' },
  INACTIVE: { label: 'موقوف', color: 'bg-gray-400' },
  PENDING: { label: 'معلق', color: 'bg-amber-500' },
  SETTLED: { label: 'مسوّى', color: 'bg-green-600' },
};

function StatusBadge({ status }: { status: string }) {
  const info = STATUS_LABELS[status] || { label: status, color: 'bg-gray-400' };
  return <Badge className={`${info.color} text-white hover:${info.color}`}>{info.label}</Badge>;
}

// ─── Main Component ───────────────────────────────────────────────────

export default function Payroll() {
  const [activeTab, setActiveTab] = useState('employees');
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState<string>('all');
  const { t } = useTranslation();

  // Fetch branches once on mount
  useEffect(() => {
    const fetchBranches = async () => {
      try {
        const res = await fetch('/api/branches');
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data)) {
            setBranches(data.map((b: any) => ({
              id: b.id,
              code: b.code,
              name: b.name,
              nameEn: b.nameEn,
            })));
          }
        }
      } catch {}
    };
    fetchBranches();
  }, []);

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6 max-w-[1600px] mx-auto w-full">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Banknote className="size-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold">{t.payroll || 'نظام الرواتب'}</h1>
            <p className="text-sm text-muted-foreground">إدارة الموظفين والسلف ومسيرات الرواتب مع التكامل المحاسبي</p>
          </div>
        </div>
        {/* Branch selector */}
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground whitespace-nowrap">الفرع:</Label>
          <Select value={selectedBranchId} onValueChange={setSelectedBranchId}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="كل الفروع" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل الفروع</SelectItem>
              {branches.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.nameEn || b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Tabs — horizontally scrollable to fit all 10 tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="flex w-full overflow-x-auto h-auto p-1 gap-1 justify-start">
          <TabsTrigger value="employees" className="flex items-center gap-2 py-2 shrink-0">
            <Users className="size-4" />
            <span>الموظفون</span>
          </TabsTrigger>
          <TabsTrigger value="advances" className="flex items-center gap-2 py-2 shrink-0">
            <HandCoins className="size-4" />
            <span>السلف</span>
          </TabsTrigger>
          <TabsTrigger value="runs" className="flex items-center gap-2 py-2 shrink-0">
            <Banknote className="size-4" />
            <span>مسيرات الرواتب</span>
          </TabsTrigger>
          <TabsTrigger value="reports" className="flex items-center gap-2 py-2 shrink-0">
            <FileSpreadsheet className="size-4" />
            <span>التقارير</span>
          </TabsTrigger>
          <TabsTrigger value="allowances" className="flex items-center gap-2 py-2 shrink-0">
            <Plus className="size-4" />
            <span>البدلات</span>
          </TabsTrigger>
          <TabsTrigger value="leaves" className="flex items-center gap-2 py-2 shrink-0">
            <Calendar className="size-4" />
            <span>الإجازات</span>
          </TabsTrigger>
          <TabsTrigger value="attendance" className="flex items-center gap-2 py-2 shrink-0">
            <AlertTriangle className="size-4" />
            <span>الحضور</span>
          </TabsTrigger>
          <TabsTrigger value="period-locks" className="flex items-center gap-2 py-2 shrink-0">
            <Ban className="size-4" />
            <span>إقفال الفترات</span>
          </TabsTrigger>
          <TabsTrigger value="ledger" className="flex items-center gap-2 py-2 shrink-0">
            <Wallet className="size-4" />
            <span>كشف موظف</span>
          </TabsTrigger>
          <TabsTrigger value="settings" className="flex items-center gap-2 py-2 shrink-0">
            <RefreshCw className="size-4" />
            <span>الإعدادات</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="employees" className="mt-4">
          <EmployeesTab branches={branches} selectedBranchId={selectedBranchId} />
        </TabsContent>
        <TabsContent value="advances" className="mt-4">
          <AdvancesTab branches={branches} selectedBranchId={selectedBranchId} />
        </TabsContent>
        <TabsContent value="runs" className="mt-4">
          <RunsTab branches={branches} selectedBranchId={selectedBranchId} />
        </TabsContent>
        <TabsContent value="reports" className="mt-4">
          <ReportsTab branches={branches} selectedBranchId={selectedBranchId} />
        </TabsContent>
        <TabsContent value="allowances" className="mt-4">
          <AllowancesTab branches={branches} selectedBranchId={selectedBranchId} />
        </TabsContent>
        <TabsContent value="leaves" className="mt-4">
          <LeavesTab branches={branches} selectedBranchId={selectedBranchId} />
        </TabsContent>
        <TabsContent value="attendance" className="mt-4">
          <AttendanceTab branches={branches} selectedBranchId={selectedBranchId} />
        </TabsContent>
        <TabsContent value="period-locks" className="mt-4">
          <PeriodLocksTab branches={branches} selectedBranchId={selectedBranchId} />
        </TabsContent>
        <TabsContent value="ledger" className="mt-4">
          <EmployeeLedgerTab branches={branches} selectedBranchId={selectedBranchId} />
        </TabsContent>
        <TabsContent value="settings" className="mt-4">
          <PayrollSettingsTab branches={branches} selectedBranchId={selectedBranchId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// EMPLOYEES TAB
// ════════════════════════════════════════════════════════════════════

function EmployeesTab({ branches, selectedBranchId }: { branches: Branch[]; selectedBranchId: string }) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const fetchEmployees = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedBranchId !== 'all') params.set('branchId', selectedBranchId);
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (search.trim()) params.set('search', search.trim());
      params.set('pageSize', '200');
      const res = await fetch(`/api/payroll/employees?${params}`);
      if (res.ok) {
        const data = await res.json();
        setEmployees(data.employees || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [selectedBranchId, statusFilter, search]);

  useEffect(() => { fetchEmployees(); }, [fetchEmployees]);

  const handleAdd = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const handleEdit = (emp: Employee) => {
    setEditing(emp);
    setDialogOpen(true);
  };

  const handleDelete = async (emp: Employee) => {
    if (!confirm(`هل أنت متأكد من حذف الموظف "${emp.name}"؟`)) return;
    try {
      const res = await fetch(`/api/payroll/employees/${emp.id}`, { method: 'DELETE' });
      if (res.ok) {
        const data = await res.json();
        toast.success(data.softDeleted ? 'تم تعطيل الموظف (لديه سجل رواتب)' : 'تم حذف الموظف');
        fetchEmployees();
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
      {/* Filters + Add */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                placeholder="بحث بالاسم، الكود، رقم الهوية، الهاتف..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pr-9"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الحالات</SelectItem>
                <SelectItem value="ACTIVE">نشط</SelectItem>
                <SelectItem value="INACTIVE">موقوف</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="icon" onClick={fetchEmployees} disabled={loading}>
              <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
            <Button onClick={handleAdd}>
              <Plus className="size-4" />
              <span>إضافة موظف</span>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : employees.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center gap-2">
              <Users className="size-10 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">لا يوجد موظفون. اضغط "إضافة موظف" للبدء.</p>
            </div>
          ) : (
            <div className="max-h-[65vh] overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>الكود</TableHead>
                    <TableHead>الاسم</TableHead>
                    <TableHead>الوظيفة</TableHead>
                    <TableHead>الهوية</TableHead>
                    <TableHead>الهاتف</TableHead>
                    <TableHead>الفرع</TableHead>
                    <TableHead>نوع الراتب</TableHead>
                    <TableHead className="text-left">الراتب الأساسي</TableHead>
                    <TableHead>الحالة</TableHead>
                    <TableHead>تاريخ التوظيف</TableHead>
                    <TableHead className="text-center">إجراءات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {employees.map((emp) => (
                    <TableRow key={emp.id}>
                      <TableCell className="font-mono text-xs">{emp.code}</TableCell>
                      <TableCell className="font-medium">
                        {emp.name}
                        {emp.nameEn && <span className="block text-xs text-muted-foreground">{emp.nameEn}</span>}
                      </TableCell>
                      <TableCell className="text-sm">{emp.position || '—'}</TableCell>
                      <TableCell className="text-xs font-mono">{emp.iqamaNumber || '—'}</TableCell>
                      <TableCell className="text-xs">{emp.phone || '—'}</TableCell>
                      <TableCell className="text-sm">{emp.branchNameEn || emp.branchName || '—'}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{emp.salaryType === 'HOURLY' ? 'بالساعة' : 'شهري'}</Badge>
                      </TableCell>
                      <TableCell className="text-left font-mono">{formatMoney(emp.baseSalary)}</TableCell>
                      <TableCell><StatusBadge status={emp.status} /></TableCell>
                      <TableCell className="text-xs">{formatDate(emp.hireDate)}</TableCell>
                      <TableCell>
                        <div className="flex items-center justify-center gap-1">
                          <Button variant="ghost" size="icon" onClick={() => handleEdit(emp)} title="تعديل">
                            <Pencil className="size-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => handleDelete(emp)} title="حذف">
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

      <EmployeeDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
        branches={branches}
        defaultBranchId={selectedBranchId !== 'all' ? selectedBranchId : undefined}
        onSubmit={async (data) => {
          setSubmitting(true);
          try {
            const url = editing ? `/api/payroll/employees/${editing.id}` : '/api/payroll/employees';
            const method = editing ? 'PUT' : 'POST';
            const res = await fetch(url, {
              method,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(data),
            });
            if (res.ok) {
              toast.success(editing ? 'تم تعديل الموظف' : 'تم إضافة الموظف');
              setDialogOpen(false);
              fetchEmployees();
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
        submitting={submitting}
      />
    </div>
  );
}

// ─── Employee Dialog (Add/Edit) ───────────────────────────────────────

function EmployeeDialog({
  open,
  onOpenChange,
  editing,
  branches,
  defaultBranchId,
  onSubmit,
  submitting,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: Employee | null;
  branches: Branch[];
  defaultBranchId?: string;
  onSubmit: (data: any) => void;
  submitting: boolean;
}) {
  const [form, setForm] = useState<any>({
    name: '',
    nameEn: '',
    iqamaNumber: '',
    phone: '',
    email: '',
    position: '',
    salaryType: 'MONTHLY',
    baseSalary: 0,
    status: 'ACTIVE',
    hireDate: new Date().toISOString().split('T')[0],
    branchId: '',
    notes: '',
  });

  useEffect(() => {
    if (editing) {
      setForm({
        name: editing.name,
        nameEn: editing.nameEn || '',
        iqamaNumber: editing.iqamaNumber || '',
        phone: editing.phone || '',
        email: editing.email || '',
        position: editing.position || '',
        salaryType: editing.salaryType,
        baseSalary: editing.baseSalary,
        status: editing.status,
        hireDate: editing.hireDate.split('T')[0],
        branchId: editing.branchId,
        notes: editing.notes || '',
      });
    } else {
      setForm({
        name: '',
        nameEn: '',
        iqamaNumber: '',
        phone: '',
        email: '',
        position: '',
        salaryType: 'MONTHLY',
        baseSalary: 0,
        status: 'ACTIVE',
        hireDate: new Date().toISOString().split('T')[0],
        branchId: defaultBranchId || (branches[0]?.id || ''),
        notes: '',
      });
    }
  }, [editing, open, defaultBranchId, branches]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      toast.error('اسم الموظف مطلوب');
      return;
    }
    if (!form.branchId) {
      toast.error('الفرع مطلوب — لا يمكن إنشاء موظف بدون فرع');
      return;
    }
    onSubmit(form);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? 'تعديل موظف' : 'إضافة موظف جديد'}</DialogTitle>
          <DialogDescription>
            {editing ? `تعديل بيانات: ${editing.name} (${editing.code})` : 'أدخل بيانات الموظف. الحقول المطلوبة بالعلامة *.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>الاسم (عربي) *</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </div>
            <div className="space-y-2">
              <Label>الاسم (إنجليزي)</Label>
              <Input value={form.nameEn} onChange={(e) => setForm({ ...form, nameEn: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>رقم الهوية / الإقامة</Label>
              <Input value={form.iqamaNumber} onChange={(e) => setForm({ ...form, iqamaNumber: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>رقم الهاتف</Label>
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>البريد الإلكتروني</Label>
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>الوظيفة</Label>
              <Input value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} placeholder="مثل: طباخ، نادل، كاشير..." />
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
            <div className="space-y-2">
              <Label>نوع الراتب *</Label>
              <Select value={form.salaryType} onValueChange={(v) => setForm({ ...form, salaryType: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="MONTHLY">شهري</SelectItem>
                  <SelectItem value="HOURLY">بالساعة</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{form.salaryType === 'HOURLY' ? 'السعر بالساعة *' : 'الراتب الأساسي الشهري *'}</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={form.baseSalary}
                onChange={(e) => setForm({ ...form, baseSalary: Number(e.target.value) })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label>تاريخ التوظيف</Label>
              <Input type="date" value={form.hireDate} onChange={(e) => setForm({ ...form, hireDate: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>الحالة</Label>
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ACTIVE">نشط</SelectItem>
                  <SelectItem value="INACTIVE">موقوف</SelectItem>
                </SelectContent>
              </Select>
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
              {editing ? 'حفظ التعديلات' : 'إضافة الموظف'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ════════════════════════════════════════════════════════════════════
// ADVANCES TAB
// ════════════════════════════════════════════════════════════════════

function AdvancesTab({ branches, selectedBranchId }: { branches: Branch[]; selectedBranchId: string }) {
  const [advances, setAdvances] = useState<Advance[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [summary, setSummary] = useState<any>(null);
  // Settle dialog state (PAYROLL-FIX-FINAL — advances are settled separately from payroll runs)
  const [settleTarget, setSettleTarget] = useState<Advance | null>(null);
  const [settleOpen, setSettleOpen] = useState(false);
  const [settling, setSettling] = useState(false);

  const fetchAdvances = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedBranchId !== 'all') params.set('branchId', selectedBranchId);
      if (statusFilter !== 'all') params.set('status', statusFilter);
      params.set('pageSize', '200');
      const res = await fetch(`/api/payroll/advances?${params}`);
      if (res.ok) {
        const data = await res.json();
        setAdvances(data.advances || []);
        setSummary(data.summary);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [selectedBranchId, statusFilter]);

  const fetchEmployees = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (selectedBranchId !== 'all') params.set('branchId', selectedBranchId);
      params.set('status', 'ACTIVE');
      params.set('pageSize', '500');
      const res = await fetch(`/api/payroll/employees?${params}`);
      if (res.ok) {
        const data = await res.json();
        setEmployees(data.employees || []);
      }
    } catch {}
  }, [selectedBranchId]);

  useEffect(() => { fetchAdvances(); }, [fetchAdvances]);
  useEffect(() => { if (dialogOpen) fetchEmployees(); }, [dialogOpen, fetchEmployees]);

  const handleDelete = async (adv: Advance) => {
    if (!confirm(`هل أنت متأكد من حذف السلفة "${adv.number}"؟ سيتم إلغاء القيد المحاسبي.`)) return;
    try {
      const res = await fetch(`/api/payroll/advances/${adv.id}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success('تم حذف السلفة وإلغاء القيد');
        fetchAdvances();
      } else {
        const err = await res.json();
        toast.error(err.error || 'فشل الحذف');
      }
    } catch {
      toast.error('فشل الاتصال');
    }
  };

  // Open the settle dialog for a specific advance (PAYROLL-FIX-FINAL)
  const openSettle = (adv: Advance) => {
    setSettleTarget(adv);
    setSettleOpen(true);
  };

  const handleSettle = async (settledAmount: number) => {
    if (!settleTarget) return;
    setSettling(true);
    try {
      const res = await fetch(`/api/payroll/advances/${settleTarget.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markAsSettled: true, settledAmount }),
      });
      if (res.ok) {
        const data = await res.json();
        toast.success(`تمت تسوية السلفة ${data.number} بنجاح`);
        setSettleOpen(false);
        setSettleTarget(null);
        fetchAdvances();
      } else {
        const err = await res.json();
        toast.error(err.error || 'فشل التسوية');
      }
    } catch {
      toast.error('فشل الاتصال');
    } finally {
      setSettling(false);
    }
  };

  const filtered = useMemo(() => {
    if (!search.trim()) return advances;
    const q = search.trim().toLowerCase();
    return advances.filter(a =>
      a.employeeName?.toLowerCase().includes(q) ||
      a.employeeCode?.toLowerCase().includes(q) ||
      a.number.toLowerCase().includes(q) ||
      a.reason?.toLowerCase().includes(q)
    );
  }, [advances, search]);

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card><CardContent className="p-4">
            <p className="text-xs text-muted-foreground">إجمالي السلف</p>
            <p className="text-lg font-bold font-mono">{formatMoney(summary.totalAmount)}</p>
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <p className="text-xs text-muted-foreground">المسوّى</p>
            <p className="text-lg font-bold font-mono text-green-600">{formatMoney(summary.totalSettled)}</p>
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <p className="text-xs text-muted-foreground">المتبقي</p>
            <p className="text-lg font-bold font-mono text-amber-600">{formatMoney(summary.totalOutstanding)}</p>
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <p className="text-xs text-muted-foreground">عدد السلف</p>
            <p className="text-lg font-bold">{summary.count}</p>
          </CardContent></Card>
        </div>
      )}

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input placeholder="بحث بالموظف، رقم السلفة، السبب..." value={search} onChange={(e) => setSearch(e.target.value)} className="pr-9" />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الحالات</SelectItem>
                <SelectItem value="PENDING">معلق</SelectItem>
                <SelectItem value="SETTLED">مسوّى</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="icon" onClick={fetchAdvances} disabled={loading}>
              <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
            <Button onClick={() => setDialogOpen(true)}>
              <Plus className="size-4" /><span>صرف سلفة</span>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center gap-2">
              <HandCoins className="size-10 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">لا توجد سلف. اضغط "صرف سلفة" للبدء.</p>
            </div>
          ) : (
            <div className="max-h-[65vh] overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>رقم السلفة</TableHead>
                    <TableHead>الموظف</TableHead>
                    <TableHead>الفرع</TableHead>
                    <TableHead className="text-left">المبلغ</TableHead>
                    <TableHead className="text-left">المسوّى</TableHead>
                    <TableHead className="text-left">المتبقي</TableHead>
                    <TableHead>التاريخ</TableHead>
                    <TableHead>السبب</TableHead>
                    <TableHead>الحالة</TableHead>
                    <TableHead className="text-center">إجراء</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((adv) => (
                    <TableRow key={adv.id}>
                      <TableCell className="font-mono text-xs">{adv.number}</TableCell>
                      <TableCell>
                        <div className="font-medium">{adv.employeeName}</div>
                        <div className="text-xs text-muted-foreground">{adv.employeeCode}</div>
                      </TableCell>
                      <TableCell className="text-sm">{adv.branchName || '—'}</TableCell>
                      <TableCell className="text-left font-mono font-semibold">{formatMoney(adv.amount)}</TableCell>
                      <TableCell className="text-left font-mono text-green-600">{formatMoney(adv.settledAmount)}</TableCell>
                      <TableCell className="text-left font-mono text-amber-600">{formatMoney(adv.remaining)}</TableCell>
                      <TableCell className="text-xs">{formatDate(adv.date)}</TableCell>
                      <TableCell className="text-sm max-w-[200px] truncate" title={adv.reason}>{adv.reason || '—'}</TableCell>
                      <TableCell><StatusBadge status={adv.status} /></TableCell>
                      <TableCell className="text-center">
                        {adv.status === 'PENDING' && adv.remaining > 0 && (
                          <div className="flex items-center justify-center gap-1">
                            <Button variant="ghost" size="icon" onClick={() => openSettle(adv)} title="تسوية السلفة">
                              <Check className="size-4 text-green-600" />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => handleDelete(adv)} title="حذف (يلغي القيد)">
                              <Trash2 className="size-4 text-red-500" />
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <AdvanceDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        employees={employees}
        onSubmit={async (data) => {
          setSubmitting(true);
          try {
            const res = await fetch('/api/payroll/advances', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(data),
            });
            if (res.ok) {
              toast.success('تم صرف السلفة وإنشاء القيد المحاسبي');
              setDialogOpen(false);
              fetchAdvances();
            } else {
              const err = await res.json();
              toast.error(err.error || 'فشل صرف السلفة');
            }
          } catch {
            toast.error('فشل الاتصال');
          } finally {
            setSubmitting(false);
          }
        }}
        submitting={submitting}
      />

      {/* Settle dialog — PAYROLL-FIX-FINAL: advances are settled separately from payroll runs */}
      <SettleAdvanceDialog
        open={settleOpen}
        onOpenChange={(v) => { setSettleOpen(v); if (!v) setSettleTarget(null); }}
        advance={settleTarget}
        onSettle={handleSettle}
        settling={settling}
      />
    </div>
  );
}

// ─── Settle Advance Dialog (PAYROLL-FIX-FINAL) ──────────────────────
// Provides a separate UI to settle (or partially settle) an outstanding advance.
// This is the SEPARATE settlement mechanism — advances are NOT deducted from
// payroll runs anymore; they are settled manually here.
function SettleAdvanceDialog({
  open,
  onOpenChange,
  advance,
  onSettle,
  settling,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  advance: Advance | null;
  onSettle: (amount: number) => void;
  settling: boolean;
}) {
  const [amount, setAmount] = useState<number>(0);

  useEffect(() => {
    if (open && advance) {
      // Default to full remaining amount
      setAmount(advance.remaining);
    }
  }, [open, advance]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!advance) return;
    if (!amount || amount <= 0) { toast.error('المبلغ يجب أن يكون أكبر من صفر'); return; }
    if (amount > advance.remaining) {
      toast.error(`المبلغ لا يمكن أن يتجاوز المتبقي (${formatMoney(advance.remaining)})`);
      return;
    }
    onSettle(amount);
  };

  if (!advance) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>تسوية السلفة {advance.number}</DialogTitle>
          <DialogDescription>
            سيتم تسوية السلفة منفصلة عن المسيرات. يمكنك تسوية المبلغ كاملاً أو جزئياً.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2 rounded-md border p-3 bg-muted/30">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">الموظف:</span>
              <span className="font-medium">{advance.employeeName}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">المبلغ الإجمالي:</span>
              <span className="font-mono">{formatMoney(advance.amount)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">المسوّى سابقاً:</span>
              <span className="font-mono text-green-600">{formatMoney(advance.settledAmount)}</span>
            </div>
            <div className="flex justify-between text-sm font-semibold">
              <span className="text-muted-foreground">المتبقي:</span>
              <span className="font-mono text-amber-600">{formatMoney(advance.remaining)}</span>
            </div>
          </div>
          <div className="space-y-2">
            <Label>مبلغ التسوية *</Label>
            <Input
              type="number"
              step="0.01"
              min="0.01"
              max={advance.remaining}
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              required
            />
            <p className="text-xs text-muted-foreground">
              أدخل المبلغ المراد تسويته الآن. إذا يساوي المتبقي، ستُغلق السلفة بالكامل.
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button>
            <Button type="submit" disabled={settling}>
              {settling && <Loader2 className="size-4 animate-spin" />}
              <Check className="size-4" />
              تسوية
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AdvanceDialog({
  open,
  onOpenChange,
  employees,
  onSubmit,
  submitting,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  employees: Employee[];
  onSubmit: (data: any) => void;
  submitting: boolean;
}) {
  const [form, setForm] = useState<any>({
    employeeId: '',
    amount: 0,
    paymentMethod: 'CASH',
    date: new Date().toISOString().split('T')[0],
    reason: '',
    notes: '',
  });

  useEffect(() => {
    if (open) {
      setForm({
        employeeId: employees[0]?.id || '',
        amount: 0,
        paymentMethod: 'CASH',
        date: new Date().toISOString().split('T')[0],
        reason: '',
        notes: '',
      });
    }
  }, [open, employees]);

  const selectedEmp = employees.find(e => e.id === form.employeeId);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.employeeId) { toast.error('اختر الموظف'); return; }
    if (!form.amount || form.amount <= 0) { toast.error('المبلغ يجب أن يكون أكبر من صفر'); return; }
    onSubmit(form);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>صرف سلفة موظف</DialogTitle>
          <DialogDescription>سيتم إنشاء قيد محاسبي تلقائياً: مدين سلف الموظفين / دائن النقدية</DialogDescription>
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
            {selectedEmp && (
              <p className="text-xs text-muted-foreground">
                الراتب الأساسي: {formatMoney(selectedEmp.baseSalary)} ({selectedEmp.salaryType === 'HOURLY' ? 'بالساعة' : 'شهري'})
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>المبلغ *</Label>
              <Input type="number" step="0.01" min="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })} required />
            </div>
            <div className="space-y-2">
              <Label>طريقة الصرف</Label>
              <Select value={form.paymentMethod} onValueChange={(v) => setForm({ ...form, paymentMethod: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="CASH">نقدي</SelectItem>
                  <SelectItem value="BANK_TRANSFER">تحويل بنكي</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>التاريخ</Label>
              <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>السبب</Label>
            <Input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="مثل: سلفة شخصية، طارئ..." />
          </div>
          <div className="space-y-2">
            <Label>ملاحظات</Label>
            <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button>
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="size-4 animate-spin" />}
              صرف السلفة
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ════════════════════════════════════════════════════════════════════
// RUNS TAB
// ════════════════════════════════════════════════════════════════════

function RunsTab({ branches, selectedBranchId }: { branches: Branch[]; selectedBranchId: string }) {
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [detailRun, setDetailRun] = useState<PayrollRun | null>(null);
  const [summary, setSummary] = useState<any>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);

  const fetchRuns = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedBranchId !== 'all') params.set('branchId', selectedBranchId);
      if (statusFilter !== 'all') params.set('status', statusFilter);
      params.set('pageSize', '100');
      const res = await fetch(`/api/payroll/runs?${params}`);
      if (res.ok) {
        const data = await res.json();
        setRuns(data.runs || []);
        setSummary(data.summary);
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [selectedBranchId, statusFilter]);

  useEffect(() => { fetchRuns(); }, [fetchRuns]);

  const handleViewDetail = async (run: PayrollRun) => {
    try {
      const res = await fetch(`/api/payroll/runs/${run.id}`);
      if (res.ok) {
        const data = await res.json();
        setDetailRun(data);
      }
    } catch {
      toast.error('فشل تحميل التفاصيل');
    }
  };

  if (detailRun) {
    return <RunDetail run={detailRun} onBack={() => { setDetailRun(null); fetchRuns(); }} branches={branches} />;
  }

  return (
    <div className="space-y-4">
      {/* Summary */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card><CardContent className="p-4">
            <p className="text-xs text-muted-foreground">إجمالي الإجمالي</p>
            <p className="text-lg font-bold font-mono">{formatMoney(summary.totalGross)}</p>
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <p className="text-xs text-muted-foreground">إجمالي الخصومات</p>
            <p className="text-lg font-bold font-mono text-red-600">{formatMoney(summary.totalDeductions)}</p>
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <p className="text-xs text-muted-foreground">إجمالي الصافي</p>
            <p className="text-lg font-bold font-mono text-green-600">{formatMoney(summary.totalNet)}</p>
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <p className="text-xs text-muted-foreground">إجمالي المدفوع</p>
            <p className="text-lg font-bold font-mono text-green-600">{formatMoney(summary.totalPaid)}</p>
          </CardContent></Card>
        </div>
      )}

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row gap-3">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الحالات</SelectItem>
                <SelectItem value="GENERATED">مُنشأ</SelectItem>
                <SelectItem value="APPROVED">معتمد</SelectItem>
                <SelectItem value="PAID">مدفوع</SelectItem>
                <SelectItem value="VOIDED">ملغي</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="icon" onClick={fetchRuns} disabled={loading}>
              <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
            <div className="flex-1" />
            <Button onClick={() => setDialogOpen(true)}>
              <Plus className="size-4" /><span>إنشاء مسير رواتب</span>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>
          ) : runs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center gap-2">
              <Banknote className="size-10 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">لا توجد مسيرات رواتب. اضغط "إنشاء مسير رواتب" للبدء.</p>
            </div>
          ) : (
            <div className="max-h-[65vh] overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>رقم المسير</TableHead>
                    <TableHead>الفرع</TableHead>
                    <TableHead>الشهر</TableHead>
                    <TableHead className="text-center">الموظفون</TableHead>
                    <TableHead className="text-left">الإجمالي</TableHead>
                    <TableHead className="text-left">الصافي</TableHead>
                    <TableHead className="text-left">المدفوع</TableHead>
                    <TableHead className="text-left">المتبقي</TableHead>
                    <TableHead>الحالة</TableHead>
                    <TableHead>الاعتماد</TableHead>
                    <TableHead className="text-center">إجراءات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runs.map((run) => (
                    <TableRow key={run.id} className={run.status === 'VOIDED' ? 'opacity-50' : ''}>
                      <TableCell className="font-mono text-xs">{run.number}</TableCell>
                      <TableCell className="text-sm">{run.branchNameEn || run.branchName}</TableCell>
                      <TableCell className="text-sm">{MONTHS_AR[run.month - 1]} {run.year}</TableCell>
                      <TableCell className="text-center">{run.employeeCount}</TableCell>
                      <TableCell className="text-left font-mono">{formatMoney(run.totalGross)}</TableCell>
                      <TableCell className="text-left font-mono font-semibold">{formatMoney(run.totalNet)}</TableCell>
                      <TableCell className="text-left font-mono text-green-600">{formatMoney(run.totalPaid)}</TableCell>
                      <TableCell className="text-left font-mono text-amber-600">{formatMoney(run.remainingToPay)}</TableCell>
                      <TableCell><StatusBadge status={run.status} /></TableCell>
                      <TableCell className="text-xs">{formatDate(run.approvedAt)}</TableCell>
                      <TableCell>
                        <div className="flex items-center justify-center gap-1">
                          <Button variant="ghost" size="icon" onClick={() => handleViewDetail(run)} title="عرض التفاصيل">
                            <Eye className="size-4" />
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

      <CreateRunDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        branches={branches}
        defaultBranchId={selectedBranchId !== 'all' ? selectedBranchId : undefined}
        employees={employees}
        fetchEmployees={async (branchId) => {
          const params = new URLSearchParams();
          if (branchId) params.set('branchId', branchId);
          params.set('status', 'ACTIVE');
          params.set('pageSize', '500');
          const res = await fetch(`/api/payroll/employees?${params}`);
          if (res.ok) {
            const data = await res.json();
            setEmployees(data.employees || []);
          }
        }}
        onSubmit={async (data) => {
          setSubmitting(true);
          try {
            const res = await fetch('/api/payroll/runs', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(data),
            });
            if (res.ok) {
              const created = await res.json();
              // Compute summary of what was auto-applied from the structured item fields
              const items = created.items || [];
              const employeesWithAllowances = items.filter((it: PayrollItem) =>
                (it.housingAllowance || 0) + (it.transportAllowance || 0) +
                (it.communicationAllowance || 0) + (it.bonusAmount || 0) +
                (it.commissionAmount || 0) + (it.otherAllowances || 0) > 0
              ).length;
              const employeesWithLeaves = items.filter((it: PayrollItem) =>
                (it.annualLeaveDays || 0) + (it.sickLeaveDays || 0) > 0
              ).length;
              const employeesWithAttendance = items.filter((it: PayrollItem) =>
                (it.absenceDays || 0) + (it.lateHours || 0) > 0
              ).length;
              const employeesWithGosi = items.filter((it: PayrollItem) => (it.gosiDeduction || 0) > 0).length;

              toast.success(
                `تم إنشاء المسير ${created.number} — ${items.length} موظف` +
                (data.autoApplyAllowances ? ` · بدلات: ${employeesWithAllowances}` : '') +
                (data.autoApplyLeaves ? ` · إجازات: ${employeesWithLeaves}` : '') +
                (data.autoApplyAttendance ? ` · حضور: ${employeesWithAttendance}` : '') +
                (data.autoApplyGosi ? ` · GOSI: ${employeesWithGosi}` : ''),
                { duration: 6000 }
              );
              setDialogOpen(false);
              fetchRuns();
              setDetailRun(created);
            } else {
              const err = await res.json();
              toast.error(err.error || 'فشل إنشاء المسير');
            }
          } catch {
            toast.error('فشل الاتصال');
          } finally {
            setSubmitting(false);
          }
        }}
        submitting={submitting}
      />
    </div>
  );
}

function CreateRunDialog({
  open,
  onOpenChange,
  branches,
  defaultBranchId,
  employees,
  fetchEmployees,
  onSubmit,
  submitting,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  branches: Branch[];
  defaultBranchId?: string;
  employees: Employee[];
  fetchEmployees: (branchId: string) => Promise<void>;
  onSubmit: (data: any) => void;
  submitting: boolean;
}) {
  const now = new Date();
  const [form, setForm] = useState<any>({
    branchId: '',
    month: now.getMonth() + 1,
    year: now.getFullYear(),
    employeeIds: [] as string[],
    notes: '',
    autoApplyAllowances: true,
    autoApplyLeaves: true,
    autoApplyAttendance: true,
    autoApplyGosi: true,
  });

  useEffect(() => {
    if (open) {
      const initialBranch = defaultBranchId || branches[0]?.id || '';
      setForm({
        branchId: initialBranch,
        month: now.getMonth() + 1,
        year: now.getFullYear(),
        employeeIds: [],
        notes: '',
        autoApplyAllowances: true,
        autoApplyLeaves: true,
        autoApplyAttendance: true,
        autoApplyGosi: true,
      });
      if (initialBranch) fetchEmployees(initialBranch);
    }
  }, [open, defaultBranchId, branches]);

  useEffect(() => {
    if (form.branchId && open) fetchEmployees(form.branchId);
  }, [form.branchId, open]);

  const toggleEmployee = (id: string) => {
    setForm((prev: any) => ({
      ...prev,
      employeeIds: prev.employeeIds.includes(id)
        ? prev.employeeIds.filter((x: string) => x !== id)
        : [...prev.employeeIds, id],
    }));
  };

  const selectAll = () => {
    setForm((prev: any) => ({ ...prev, employeeIds: employees.map(e => e.id) }));
  };
  const clearAll = () => setForm((prev: any) => ({ ...prev, employeeIds: [] }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.branchId) { toast.error('الفرع مطلوب'); return; }
    if (form.employeeIds.length === 0) { toast.error('اختر موظفاً واحداً على الأقل'); return; }
    onSubmit(form);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>إنشاء مسير رواتب جديد</DialogTitle>
          <DialogDescription>
            سيتم احتساب الرواتب تلقائياً (بدلات، استقطاعات، غياب، GOSI). السلف لا تدخل ضمن المسير — يتم تسويتها منفصلة من تبويب السلف.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>الفرع *</Label>
              <Select value={form.branchId} onValueChange={(v) => setForm({ ...form, branchId: v, employeeIds: [] })}>
                <SelectTrigger><SelectValue placeholder="اختر الفرع" /></SelectTrigger>
                <SelectContent>
                  {branches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.nameEn || b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
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
            <div className="flex items-center justify-between">
              <Label>الموظفون ({form.employeeIds.length} / {employees.length} مختار)</Label>
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" onClick={selectAll}>تحديد الكل</Button>
                <Button type="button" variant="outline" size="sm" onClick={clearAll}>مسح</Button>
              </div>
            </div>
            <div className="border rounded-md max-h-64 overflow-y-auto">
              {employees.length === 0 ? (
                <div className="p-4 text-center text-sm text-muted-foreground">لا يوجد موظفون نشطون في هذا الفرع</div>
              ) : (
                employees.map((emp) => (
                  <label key={emp.id} className="flex items-center gap-3 p-2 hover:bg-accent cursor-pointer border-b last:border-0">
                    <Checkbox
                      checked={form.employeeIds.includes(emp.id)}
                      onCheckedChange={() => toggleEmployee(emp.id)}
                    />
                    <div className="flex-1">
                      <div className="text-sm font-medium">{emp.name} <span className="text-xs text-muted-foreground">({emp.code})</span></div>
                      <div className="text-xs text-muted-foreground">{emp.position || '—'} • {emp.salaryType === 'HOURLY' ? `${formatMoney(emp.baseSalary)}/ساعة` : `${formatMoney(emp.baseSalary)}/شهر`}</div>
                    </div>
                  </label>
                ))
              )}
            </div>
          </div>

          {/* Auto-apply features (Sections 4-5-10) */}
          <div className="rounded-md border p-3 space-y-2">
            <Label className="text-xs font-semibold">الخيارات التلقائية</Label>
            <p className="text-xs text-muted-foreground -mt-1">تُطبَّق هذه الخيارات تلقائياً عند إنشاء المسير بناءً على بيانات الإجازات والحضور والبدلات</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pt-1">
              <label className="flex items-center gap-2 cursor-pointer p-1.5 rounded hover:bg-accent">
                <Checkbox
                  checked={form.autoApplyAllowances}
                  onCheckedChange={(v) => setForm({ ...form, autoApplyAllowances: !!v })}
                />
                <span className="text-sm">تطبيق البدلات المتكررة</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer p-1.5 rounded hover:bg-accent">
                <Checkbox
                  checked={form.autoApplyLeaves}
                  onCheckedChange={(v) => setForm({ ...form, autoApplyLeaves: !!v })}
                />
                <span className="text-sm">تطبيق الإجازات</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer p-1.5 rounded hover:bg-accent">
                <Checkbox
                  checked={form.autoApplyAttendance}
                  onCheckedChange={(v) => setForm({ ...form, autoApplyAttendance: !!v })}
                />
                <span className="text-sm">تطبيق الحضور والغياب</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer p-1.5 rounded hover:bg-accent">
                <Checkbox
                  checked={form.autoApplyGosi}
                  onCheckedChange={(v) => setForm({ ...form, autoApplyGosi: !!v })}
                />
                <span className="text-sm">تطبيق التأمينات (GOSI)</span>
              </label>
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
              إنشاء المسير
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Run Detail ───────────────────────────────────────────────────────

function RunDetail({ run, onBack, branches }: { run: PayrollRun; onBack: () => void; branches: Branch[] }) {
  const [approving, setApproving] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [voidDialogOpen, setVoidDialogOpen] = useState(false);
  const [payDialogOpen, setPayDialogOpen] = useState(false);
  const [currentRun, setCurrentRun] = useState(run);
  const user = useAppStore((s) => s.user);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/payroll/runs/${run.id}`);
      if (res.ok) setCurrentRun(await res.json());
    } catch {}
  }, [run.id]);

  const handleApprove = async () => {
    if (!confirm(`اعتماد المسير ${currentRun.number}؟ سيتم إنشاء قيد محاسبي (مدين مصروف الرواتب / دائن الرواتب المستحقة) ولا يمكن التعديل بعدها.`)) return;
    setApproving(true);
    try {
      const res = await fetch(`/api/payroll/runs/${run.id}/approve`, { method: 'POST' });
      if (res.ok) {
        toast.success('تم اعتماد المسير وإنشاء القيد المحاسبي');
        refresh();
      } else {
        const err = await res.json();
        toast.error(err.error || 'فشل الاعتماد');
      }
    } catch { toast.error('فشل الاتصال'); }
    finally { setApproving(false); }
  };

  const handleVoid = async (reason: string) => {
    setVoiding(true);
    try {
      const res = await fetch(`/api/payroll/runs/${run.id}/void`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      if (res.ok) {
        toast.success('تم إلغاء المسير وعكس القيد المحاسبي');
        setVoidDialogOpen(false);
        refresh();
      } else {
        const err = await res.json();
        toast.error(err.error || 'فشل الإلغاء');
      }
    } catch { toast.error('فشل الاتصال'); }
    finally { setVoiding(false); }
  };

  const handlePrint = async () => {
    const [company, branch] = await Promise.all([
      fetchCompanyInfoForPrint(),
      fetchBranchInfoForPrint(currentRun.branchId || currentRun.branchCode || ''),
    ]);

    const itemsRows = (currentRun.items || []).map((it, i) => `
      <tr>
        <td class="num">${i + 1}</td>
        <td>${it.employeeCode || ''}</td>
        <td style="text-align:right">${it.employeeName || ''}${it.employeeNameEn ? `<br><small>${it.employeeNameEn}</small>` : ''}</td>
        <td>${it.employeePosition || '—'}</td>
        <td class="num">${it.workDays || it.workHours || 0}</td>
        <td class="num">${formatMoney(it.baseAmount)}</td>
        <td class="num">${formatMoney(it.allowances)}</td>
        <td class="num">${formatMoney(it.deductions)}</td>
        <td class="num"><strong>${formatMoney(it.grossAmount)}</strong></td>
        <td class="num"><strong style="color:#15803d">${formatMoney(it.netAmount)}</strong></td>
      </tr>`).join('');

    // Structured breakdown per employee — includes allowances, deductions, leave/attendance summary
    const structuredRows = (currentRun.items || [])
      .filter((it) =>
        (it.housingAllowance || 0) + (it.transportAllowance || 0) +
        (it.communicationAllowance || 0) + (it.bonusAmount || 0) +
        (it.commissionAmount || 0) + (it.otherAllowances || 0) +
        (it.gosiDeduction || 0) + (it.absenceDeduction || 0) +
        (it.lateDeduction || 0) + (it.otherDeductions || 0) +
        (it.annualLeaveDays || 0) + (it.sickLeaveDays || 0) +
        (it.absenceDays || 0) + (it.lateHours || 0) > 0
      )
      .map((it, i) => `
        <tr>
          <td class="num">${i + 1}</td>
          <td>${it.employeeCode || ''}</td>
          <td style="text-align:right">${it.employeeName || ''}</td>
          <td class="num">${formatMoney(it.housingAllowance || 0)}</td>
          <td class="num">${formatMoney(it.transportAllowance || 0)}</td>
          <td class="num">${formatMoney(it.communicationAllowance || 0)}</td>
          <td class="num">${formatMoney(it.bonusAmount || 0)}</td>
          <td class="num">${formatMoney(it.commissionAmount || 0)}</td>
          <td class="num">${formatMoney(it.otherAllowances || 0)}</td>
          <td class="num" style="color:#b91c1c">${formatMoney(it.gosiDeduction || 0)}</td>
          <td class="num" style="color:#b91c1c">${formatMoney(it.absenceDeduction || 0)}</td>
          <td class="num" style="color:#b91c1c">${formatMoney(it.lateDeduction || 0)}</td>
          <td class="num">${it.annualLeaveDays || 0}</td>
          <td class="num">${it.sickLeaveDays || 0}</td>
          <td class="num" style="color:#b91c1c">${it.absenceDays || 0}</td>
          <td class="num">${Number(it.lateHours || 0).toFixed(2)}</td>
        </tr>`).join('');

    const totalsStructured = (currentRun.items || []).reduce(
      (acc, it) => ({
        housing: acc.housing + (it.housingAllowance || 0),
        transport: acc.transport + (it.transportAllowance || 0),
        comm: acc.comm + (it.communicationAllowance || 0),
        bonus: acc.bonus + (it.bonusAmount || 0),
        commission: acc.commission + (it.commissionAmount || 0),
        other: acc.other + (it.otherAllowances || 0),
        gosi: acc.gosi + (it.gosiDeduction || 0),
        absence: acc.absence + (it.absenceDeduction || 0),
        late: acc.late + (it.lateDeduction || 0),
      }),
      { housing: 0, transport: 0, comm: 0, bonus: 0, commission: 0, other: 0, gosi: 0, absence: 0, late: 0 }
    );

    const contentHtml = `
      <div class="section">
        <h3 style="margin:0 0 8px">تفاصيل المسير</h3>
        <div class="meta-grid">
          <div><span>رقم المسير:</span> <strong>${currentRun.number}</strong></div>
          <div><span>الشهر:</span> <strong>${MONTHS_AR[currentRun.month - 1]} ${currentRun.year}</strong></div>
          <div><span>الفرع:</span> <strong>${branch?.name || currentRun.branchName || ''}</strong></div>
          <div><span>عدد الموظفين:</span> <strong>${currentRun.employeeCount}</strong></div>
          <div><span>الحالة:</span> <strong>${STATUS_LABELS[currentRun.status]?.label || currentRun.status}</strong></div>
          <div><span>تاريخ الإنشاء:</span> ${formatDate(currentRun.createdAt)}</div>
          ${currentRun.approvedAt ? `<div><span>تاريخ الاعتماد:</span> ${formatDate(currentRun.approvedAt)}</div>` : ''}
          ${currentRun.paidAt ? `<div><span>تاريخ الدفع:</span> ${formatDate(currentRun.paidAt)}</div>` : ''}
          ${currentRun.accrualJournalEntryId ? `<div><span>القيد المحاسبي:</span> ${currentRun.accrualJournalEntryId.substring(0, 8)}…</div>` : ''}
          ${currentRun.periodLocked ? `<div><span>حالة الفترة:</span> <strong style="color:#b91c1c">مقفلة</strong></div>` : ''}
        </div>
      </div>

      <div class="section">
        <h3 style="margin:0 0 8px">ملخص الحساب</h3>
        <table>
          <tbody>
            <tr><td>إجمالي الراتب الأساسي</td><td class="num">${formatMoney(currentRun.totalBase)}</td></tr>
            <tr><td>إجمالي البدلات</td><td class="num">${formatMoney(currentRun.totalAllowances)}</td></tr>
            <tr class="total-row"><td>الإجمالي (Gross)</td><td class="num">${formatMoney(currentRun.totalGross)}</td></tr>
            <tr><td>إجمالي الخصومات</td><td class="num" style="color:#dc2626">(${formatMoney(currentRun.totalDeductions)})</td></tr>
            <tr class="total-row"><td><strong>صافي الرواتب المستحقة</strong></td><td class="num"><strong style="color:#15803d">${formatMoney(currentRun.totalNet)}</strong></td></tr>
            <tr><td>المدفوع</td><td class="num" style="color:#15803d">${formatMoney(currentRun.totalPaid)}</td></tr>
            <tr><td>المتبقي</td><td class="num" style="color:#d97706">${formatMoney(currentRun.remainingToPay)}</td></tr>
          </tbody>
        </table>
      </div>

      <div class="section">
        <h3 style="margin:0 0 8px">تفاصيل الرواتب</h3>
        <table>
          <thead>
            <tr>
              <th>#</th><th>الكود</th><th style="text-align:right">الموظف</th><th>الوظيفة</th>
              <th>الأيام/ساعات</th><th>الأساسي</th><th>بدلات</th><th>خصومات</th><th>الإجمالي</th><th>الصافي</th>
            </tr>
          </thead>
          <tbody>
            ${itemsRows}
            <tr class="total-row">
              <td colspan="5" style="text-align:right"><strong>الإجمالي العام</strong></td>
              <td class="num"><strong>${formatMoney(currentRun.totalBase)}</strong></td>
              <td class="num"><strong>${formatMoney(currentRun.totalAllowances)}</strong></td>
              <td class="num"><strong>${formatMoney(currentRun.totalDeductions)}</strong></td>
              <td class="num"><strong>${formatMoney(currentRun.totalGross)}</strong></td>
              <td class="num"><strong style="color:#15803d">${formatMoney(currentRun.totalNet)}</strong></td>
            </tr>
          </tbody>
        </table>
      </div>

      ${structuredRows ? `
      <div class="section page-break-before">
        <h3 style="margin:0 0 8px">تفصيل البدلات والخصومات والإجازات</h3>
        <p class="text-sm text-muted">قسم تفصيلي يوضح كل بند من بنود البدلات والخصومات لكل موظف، بالإضافة إلى ملخص الإجازات والحضور.</p>
        <table>
          <thead>
            <tr>
              <th>#</th><th>الكود</th><th style="text-align:right">الموظف</th>
              <th>سكن</th><th>نقل</th><th>اتصال</th><th>مكافأة</th><th>عمولة</th><th>بدلات أخرى</th>
              <th>GOSI</th><th>غياب</th><th>تأخير</th>
              <th>سنوية</th><th>مرضية</th><th>غياب (يوم)</th><th>تأخير (ساعة)</th>
            </tr>
          </thead>
          <tbody>
            ${structuredRows}
            <tr class="total-row">
              <td colspan="3" style="text-align:right"><strong>الإجمالي</strong></td>
              <td class="num"><strong>${formatMoney(totalsStructured.housing)}</strong></td>
              <td class="num"><strong>${formatMoney(totalsStructured.transport)}</strong></td>
              <td class="num"><strong>${formatMoney(totalsStructured.comm)}</strong></td>
              <td class="num"><strong>${formatMoney(totalsStructured.bonus)}</strong></td>
              <td class="num"><strong>${formatMoney(totalsStructured.commission)}</strong></td>
              <td class="num"><strong>${formatMoney(totalsStructured.other)}</strong></td>
              <td class="num"><strong style="color:#b91c1c">${formatMoney(totalsStructured.gosi)}</strong></td>
              <td class="num"><strong style="color:#b91c1c">${formatMoney(totalsStructured.absence)}</strong></td>
              <td class="num"><strong style="color:#b91c1c">${formatMoney(totalsStructured.late)}</strong></td>
              <td colspan="4"></td>
            </tr>
          </tbody>
        </table>
      </div>` : ''}

      ${currentRun.payments && currentRun.payments.length > 0 ? `
      <div class="section">
        <h3 style="margin:0 0 8px">سجل الدفعات</h3>
        <table>
          <thead><tr><th>التاريخ</th><th>طريقة الدفع</th><th>المرجع</th><th>المبلغ</th></tr></thead>
          <tbody>
            ${currentRun.payments.map(p => `<tr><td>${formatDate(p.date)}</td><td>${p.paymentMethod === 'CASH' ? 'نقدي' : p.paymentMethod === 'BANK_TRANSFER' ? 'تحويل بنكي' : 'شيك'}</td><td>${p.reference || '—'}</td><td class="num">${formatMoney(p.amount)}</td></tr>`).join('')}
          </tbody>
        </table>
      </div>` : ''}

      <div class="section" style="margin-top:30px;display:flex;justify-content:space-between">
        <div>توقيع المدير: ____________________</div>
        <div>توقيع المحاسب: ____________________</div>
        <div>الختم: ____________________</div>
      </div>
    `;

    printReportDocument({
      title: 'مسير الرواتب',
      titleEn: 'Payroll Run',
      subtitle: `${MONTHS_AR[currentRun.month - 1]} ${currentRun.year}`,
      reportNumber: currentRun.number,
      company,
      branch,
      generatedBy: user?.name || '—',
      contentHtml,
      format: 'A4',
      orientation: 'landscape',
    });
  };

  const isLocked = !!currentRun.periodLocked;
  const canApprove = currentRun.status === 'GENERATED' && !isLocked;
  const canPay = currentRun.status === 'APPROVED' && currentRun.remainingToPay > 0.01 && !isLocked;
  const canVoid = (currentRun.status === 'APPROVED' || currentRun.status === 'PAID') && !isLocked;
  const canDelete = (currentRun.status === 'GENERATED' || currentRun.status === 'DRAFT') && !isLocked;

  return (
    <div className="space-y-4">
      {/* Period-locked banner (Section 10) */}
      {isLocked && (
        <Card className="border-red-500 bg-red-50">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <Ban className="size-5 text-red-600 mt-0.5 shrink-0" />
              <div className="text-sm">
                <p className="font-bold text-red-700">هذه الفترة مقفلة — لا يمكن التعديل</p>
                <p className="text-red-600 mt-1">
                  جميع عمليات الرواتب (إنشاء، تعديل، اعتماد، إلغاء، دفع) محظورة لهذه الفترة.
                  لإعادة الفتح، اطلب من مدير النظام استخدام تبويب <strong>«إقفال الفترات»</strong>.
                </p>
                {currentRun.periodLockInfo && (
                  <p className="text-xs text-red-600 mt-2">
                    أُقفلت بواسطة: {currentRun.periodLockInfo.lockedByName || '—'} بتاريخ{' '}
                    {formatDateTime(currentRun.periodLockInfo.lockedAt)}
                    {currentRun.periodLockInfo.reason ? ` — السبب: ${currentRun.periodLockInfo.reason}` : ''}
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Back + Actions */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <Button variant="ghost" onClick={onBack} className="w-fit">
          <ChevronLeft className="size-4" /> رجوع للقائمة
        </Button>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={handlePrint}><Printer className="size-4" /> طباعة</Button>
          {canApprove ? (
            <Button onClick={handleApprove} disabled={approving} className="bg-amber-600 hover:bg-amber-700">
              {approving ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
              اعتماد المسير
            </Button>
          ) : currentRun.status === 'GENERATED' && isLocked ? (
            <Button disabled title="الفترة مقفلة" className="bg-amber-600 opacity-50 cursor-not-allowed">
              <CheckCircle2 className="size-4" /> اعتماد (مقفلة)
            </Button>
          ) : null}
          {canPay ? (
            <Button onClick={() => setPayDialogOpen(true)} className="bg-green-600 hover:bg-green-700">
              <Wallet className="size-4" /> تسجيل دفعة
            </Button>
          ) : currentRun.status === 'APPROVED' && isLocked && currentRun.remainingToPay > 0.01 ? (
            <Button disabled title="الفترة مقفلة" className="bg-green-600 opacity-50 cursor-not-allowed">
              <Wallet className="size-4" /> دفعة (مقفلة)
            </Button>
          ) : null}
          {canDelete ? (
            <Button
              variant="outline"
              onClick={async () => {
                if (!confirm(`حذف المسير ${currentRun.number}؟ لا يمكن التراجع.`)) return;
                const res = await fetch(`/api/payroll/runs/${run.id}`, { method: 'DELETE' });
                if (res.ok) { toast.success('تم حذف المسير'); onBack(); }
                else { const e = await res.json(); toast.error(e.error || 'فشل الحذف'); }
              }}
              className="text-red-600 hover:text-red-700"
            >
              <Trash2 className="size-4" /> حذف
            </Button>
          ) : null}
          {canVoid ? (
            <Button variant="outline" onClick={() => setVoidDialogOpen(true)} className="text-red-600 border-red-300 hover:bg-red-50">
              <Ban className="size-4" /> إلغاء المسير
            </Button>
          ) : (currentRun.status === 'APPROVED' || currentRun.status === 'PAID') && isLocked ? (
            <Button disabled title="الفترة مقفلة" variant="outline" className="text-red-600 opacity-50 cursor-not-allowed border-red-300">
              <Ban className="size-4" /> إلغاء (مقفل)
            </Button>
          ) : null}
        </div>
      </div>

      {/* Status banner */}
      <Card className={currentRun.status === 'VOIDED' ? 'border-red-300 bg-red-50' : ''}>
        <CardContent className="p-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold">{currentRun.number}</h2>
                <StatusBadge status={currentRun.status} />
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                {currentRun.branchNameEn || currentRun.branchName} — {MONTHS_AR[currentRun.month - 1]} {currentRun.year} — {currentRun.employeeCount} موظف
              </p>
              {currentRun.status === 'VOIDED' && currentRun.voidReason && (
                <p className="text-sm text-red-600 mt-1 flex items-center gap-1">
                  <AlertTriangle className="size-4" /> سبب الإلغاء: {currentRun.voidReason}
                </p>
              )}
              {currentRun.accrualJournalEntryId && (
                <p className="text-xs text-muted-foreground mt-1">القيد المحاسبي: {currentRun.accrualJournalEntryId}</p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">الإجمالي (Gross)</p>
          <p className="text-lg font-bold font-mono">{formatMoney(currentRun.totalGross)}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">الخصومات</p>
          <p className="text-lg font-bold font-mono text-red-600">({formatMoney(currentRun.totalDeductions)})</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">الصافي المستحق</p>
          <p className="text-lg font-bold font-mono text-green-600">{formatMoney(currentRun.totalNet)}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">المدفوع</p>
          <p className="text-lg font-bold font-mono text-green-600">{formatMoney(currentRun.totalPaid)}</p>
        </CardContent></Card>
      </div>

      {/* Items table */}
      <Card>
        <CardHeader><CardTitle className="text-base">تفاصيل الرواتب</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="max-h-[55vh] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">#</TableHead>
                  <TableHead>الكود</TableHead>
                  <TableHead>الموظف</TableHead>
                  <TableHead>الوظيفة</TableHead>
                  <TableHead className="text-center">أيام/ساعات</TableHead>
                  <TableHead className="text-left">الأساسي</TableHead>
                  <TableHead className="text-left">بدلات</TableHead>
                  <TableHead className="text-left">خصومات</TableHead>
                  <TableHead className="text-left">الإجمالي</TableHead>
                  <TableHead className="text-left">الصافي</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(currentRun.items || []).map((it, i) => {
                  return (
                    <TableRow key={it.id}>
                      <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
                      <TableCell className="font-mono text-xs">{it.employeeCode}</TableCell>
                      <TableCell>
                        <div className="font-medium">{it.employeeName}</div>
                        {it.employeeNameEn && <div className="text-xs text-muted-foreground">{it.employeeNameEn}</div>}
                      </TableCell>
                      <TableCell className="text-sm">{it.employeePosition || '—'}</TableCell>
                      <TableCell className="text-center text-sm">
                        {it.salaryType === 'HOURLY' ? `${it.workHours} س` : `${it.workDays} ي`}
                      </TableCell>
                      <TableCell className="text-left font-mono">{formatMoney(it.baseAmount)}</TableCell>
                      <TableCell className="text-left font-mono text-green-600">{formatMoney(it.allowances)}</TableCell>
                      <TableCell className="text-left font-mono text-red-600">({formatMoney(it.deductions)})</TableCell>
                      <TableCell className="text-left font-mono font-semibold">{formatMoney(it.grossAmount)}</TableCell>
                      <TableCell className="text-left font-mono font-bold text-green-700">{formatMoney(it.netAmount)}</TableCell>
                    </TableRow>
                  );
                })}
                {/* Structured breakdown rows below each item */}
                {(currentRun.items || []).map((it) => {
                  const hasStructured =
                    (it.housingAllowance || 0) + (it.transportAllowance || 0) +
                    (it.communicationAllowance || 0) + (it.bonusAmount || 0) +
                    (it.commissionAmount || 0) + (it.otherAllowances || 0) +
                    (it.gosiDeduction || 0) + (it.absenceDeduction || 0) +
                    (it.lateDeduction || 0) + (it.otherDeductions || 0) +
                    (it.annualLeaveDays || 0) + (it.sickLeaveDays || 0) +
                    (it.absenceDays || 0) + (it.lateHours || 0) > 0;
                  if (!hasStructured) return null;
                  return (
                    <TableRow key={`${it.id}-detail`} className="bg-muted/20 border-b">
                      <TableCell colSpan={10} className="py-2 px-4">
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                          {it.housingAllowance ? <span>سكن: <span className="font-mono text-green-700">{formatMoney(it.housingAllowance)}</span></span> : null}
                          {it.transportAllowance ? <span>نقل: <span className="font-mono text-green-700">{formatMoney(it.transportAllowance)}</span></span> : null}
                          {it.communicationAllowance ? <span>اتصال: <span className="font-mono text-green-700">{formatMoney(it.communicationAllowance)}</span></span> : null}
                          {it.bonusAmount ? <span>مكافأة: <span className="font-mono text-green-700">{formatMoney(it.bonusAmount)}</span></span> : null}
                          {it.commissionAmount ? <span>عمولة: <span className="font-mono text-green-700">{formatMoney(it.commissionAmount)}</span></span> : null}
                          {it.otherAllowances ? <span>بدلات أخرى: <span className="font-mono text-green-700">{formatMoney(it.otherAllowances)}</span></span> : null}
                          {it.gosiDeduction ? <span>GOSI: <span className="font-mono text-red-700">({formatMoney(it.gosiDeduction)})</span></span> : null}
                          {it.absenceDeduction ? <span>خصم غياب: <span className="font-mono text-red-700">({formatMoney(it.absenceDeduction)})</span></span> : null}
                          {it.lateDeduction ? <span>خصم تأخير: <span className="font-mono text-red-700">({formatMoney(it.lateDeduction)})</span></span> : null}
                          {it.otherDeductions ? <span>خصومات أخرى: <span className="font-mono text-red-700">({formatMoney(it.otherDeductions)})</span></span> : null}
                          {it.annualLeaveDays ? <span>إجازة سنوية: <span className="font-mono">{it.annualLeaveDays} ي</span></span> : null}
                          {it.sickLeaveDays ? <span>إجازة مرضية: <span className="font-mono">{it.sickLeaveDays} ي</span></span> : null}
                          {it.absenceDays ? <span>أيام الغياب: <span className="font-mono text-red-700">{it.absenceDays} ي</span></span> : null}
                          {it.lateHours ? <span>ساعات التأخير: <span className="font-mono text-amber-700">{Number(it.lateHours).toFixed(2)} س</span></span> : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
                <TableRow className="bg-muted/30 font-bold">
                  <TableCell colSpan={5} className="text-right">الإجمالي العام</TableCell>
                  <TableCell className="text-left font-mono">{formatMoney(currentRun.totalBase)}</TableCell>
                  <TableCell className="text-left font-mono">{formatMoney(currentRun.totalAllowances)}</TableCell>
                  <TableCell className="text-left font-mono">({formatMoney(currentRun.totalDeductions)})</TableCell>
                  <TableCell className="text-left font-mono">{formatMoney(currentRun.totalGross)}</TableCell>
                  <TableCell className="text-left font-mono text-green-700">{formatMoney(currentRun.totalNet)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Payments list */}
      {currentRun.payments && currentRun.payments.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">سجل الدفعات</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>التاريخ</TableHead>
                  <TableHead>طريقة الدفع</TableHead>
                  <TableHead>المرجع</TableHead>
                  <TableHead className="text-left">المبلغ</TableHead>
                  <TableHead>القيد المحاسبي</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {currentRun.payments.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="text-sm">{formatDate(p.date)}</TableCell>
                    <TableCell><Badge variant="outline">{p.paymentMethod === 'CASH' ? 'نقدي' : p.paymentMethod === 'BANK_TRANSFER' ? 'تحويل بنكي' : 'شيك'}</Badge></TableCell>
                    <TableCell className="text-sm">{p.reference || '—'}</TableCell>
                    <TableCell className="text-left font-mono font-semibold text-green-700">{formatMoney(p.amount)}</TableCell>
                    <TableCell className="text-xs font-mono text-muted-foreground">{p.journalEntryId?.substring(0, 12) || '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Void dialog */}
      <VoidDialog
        open={voidDialogOpen}
        onOpenChange={setVoidDialogOpen}
        submitting={voiding}
        onSubmit={handleVoid}
      />

      {/* Pay dialog */}
      <PaymentDialog
        open={payDialogOpen}
        onOpenChange={setPayDialogOpen}
        remaining={currentRun.remainingToPay}
        onSubmit={async (data) => {
          try {
            const res = await fetch(`/api/payroll/runs/${run.id}/payments`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(data),
            });
            if (res.ok) {
              const result = await res.json();
              toast.success(result.runStatus === 'PAID' ? 'تم الدفع بالكامل — المسير مدفوع' : 'تم تسجيل الدفعة');
              setPayDialogOpen(false);
              refresh();
            } else {
              const err = await res.json();
              toast.error(err.error || 'فشل تسجيل الدفعة');
            }
          } catch { toast.error('فشل الاتصال'); }
        }}
      />
    </div>
  );
}

function VoidDialog({ open, onOpenChange, onSubmit, submitting }: { open: boolean; onOpenChange: (v: boolean) => void; onSubmit: (reason: string) => void; submitting: boolean }) {
  const [reason, setReason] = useState('');
  useEffect(() => { if (open) setReason(''); }, [open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-600">
            <AlertTriangle className="size-5" /> إلغاء مسير الرواتب
          </DialogTitle>
          <DialogDescription>
            سيتم عكس القيد المحاسبي وفتح السلف المسوّاة. هذه العملية تتطلب صلاحية ADMIN ولا يمكن التراجع عنها.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label>سبب الإلغاء *</Label>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="مثل: خطأ في الاحتساب، تكرار المسير..." />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>تراجع</Button>
          <Button variant="destructive" disabled={!reason.trim() || submitting} onClick={() => onSubmit(reason.trim())}>
            {submitting && <Loader2 className="size-4 animate-spin" />}
            تأكيد الإلغاء
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PaymentDialog({ open, onOpenChange, remaining, onSubmit }: { open: boolean; onOpenChange: (v: boolean) => void; remaining: number; onSubmit: (data: any) => void }) {
  const [form, setForm] = useState<any>({
    amount: 0,
    paymentMethod: 'CASH',
    date: new Date().toISOString().split('T')[0],
    reference: '',
    notes: '',
  });
  useEffect(() => {
    if (open) {
      setForm({
        amount: remaining,
        paymentMethod: 'CASH',
        date: new Date().toISOString().split('T')[0],
        reference: '',
        notes: '',
      });
    }
  }, [open, remaining]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>تسجيل دفعة رواتب</DialogTitle>
          <DialogDescription>المتبقي للمسير: {formatMoney(remaining)}. سيتم إنشاء قيد: مدين الرواتب المستحقة / دائن النقدية.</DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); onSubmit(form); }} className="space-y-4">
          <div className="space-y-2">
            <Label>المبلغ *</Label>
            <Input type="number" step="0.01" min="0.01" max={remaining + 0.01} value={form.amount} onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>طريقة الدفع</Label>
              <Select value={form.paymentMethod} onValueChange={(v) => setForm({ ...form, paymentMethod: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="CASH">نقدي</SelectItem>
                  <SelectItem value="BANK_TRANSFER">تحويل بنكي</SelectItem>
                  <SelectItem value="CHEQUE">شيك</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>التاريخ</Label>
              <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>المرجع (رقم التحويل/الشيك)</Label>
            <Input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>ملاحظات</Label>
            <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button>
            <Button type="submit"><Wallet className="size-4" /> تسجيل الدفعة</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ════════════════════════════════════════════════════════════════════
// REPORTS TAB
// ════════════════════════════════════════════════════════════════════

function ReportsTab({ branches, selectedBranchId }: { branches: Branch[]; selectedBranchId: string }) {
  const [reportType, setReportType] = useState<'employee' | 'summary'>('summary');
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>('');
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [employeeReport, setEmployeeReport] = useState<any>(null);
  const [summaryReport, setSummaryReport] = useState<any>(null);
  const user = useAppStore((s) => s.user);

  // Fetch employees for the employee statement report
  useEffect(() => {
    const fetchEmployees = async () => {
      const params = new URLSearchParams();
      if (selectedBranchId !== 'all') params.set('branchId', selectedBranchId);
      params.set('pageSize', '500');
      const res = await fetch(`/api/payroll/employees?${params}`);
      if (res.ok) {
        const data = await res.json();
        setEmployees(data.employees || []);
        if (data.employees?.length && !selectedEmployeeId) {
          setSelectedEmployeeId(data.employees[0].id);
        }
      }
    };
    fetchEmployees();
  }, [selectedBranchId]);

  const runEmployeeReport = useCallback(async () => {
    if (!selectedEmployeeId) { toast.error('اختر الموظف'); return; }
    setLoading(true);
    try {
      const params = new URLSearchParams({ employeeId: selectedEmployeeId });
      if (dateFrom) params.set('dateFrom', dateFrom);
      if (dateTo) params.set('dateTo', dateTo);
      params.set('pageSize', '500');
      const res = await fetch(`/api/payroll/reports/employee-statement?${params}`);
      if (res.ok) {
        setEmployeeReport(await res.json());
      } else {
        toast.error('فشل تحميل التقرير');
      }
    } catch { toast.error('فشل الاتصال'); }
    finally { setLoading(false); }
  }, [selectedEmployeeId, dateFrom, dateTo]);

  const runSummaryReport = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ year: String(year) });
      if (selectedBranchId !== 'all') params.set('branch', selectedBranchId);
      const res = await fetch(`/api/payroll/reports/summary?${params}`);
      if (res.ok) {
        setSummaryReport(await res.json());
      } else {
        toast.error('فشل تحميل التقرير');
      }
    } catch { toast.error('فشل الاتصال'); }
    finally { setLoading(false); }
  }, [year, selectedBranchId]);

  // Auto-run summary report on mount / when year changes
  useEffect(() => {
    if (reportType === 'summary') runSummaryReport();
  }, [reportType, runSummaryReport]);

  const printEmployeeReport = async () => {
    if (!employeeReport) return;
    const [company, branch] = await Promise.all([
      fetchCompanyInfoForPrint(),
      fetchBranchInfoForPrint(employeeReport.employee.branchId || employeeReport.employee.branchCode || ''),
    ]);
    const emp = employeeReport.employee;
    const s = employeeReport.summary;

    const payrollRows = (employeeReport.payrollItems || []).map((pi: any, i: number) => `
      <tr>
        <td class="num">${i + 1}</td>
        <td>${formatDate(pi.date)}</td>
        <td>${pi.runNumber}</td>
        <td>${MONTHS_AR[pi.month - 1]} ${pi.year}</td>
        <td>${pi.runStatus === 'PAID' ? 'مدفوع' : pi.runStatus === 'APPROVED' ? 'معتمد' : pi.runStatus === 'VOIDED' ? 'ملغي' : pi.runStatus}</td>
        <td class="num">${pi.workDays || pi.workHours || 0}</td>
        <td class="num">${formatMoney(pi.baseAmount)}</td>
        <td class="num">${formatMoney(pi.allowances)}</td>
        <td class="num">${formatMoney(pi.deductions)}</td>
        <td class="num">${formatMoney(pi.advanceAmount)}</td>
        <td class="num"><strong>${formatMoney(pi.netAmount)}</strong></td>
      </tr>`).join('');

    const advanceRows = (employeeReport.advances || []).map((a: any, i: number) => `
      <tr>
        <td class="num">${i + 1}</td>
        <td>${formatDate(a.date)}</td>
        <td>${a.number}</td>
        <td>${a.reason || '—'}</td>
        <td class="num">${formatMoney(a.amount)}</td>
        <td class="num">${formatMoney(a.settledAmount)}</td>
        <td class="num">${formatMoney(a.remaining)}</td>
        <td>${a.status === 'SETTLED' ? 'مسوّى' : 'معلق'}</td>
      </tr>`).join('');

    const contentHtml = `
      <div class="section">
        <h3 style="margin:0 0 8px">بيانات الموظف</h3>
        <div class="meta-grid">
          <div><span>الكود:</span> <strong>${emp.code}</strong></div>
          <div><span>الاسم:</span> <strong>${emp.name}</strong></div>
          <div><span>الاسم الإنجليزي:</span> ${emp.nameEn || '—'}</div>
          <div><span>الوظيفة:</span> ${emp.position || '—'}</div>
          <div><span>رقم الهوية:</span> ${emp.iqamaNumber || '—'}</div>
          <div><span>الهاتف:</span> ${emp.phone || '—'}</div>
          <div><span>الفرع:</span> <strong>${branch?.name || emp.branchName || '—'}</strong></div>
          <div><span>نوع الراتب:</span> ${emp.salaryType === 'HOURLY' ? 'بالساعة' : 'شهري'}</div>
          <div><span>الراتب الأساسي:</span> ${formatMoney(emp.baseSalary)}</div>
          <div><span>تاريخ التوظيف:</span> ${formatDate(emp.hireDate)}</div>
          <div><span>الحالة:</span> ${emp.status === 'ACTIVE' ? 'نشط' : 'موقوف'}</div>
        </div>
      </div>

      <div class="section">
        <h3 style="margin:0 0 8px">ملخص الفترة</h3>
        <table>
          <tbody>
            <tr><td>عدد المسيرات</td><td class="num">${s.payrollRunCount}</td></tr>
            <tr><td>إجمالي الراتب الأساسي</td><td class="num">${formatMoney(s.totalBase)}</td></tr>
            <tr><td>إجمالي البدلات</td><td class="num">${formatMoney(s.totalAllowances)}</td></tr>
            <tr class="total-row"><td>الإجمالي (Gross)</td><td class="num">${formatMoney(s.totalGross)}</td></tr>
            <tr><td>إجمالي الخصومات</td><td class="num" style="color:#dc2626">(${formatMoney(s.totalDeductions)})</td></tr>
            <tr><td>إجمالي السلف المخصومة</td><td class="num" style="color:#d97706">(${formatMoney(s.totalAdvanceSettlements)})</td></tr>
            <tr class="total-row"><td><strong>صافي الرواتب المستلمة</strong></td><td class="num"><strong style="color:#15803d">${formatMoney(s.totalNet)}</strong></td></tr>
            <tr><td>إجمالي السلف المصروفة</td><td class="num">${formatMoney(s.totalAdvances)}</td></tr>
            <tr><td>السلف المسوّاة</td><td class="num" style="color:#15803d">${formatMoney(s.totalAdvancesSettled)}</td></tr>
            <tr><td>السلف المعلقة المتبقية</td><td class="num" style="color:#d97706">${formatMoney(s.outstandingAdvances)}</td></tr>
          </tbody>
        </table>
      </div>

      ${payrollRows ? `
      <div class="section">
        <h3 style="margin:0 0 8px">تفاصيل مسيرات الرواتب</h3>
        <table>
          <thead><tr><th>#</th><th>التاريخ</th><th>رقم المسير</th><th>الشهر</th><th>الحالة</th><th>أيام/ساعات</th><th>الأساسي</th><th>بدلات</th><th>خصومات</th><th>سلف</th><th>الصافي</th></tr></thead>
          <tbody>${payrollRows}</tbody>
        </table>
      </div>` : ''}

      ${advanceRows ? `
      <div class="section">
        <h3 style="margin:0 0 8px">سجل السلف</h3>
        <table>
          <thead><tr><th>#</th><th>التاريخ</th><th>الرقم</th><th>السبب</th><th>المبلغ</th><th>المسوّى</th><th>المتبقي</th><th>الحالة</th></tr></thead>
          <tbody>${advanceRows}</tbody>
        </table>
      </div>` : ''}
    `;

    printReportDocument({
      title: 'كشف حساب موظف',
      titleEn: 'Employee Payroll Statement',
      subtitle: emp.name,
      reportNumber: generateReportNumber('EMP'),
      company,
      branch,
      period: { from: dateFrom || 'البداية', to: dateTo || 'اليوم' },
      generatedBy: user?.name || '—',
      contentHtml,
      format: 'A4',
      orientation: 'landscape',
    });
  };

  const printSummaryReport = async () => {
    if (!summaryReport) return;
    const [company, branch] = await Promise.all([
      fetchCompanyInfoForPrint(),
      fetchBranchInfoForPrint(selectedBranchId !== 'all' ? selectedBranchId : ''),
    ]);
    const g = summaryReport.grandTotals;

    const branchRows = (summaryReport.branches || []).map((b: any, i: number) => `
      <tr>
        <td class="num">${i + 1}</td>
        <td>${b.branchName}</td>
        <td class="num">${b.employeeCount}</td>
        <td class="num">${b.runCount}</td>
        <td class="num">${formatMoney(b.totalGross)}</td>
        <td class="num">${formatMoney(b.totalDeductions)}</td>
        <td class="num">${formatMoney(b.totalAdvances)}</td>
        <td class="num"><strong style="color:#15803d">${formatMoney(b.totalNet)}</strong></td>
        <td class="num">${formatMoney(b.totalPaid)}</td>
      </tr>`).join('');

    const monthRows = (summaryReport.monthly || []).map((m: any) => `
      <tr>
        <td>${m.monthName}</td>
        <td class="num">${m.runCount}</td>
        <td class="num">${m.employeeCount}</td>
        <td class="num">${formatMoney(m.totalGross)}</td>
        <td class="num"><strong>${formatMoney(m.totalNet)}</strong></td>
        <td class="num">${formatMoney(m.totalPaid)}</td>
      </tr>`).join('');

    const contentHtml = `
      <div class="section">
        <h3 style="margin:0 0 8px">الملخص العام لسنة ${summaryReport.year}</h3>
        <div class="meta-grid">
          <div><span>السنة:</span> <strong>${summaryReport.year}</strong></div>
          <div><span>النطاق:</span> ${selectedBranchId === 'all' ? 'كل الفروع' : (branch?.name || '—')}</div>
          <div><span>عدد المسيرات:</span> ${g.runCount}</div>
          <div><span>عدد الموظفين (تراكمي):</span> ${g.employeeCount}</div>
        </div>
      </div>

      <div class="section">
        <h3 style="margin:0 0 8px">الإجماليات السنوية</h3>
        <table>
          <tbody>
            <tr><td>إجمالي الرواتب الأساسية</td><td class="num">${formatMoney(g.totalBase)}</td></tr>
            <tr><td>إجمالي البدلات</td><td class="num">${formatMoney(g.totalAllowances)}</td></tr>
            <tr class="total-row"><td>الإجمالي (Gross)</td><td class="num">${formatMoney(g.totalGross)}</td></tr>
            <tr><td>إجمالي الخصومات</td><td class="num" style="color:#dc2626">(${formatMoney(g.totalDeductions)})</td></tr>
            <tr><td>إجمالي السلف المخصومة من المسيرات</td><td class="num" style="color:#d97706">(${formatMoney(g.totalAdvances)})</td></tr>
            <tr class="total-row"><td><strong>صافي الرواتب</strong></td><td class="num"><strong style="color:#15803d">${formatMoney(g.totalNet)}</strong></td></tr>
            <tr><td>إجمالي المدفوع</td><td class="num" style="color:#15803d">${formatMoney(g.totalPaid)}</td></tr>
            <tr><td>السلف المصروفة في السنة</td><td class="num">${formatMoney(g.totalAdvancesIssued)}</td></tr>
            <tr><td>السلف المعلقة</td><td class="num" style="color:#d97706">${formatMoney(g.outstandingAdvances)}</td></tr>
          </tbody>
        </table>
      </div>

      ${selectedBranchId === 'all' && branchRows ? `
      <div class="section">
        <h3 style="margin:0 0 8px">تحليل الفروع</h3>
        <table>
          <thead><tr><th>#</th><th>الفرع</th><th>الموظفون</th><th>المسيرات</th><th>الإجمالي</th><th>الخصومات</th><th>السلف</th><th>الصافي</th><th>المدفوع</th></tr></thead>
          <tbody>
            ${branchRows}
            <tr class="total-row">
              <td colspan="2" style="text-align:right"><strong>الإجمالي</strong></td>
              <td class="num"><strong>${g.employeeCount}</strong></td>
              <td class="num"><strong>${g.runCount}</strong></td>
              <td class="num"><strong>${formatMoney(g.totalGross)}</strong></td>
              <td class="num"><strong>${formatMoney(g.totalDeductions)}</strong></td>
              <td class="num"><strong>${formatMoney(g.totalAdvances)}</strong></td>
              <td class="num"><strong>${formatMoney(g.totalNet)}</strong></td>
              <td class="num"><strong>${formatMoney(g.totalPaid)}</strong></td>
            </tr>
          </tbody>
        </table>
      </div>` : ''}

      <div class="section">
        <h3 style="margin:0 0 8px">التحليل الشهري</h3>
        <table>
          <thead><tr><th>الشهر</th><th>المسيرات</th><th>الموظفون</th><th>الإجمالي</th><th>الصافي</th><th>المدفوع</th></tr></thead>
          <tbody>${monthRows}</tbody>
        </table>
      </div>
    `;

    printReportDocument({
      title: 'ملخص الرواتب السنوي',
      titleEn: 'Annual Payroll Summary',
      subtitle: `سنة ${summaryReport.year}`,
      reportNumber: generateReportNumber('PS'),
      company,
      branch,
      period: { from: `01/01/${summaryReport.year}`, to: `31/12/${summaryReport.year}` },
      generatedBy: user?.name || '—',
      contentHtml,
      format: 'A4',
      orientation: 'portrait',
    });
  };

  return (
    <div className="space-y-4">
      <Tabs value={reportType} onValueChange={(v) => setReportType(v as any)}>
        <TabsList>
          <TabsTrigger value="summary"><TrendingUp className="size-4" /> ملخص سنوي</TabsTrigger>
          <TabsTrigger value="employee"><Users className="size-4" /> كشف موظف</TabsTrigger>
        </TabsList>

        {/* Summary Report */}
        <TabsContent value="summary" className="mt-4 space-y-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">السنة</Label>
                  <Input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} className="w-28" />
                </div>
                <Button onClick={runSummaryReport} disabled={loading}>
                  {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                  تحديث
                </Button>
                {summaryReport && (
                  <Button variant="outline" onClick={printSummaryReport}>
                    <Printer className="size-4" /> طباعة / PDF
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          {summaryReport && (
            <>
              {/* Grand totals */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Card><CardContent className="p-4">
                  <p className="text-xs text-muted-foreground">إجمالي الإجمالي</p>
                  <p className="text-lg font-bold font-mono">{formatMoney(summaryReport.grandTotals.totalGross)}</p>
                </CardContent></Card>
                <Card><CardContent className="p-4">
                  <p className="text-xs text-muted-foreground">صافي الرواتب</p>
                  <p className="text-lg font-bold font-mono text-green-600">{formatMoney(summaryReport.grandTotals.totalNet)}</p>
                </CardContent></Card>
                <Card><CardContent className="p-4">
                  <p className="text-xs text-muted-foreground">المدفوع</p>
                  <p className="text-lg font-bold font-mono text-green-600">{formatMoney(summaryReport.grandTotals.totalPaid)}</p>
                </CardContent></Card>
                <Card><CardContent className="p-4">
                  <p className="text-xs text-muted-foreground">السلف المعلقة</p>
                  <p className="text-lg font-bold font-mono text-amber-600">{formatMoney(summaryReport.grandTotals.outstandingAdvances)}</p>
                </CardContent></Card>
              </div>

              {/* Branches breakdown */}
              {selectedBranchId === 'all' && summaryReport.branches?.length > 0 && (
                <Card>
                  <CardHeader><CardTitle className="text-base">تحليل الفروع</CardTitle></CardHeader>
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>الفرع</TableHead>
                          <TableHead className="text-center">الموظفون</TableHead>
                          <TableHead className="text-center">المسيرات</TableHead>
                          <TableHead className="text-left">الإجمالي</TableHead>
                          <TableHead className="text-left">الخصومات</TableHead>
                          <TableHead className="text-left">السلف</TableHead>
                          <TableHead className="text-left">الصافي</TableHead>
                          <TableHead className="text-left">المدفوع</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {summaryReport.branches.map((b: any) => (
                          <TableRow key={b.branchId}>
                            <TableCell className="font-medium">{b.branchName}</TableCell>
                            <TableCell className="text-center">{b.employeeCount}</TableCell>
                            <TableCell className="text-center">{b.runCount}</TableCell>
                            <TableCell className="text-left font-mono">{formatMoney(b.totalGross)}</TableCell>
                            <TableCell className="text-left font-mono text-red-600">({formatMoney(b.totalDeductions)})</TableCell>
                            <TableCell className="text-left font-mono text-amber-600">({formatMoney(b.totalAdvances)})</TableCell>
                            <TableCell className="text-left font-mono font-semibold text-green-700">{formatMoney(b.totalNet)}</TableCell>
                            <TableCell className="text-left font-mono text-green-600">{formatMoney(b.totalPaid)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )}

              {/* Monthly breakdown */}
              <Card>
                <CardHeader><CardTitle className="text-base">التحليل الشهري</CardTitle></CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>الشهر</TableHead>
                        <TableHead className="text-center">المسيرات</TableHead>
                        <TableHead className="text-center">الموظفون</TableHead>
                        <TableHead className="text-left">الإجمالي</TableHead>
                        <TableHead className="text-left">الصافي</TableHead>
                        <TableHead className="text-left">المدفوع</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {summaryReport.monthly.map((m: any) => (
                        <TableRow key={m.month}>
                          <TableCell className="font-medium">{m.monthName}</TableCell>
                          <TableCell className="text-center">{m.runCount}</TableCell>
                          <TableCell className="text-center">{m.employeeCount}</TableCell>
                          <TableCell className="text-left font-mono">{formatMoney(m.totalGross)}</TableCell>
                          <TableCell className="text-left font-mono font-semibold">{formatMoney(m.totalNet)}</TableCell>
                          <TableCell className="text-left font-mono text-green-600">{formatMoney(m.totalPaid)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        {/* Employee Statement */}
        <TabsContent value="employee" className="mt-4 space-y-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex flex-wrap items-end gap-3">
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
                <Button onClick={runEmployeeReport} disabled={loading || !selectedEmployeeId}>
                  {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                  عرض
                </Button>
                {employeeReport && (
                  <Button variant="outline" onClick={printEmployeeReport}>
                    <Printer className="size-4" /> طباعة / PDF
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          {employeeReport && (
            <>
              {/* Employee info */}
              <Card>
                <CardHeader><CardTitle className="text-base">بيانات الموظف</CardTitle></CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                    <div><span className="text-muted-foreground">الكود:</span> <strong>{employeeReport.employee.code}</strong></div>
                    <div><span className="text-muted-foreground">الاسم:</span> <strong>{employeeReport.employee.name}</strong></div>
                    <div><span className="text-muted-foreground">الوظيفة:</span> {employeeReport.employee.position || '—'}</div>
                    <div><span className="text-muted-foreground">الهوية:</span> {employeeReport.employee.iqamaNumber || '—'}</div>
                    <div><span className="text-muted-foreground">الهاتف:</span> {employeeReport.employee.phone || '—'}</div>
                    <div><span className="text-muted-foreground">الفرع:</span> {employeeReport.employee.branchNameEn || employeeReport.employee.branchName}</div>
                    <div><span className="text-muted-foreground">نوع الراتب:</span> {employeeReport.employee.salaryType === 'HOURLY' ? 'بالساعة' : 'شهري'}</div>
                    <div><span className="text-muted-foreground">الراتب الأساسي:</span> {formatMoney(employeeReport.employee.baseSalary)}</div>
                  </div>
                </CardContent>
              </Card>

              {/* Summary */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Card><CardContent className="p-4">
                  <p className="text-xs text-muted-foreground">إجمالي الإجمالي</p>
                  <p className="text-lg font-bold font-mono">{formatMoney(employeeReport.summary.totalGross)}</p>
                </CardContent></Card>
                <Card><CardContent className="p-4">
                  <p className="text-xs text-muted-foreground">صافي الرواتب</p>
                  <p className="text-lg font-bold font-mono text-green-600">{formatMoney(employeeReport.summary.totalNet)}</p>
                </CardContent></Card>
                <Card><CardContent className="p-4">
                  <p className="text-xs text-muted-foreground">إجمالي السلف</p>
                  <p className="text-lg font-bold font-mono">{formatMoney(employeeReport.summary.totalAdvances)}</p>
                </CardContent></Card>
                <Card><CardContent className="p-4">
                  <p className="text-xs text-muted-foreground">السلف المعلقة</p>
                  <p className="text-lg font-bold font-mono text-amber-600">{formatMoney(employeeReport.summary.outstandingAdvances)}</p>
                </CardContent></Card>
              </div>

              {/* Payroll history */}
              <Card>
                <CardHeader><CardTitle className="text-base">سجل مسيرات الرواتب</CardTitle></CardHeader>
                <CardContent className="p-0">
                  {employeeReport.payrollItems?.length ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>التاريخ</TableHead>
                          <TableHead>رقم المسير</TableHead>
                          <TableHead>الشهر</TableHead>
                          <TableHead>الحالة</TableHead>
                          <TableHead className="text-left">الأساسي</TableHead>
                          <TableHead className="text-left">بدلات</TableHead>
                          <TableHead className="text-left">خصومات</TableHead>
                          <TableHead className="text-left">سلف</TableHead>
                          <TableHead className="text-left">الصافي</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {employeeReport.payrollItems.map((pi: any) => (
                          <TableRow key={pi.id} className={pi.runStatus === 'VOIDED' ? 'opacity-50' : ''}>
                            <TableCell className="text-xs">{formatDate(pi.date)}</TableCell>
                            <TableCell className="font-mono text-xs">{pi.runNumber}</TableCell>
                            <TableCell className="text-sm">{MONTHS_AR[pi.month - 1]} {pi.year}</TableCell>
                            <TableCell><StatusBadge status={pi.runStatus} /></TableCell>
                            <TableCell className="text-left font-mono">{formatMoney(pi.baseAmount)}</TableCell>
                            <TableCell className="text-left font-mono text-green-600">{formatMoney(pi.allowances)}</TableCell>
                            <TableCell className="text-left font-mono text-red-600">({formatMoney(pi.deductions)})</TableCell>
                            <TableCell className="text-left font-mono text-amber-600">({formatMoney(pi.advanceAmount)})</TableCell>
                            <TableCell className="text-left font-mono font-bold text-green-700">{formatMoney(pi.netAmount)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : (
                    <div className="p-6 text-center text-sm text-muted-foreground">لا توجد مسيرات رواتب في هذه الفترة</div>
                  )}
                </CardContent>
              </Card>

              {/* Advances history */}
              <Card>
                <CardHeader><CardTitle className="text-base">سجل السلف</CardTitle></CardHeader>
                <CardContent className="p-0">
                  {employeeReport.advances?.length ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>التاريخ</TableHead>
                          <TableHead>الرقم</TableHead>
                          <TableHead>السبب</TableHead>
                          <TableHead className="text-left">المبلغ</TableHead>
                          <TableHead className="text-left">المسوّى</TableHead>
                          <TableHead className="text-left">المتبقي</TableHead>
                          <TableHead>الحالة</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {employeeReport.advances.map((a: any) => (
                          <TableRow key={a.id}>
                            <TableCell className="text-xs">{formatDate(a.date)}</TableCell>
                            <TableCell className="font-mono text-xs">{a.number}</TableCell>
                            <TableCell className="text-sm">{a.reason || '—'}</TableCell>
                            <TableCell className="text-left font-mono">{formatMoney(a.amount)}</TableCell>
                            <TableCell className="text-left font-mono text-green-600">{formatMoney(a.settledAmount)}</TableCell>
                            <TableCell className="text-left font-mono text-amber-600">{formatMoney(a.remaining)}</TableCell>
                            <TableCell><StatusBadge status={a.status} /></TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : (
                    <div className="p-6 text-center text-sm text-muted-foreground">لا توجد سلف في هذه الفترة</div>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
