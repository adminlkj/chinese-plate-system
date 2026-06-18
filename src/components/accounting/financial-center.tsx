'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Printer, CheckCircle2, X, TrendingUp, TrendingDown, Scale, FileSpreadsheet, AlertTriangle, FileText, Loader2, Download, Save, Send, Lock, Unlock, RefreshCw, Trash2, History } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { CurrencyAmount } from '@/components/ui/currency-symbol';
import { toast } from 'sonner';
import { exportToExcel } from '@/lib/export-utils';
import { printReportDocument, fetchCompanyInfoForPrint, generateReportNumber } from '@/lib/report-print';
import { useAppStore } from '@/lib/store';
import { AccountCodeBadge } from '@/components/accounting/account-code-badge';
import { useTranslation } from '@/lib/i18n';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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

interface FinancialCenterAccount {
  code: string;
  name: string;
  nameEn?: string;
  balance: number;
  normalSide: string;
  isAbnormal: boolean;
}

interface FinancialCenterData {
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
  netIncome: number;
  totalRevenue: number;
  totalExpenses: number;
  assetAccounts: FinancialCenterAccount[];
  liabilityAccounts: FinancialCenterAccount[];
  equityAccounts: FinancialCenterAccount[];
  vatBreakdown?: {
    inputTax: number;
    outputTax: number;
    unsettledNetTax: number;
    taxPayable: number;
  };
  accountingEquation: {
    assets: number;
    liabilitiesPlusEquity: number;
    isBalanced: boolean;
  };
}

interface QuarterlyReportData {
  company: {
    name: string;
    nameEn: string;
    taxNumber: string;
    activity: string;
    crNumber: string;
  };
  quarter: {
    number: number;
    year: number;
    label: string;
    periodLabel: string;
    startDate: string;
    endDate: string;
  };
  summary: {
    totalSalesBase: number;
    totalSalesReturnsBase: number;
    netSalesBase: number;
    totalPurchaseBase: number;
    totalPurchaseReturnsBase: number;
    netPurchaseBase: number;
    totalOutputTax: number;
    totalInputTax: number;
    netVAT: number;
    vatStatus: string;
  };
  monthlyBreakdown: {
    month: number;
    label: string;
    salesBase: number;
    salesReturns: number;
    netSales: number;
    purchasesBase: number;
    outputTax: number;
    inputTax: number;
    netVAT: number;
  }[];
  branchBreakdown: Record<string, { salesBase: number; outputTax: number; purchasesBase: number; inputTax: number }>;
  currentBalances: {
    outputTax: number;
    inputTax: number;
    unsettledNet: number;
  };
  settlements: { date: string; description: string; amount: number; type: string }[];
}

// ─── Persisted VAT Declaration (state-machine entity) ───────────────
// See AUDIT-10-VAT-MACHINE: declarations are persisted with status
// DRAFT → SUBMITTED → LOCKED (terminal VOIDED).
interface VatDeclarationItem {
  id: string;
  number: string;
  branchId: string;
  branchName?: string;
  branchNameEn?: string;
  branchCode?: string;
  year: number;
  quarter: number;
  status: 'DRAFT' | 'SUBMITTED' | 'LOCKED' | 'VOIDED';
  totalSalesBase: number;
  totalSalesReturnsBase: number;
  netSalesBase: number;
  totalPurchaseBase: number;
  totalPurchaseReturnsBase: number;
  netPurchaseBase: number;
  totalOutputTax: number;
  totalInputTax: number;
  netVAT: number;
  createdAt: string;
  createdByName?: string | null;
  submittedAt?: string | null;
  submittedByName?: string | null;
  lockedAt?: string | null;
  lockedByName?: string | null;
  reopenedAt?: string | null;
  reopenedByName?: string | null;
  reopenReason?: string | null;
  notes?: string | null;
}

// Helper component to display a balance with proper debit/credit indicator
function BalanceDisplay({ 
  account, 
  t 
}: { 
  account: FinancialCenterAccount; 
  t: any;
}) {
  const displayAmount = Math.abs(account.balance);
  const isAbnormal = account.isAbnormal;
  
  return (
    <div className="flex items-center gap-1.5">
      <CurrencyAmount amount={displayAmount} symbolClassName="w-3.5 h-3.5" />
      {isAbnormal && (
        <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-red-300 text-red-600 dark:border-red-700 dark:text-red-400">
          {account.normalSide === 'DEBIT' ? t.creditBalanceIndicator : t.debitBalanceIndicator}
        </Badge>
      )}
    </div>
  );
}

export default function FinancialCenter() {
  const { t, isRTL } = useTranslation();
  const { user } = useAppStore();
  const [data, setData] = useState<FinancialCenterData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hideZeroBalances, setHideZeroBalances] = useState(false);

  // VAT Declaration dialog state
  const [vatDialogOpen, setVatDialogOpen] = useState(false);
  const [selectedYear, setSelectedYear] = useState(String(new Date().getFullYear()));
  const [selectedQuarter, setSelectedQuarter] = useState(String(Math.ceil((new Date().getMonth() + 1) / 3)));
  const [vatReport, setVatReport] = useState<QuarterlyReportData | null>(null);
  const [vatReportLoading, setVatReportLoading] = useState(false);
  const [vatReportError, setVatReportError] = useState<string | null>(null);

  // ─── Persisted VAT Declarations (state machine) ───
  const [declarations, setDeclarations] = useState<VatDeclarationItem[]>([]);
  const [declarationsLoading, setDeclarationsLoading] = useState(false);
  const [declarationsDialogOpen, setDeclarationsDialogOpen] = useState(false);
  const [saveDeclLoading, setSaveDeclLoading] = useState(false);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  // Reopen dialog state
  const [reopenTarget, setReopenTarget] = useState<VatDeclarationItem | null>(null);
  const [reopenReason, setReopenReason] = useState('');
  const [reopenTargetStatus, setReopenTargetStatus] = useState<'DRAFT' | 'SUBMITTED'>('DRAFT');
  // Delete confirmation state
  const [deleteTarget, setDeleteTarget] = useState<VatDeclarationItem | null>(null);

  const isAdmin = user?.role === 'ADMIN';

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/reports/financial-center');
      if (!res.ok) throw new Error(t.failedToFetchData);
      const json = await res.json();
      setData(json);
    } catch (err: any) {
      setError(err.message || t.errorLoadingData);
    } finally {
      setLoading(false);
    }
  }, [t.failedToFetchData, t.errorLoadingData]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Fetch VAT quarterly report
  const fetchVatReport = useCallback(async () => {
    setVatReportLoading(true);
    setVatReportError(null);
    setVatReport(null);
    try {
      const res = await fetch(`/api/vat/quarterly-report?year=${selectedYear}&quarter=${selectedQuarter}`);
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || t.failedToFetchData);
      }
      const json = await res.json();
      setVatReport(json);
    } catch (err: any) {
      setVatReportError(err.message || t.errorLoadingData);
    } finally {
      setVatReportLoading(false);
    }
  }, [selectedYear, selectedQuarter, t.failedToFetchData, t.errorLoadingData]);

  // ─── Persisted declarations: list / create / state transitions ───

  const fetchDeclarations = useCallback(async () => {
    setDeclarationsLoading(true);
    try {
      const res = await fetch('/api/vat/declarations?pageSize=100');
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || t.failedToFetchData);
      }
      const json = await res.json();
      setDeclarations(Array.isArray(json.declarations) ? json.declarations : []);
    } catch (err: any) {
      toast.error(err.message || t.errorLoadingData);
      setDeclarations([]);
    } finally {
      setDeclarationsLoading(false);
    }
  }, [t.failedToFetchData, t.errorLoadingData]);

  // Open the saved-declarations dialog and refresh the list
  const openDeclarationsDialog = useCallback(() => {
    setDeclarationsDialogOpen(true);
    void fetchDeclarations();
  }, [fetchDeclarations]);

  // Save the currently displayed quarterly report as a new DRAFT declaration
  const handleSaveDeclaration = async () => {
    if (!vatReport) return;
    setSaveDeclLoading(true);
    try {
      const res = await fetch('/api/vat/declarations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          year: vatReport.quarter.year,
          quarter: vatReport.quarter.number,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || t.failedToSave || 'فشل في حفظ الإقرار');
      }
      toast.success(`${t.declarationSaved || 'تم حفظ الإقرار'}: ${data.number}`);
      // Refresh the saved declarations list (if dialog is open)
      if (declarationsDialogOpen) void fetchDeclarations();
    } catch (err: any) {
      toast.error(err.message || t.failedToSave || 'فشل في حفظ الإقرار');
    } finally {
      setSaveDeclLoading(false);
    }
  };

  // Submit (DRAFT → SUBMITTED) — ADMIN+MANAGER
  const handleSubmitDeclaration = async (decl: VatDeclarationItem) => {
    setActionLoadingId(decl.id);
    try {
      const res = await fetch(`/api/vat/declarations/${decl.id}/submit`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'فشل في تقديم الإقرار');
      toast.success(t.declarationSubmitted || 'تم تقديم الإقرار للمراجعة');
      void fetchDeclarations();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setActionLoadingId(null);
    }
  };

  // Lock (SUBMITTED → LOCKED) — ADMIN only
  const handleLockDeclaration = async (decl: VatDeclarationItem) => {
    setActionLoadingId(decl.id);
    try {
      const res = await fetch(`/api/vat/declarations/${decl.id}/lock`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'فشل في إقفال الإقرار');
      toast.success(t.declarationLocked || 'تم إقفال الإقرار');
      void fetchDeclarations();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setActionLoadingId(null);
    }
  };

  // Regenerate totals (DRAFT only) — recompute from transactions
  const handleRegenerateDeclaration = async (decl: VatDeclarationItem) => {
    setActionLoadingId(decl.id);
    try {
      const res = await fetch(`/api/vat/declarations/${decl.id}/regenerate`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'فشل في إعادة الاحتساب');
      toast.success(t.declarationRegenerated || 'تم إعادة احتساب الإقرار');
      void fetchDeclarations();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setActionLoadingId(null);
    }
  };

  // Delete (DRAFT → VOIDED) — ADMIN only
  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    const decl = deleteTarget;
    setActionLoadingId(decl.id);
    setDeleteTarget(null);
    try {
      const res = await fetch(`/api/vat/declarations/${decl.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'فشل في حذف الإقرار');
      toast.success(t.declarationDeleted || 'تم حذف الإقرار');
      void fetchDeclarations();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setActionLoadingId(null);
    }
  };

  // Reopen dialog handlers (LOCKED|SUBMITTED → DRAFT|SUBMITTED) — ADMIN only
  const openReopenDialog = (decl: VatDeclarationItem) => {
    setReopenTarget(decl);
    setReopenReason('');
    setReopenTargetStatus('DRAFT');
  };

  const handleConfirmReopen = async () => {
    if (!reopenTarget) return;
    if (!reopenReason.trim()) {
      toast.error(t.reopenReasonRequired || 'سبب إعادة الفتح مطلوب');
      return;
    }
    const decl = reopenTarget;
    setActionLoadingId(decl.id);
    setReopenTarget(null);
    try {
      const res = await fetch(`/api/vat/declarations/${decl.id}/reopen`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reopenReason.trim(), targetStatus: reopenTargetStatus }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'فشل في إعادة فتح الإقرار');
      toast.success(t.declarationReopened || 'تم إعادة فتح الإقرار');
      void fetchDeclarations();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setActionLoadingId(null);
    }
  };

  // Status badge renderer for declarations
  const renderStatusBadge = (status: VatDeclarationItem['status']) => {
    const map: Record<string, { label: string; className: string }> = {
      DRAFT:     { label: t.declStatusDraft     || 'مسودة',  className: 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-700' },
      SUBMITTED: { label: t.declStatusSubmitted || 'مقدّم',  className: 'bg-sky-100 text-sky-800 border-sky-300 dark:bg-sky-900/40 dark:text-sky-300 dark:border-sky-700' },
      LOCKED:    { label: t.declStatusLocked    || 'مقفل',   className: 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-900/40 dark:text-emerald-300 dark:border-emerald-700' },
      VOIDED:    { label: t.declStatusVoided    || 'ملغي',   className: 'bg-gray-100 text-gray-700 border-gray-300 dark:bg-gray-800/60 dark:text-gray-400 dark:border-gray-700' },
    };
    const cfg = map[status] || map.DRAFT;
    return (
      <Badge variant="outline" className={`text-[10px] px-2 py-0.5 ${cfg.className}`}>
        {cfg.label}
      </Badge>
    );
  };

  // Generate year options
  const currentYear = new Date().getFullYear();
  const yearOptions: number[] = [];
  for (let y = currentYear; y >= currentYear - 5; y--) {
    yearOptions.push(y);
  }

  // Filter accounts based on hideZeroBalances
  const filterAccounts = (accounts: FinancialCenterAccount[]) =>
    hideZeroBalances ? accounts.filter((a) => a.balance !== 0) : accounts;

  // Format balance for print - always positive with indicator
  const formatBalanceForPrint = (account: FinancialCenterAccount) => {
    const amount = Math.abs(account.balance).toFixed(2);
    if (account.isAbnormal) {
      const indicator = account.normalSide === 'DEBIT' ? t.creditBalanceIndicator : t.debitBalanceIndicator;
      return `${amount} ر.س ${indicator}`;
    }
    return `${amount} ر.س`;
  };

  // Print VAT declaration
  const handlePrintVatDeclaration = async () => {
    if (!vatReport) return;

    const fmt = (n: number) => Math.abs(n).toFixed(2);
    const s = vatReport.summary;
    const q = vatReport.quarter;

    let html = '';

    // Company info header (the canonical letterhead also carries company name/
    // logo/VAT — this card adds the CR/activity/period detail specific to VAT)
    html += `<div class="card">`;
    html += `<div class="card-header">${t.vatDeclarationTitle || 'إقرار ضريبة القيمة المضافة'}</div>`;
    html += `<div class="grid grid-cols-2 gap-3">`;
    html += `<div><strong>${t.companyName || 'اسم المنشأة'}:</strong> ${vatReport.company.name || '—'}</div>`;
    if (vatReport.company.nameEn) {
      html += `<div><strong>Name:</strong> ${vatReport.company.nameEn}</div>`;
    }
    html += `<div><strong>${t.taxNumber || 'الرقم الضريبي'}:</strong> ${vatReport.company.taxNumber || '—'}</div>`;
    html += `<div><strong>${t.vatDeclarationPeriod || 'الفترة الضريبية'}:</strong> ${q.periodLabel}</div>`;
    if (vatReport.company.crNumber) {
      html += `<div><strong>${t.crNumber || 'السجل التجاري'}:</strong> ${vatReport.company.crNumber}</div>`;
    }
    if (vatReport.company.activity) {
      html += `<div><strong>${t.activity || 'النشاط'}:</strong> ${vatReport.company.activity}</div>`;
    }
    html += `</div></div>`;

    // Section 1: Sales
    html += `<div class="section"><div class="section-title">${t.vatDeclarationSales || 'أولاً: المبيعات والضريبة على المخرجات'}</div>`;
    html += `<table><thead><tr>
      <th>${t.description || 'البيان'}</th>
      <th class="text-left">${t.amount || 'المبلغ'}</th>
    </tr></thead><tbody>`;
    html += `<tr><td>${t.totalSalesBase || 'إجمالي المبيعات (قبل الضريبة)'}</td><td class="num">${fmt(s.totalSalesBase)}</td></tr>`;
    if (s.totalSalesReturnsBase > 0.01) {
      html += `<tr><td>${t.totalSalesReturnsBase || 'مرتجعات المبيعات (قبل الضريبة)'}</td><td class="num text-red">(${fmt(s.totalSalesReturnsBase)})</td></tr>`;
      html += `<tr><td><strong>${t.netSalesBase || 'صافي المبيعات (قبل الضريبة)'}</strong></td><td class="num"><strong>${fmt(s.netSalesBase)}</strong></td></tr>`;
    }
    html += `<tr class="total-row"><td>${t.totalOutputTax || 'إجمالي ضريبة المخرجات (15%)'}</td><td class="num">${fmt(s.totalOutputTax)}</td></tr>`;
    html += `</tbody></table></div>`;

    // Section 2: Purchases
    html += `<div class="section"><div class="section-title">${t.vatDeclarationPurchases || 'ثانياً: المشتريات والضريبة على المدخلات'}</div>`;
    html += `<table><thead><tr>
      <th>${t.description || 'البيان'}</th>
      <th class="text-left">${t.amount || 'المبلغ'}</th>
    </tr></thead><tbody>`;
    html += `<tr><td>${t.totalPurchaseBase || 'إجمالي المشتريات (قبل الضريبة)'}</td><td class="num">${fmt(s.totalPurchaseBase)}</td></tr>`;
    if (s.totalPurchaseReturnsBase > 0.01) {
      html += `<tr><td>${t.totalPurchaseReturnsBase || 'مرتجعات المشتريات (قبل الضريبة)'}</td><td class="num text-red">(${fmt(s.totalPurchaseReturnsBase)})</td></tr>`;
      html += `<tr><td><strong>${t.netPurchaseBase || 'صافي المشتريات (قبل الضريبة)'}</strong></td><td class="num"><strong>${fmt(s.netPurchaseBase)}</strong></td></tr>`;
    }
    html += `<tr class="total-row"><td>${t.totalInputTax || 'إجمالي ضريبة المدخلات (15%)'}</td><td class="num">${fmt(s.totalInputTax)}</td></tr>`;
    html += `</tbody></table></div>`;

    // Section 3: Net VAT
    html += `<div class="section"><div class="section-title">${t.vatDeclarationNet || 'ثالثاً: صافي الضريبة المستحقة'}</div>`;
    html += `<table><thead><tr>
      <th>${t.description || 'البيان'}</th>
      <th class="text-left">${t.amount || 'المبلغ'}</th>
    </tr></thead><tbody>`;
    html += `<tr><td>${t.totalOutputTax || 'ضريبة المخرجات'}</td><td class="num">${fmt(s.totalOutputTax)}</td></tr>`;
    html += `<tr><td>${t.totalInputTax || 'ضريبة المدخلات'} (-)</td><td class="num">${fmt(s.totalInputTax)}</td></tr>`;
    const netClass = s.netVAT >= 0 ? 'text-red' : 'text-green';
    const netLabel = s.netVAT >= 0
      ? (t.vatPayableToAuthority || 'صافي الضريبة المستحقة للهيئة')
      : (t.vatRefundFromAuthority || 'صافي الضريبة المستردة من الهيئة');
    html += `<tr class="total-row"><td>${netLabel}</td><td class="num ${netClass}"><strong>${fmt(s.netVAT)}</strong></td></tr>`;
    html += `</tbody></table></div>`;

    // Monthly breakdown
    if (vatReport.monthlyBreakdown.length > 0) {
      html += `<div class="section"><div class="section-title">${t.vatMonthlyBreakdown || 'تفصيل شهري'}</div>`;
      html += `<table><thead><tr>
        <th>${t.month || 'الشهر'}</th>
        <th class="text-left">${t.netSales || 'صافي المبيعات'}</th>
        <th class="text-left">${t.outputTax || 'ضريبة مخرجات'}</th>
        <th class="text-left">${t.purchasesBase || 'المشتريات'}</th>
        <th class="text-left">${t.inputTax || 'ضريبة مدخلات'}</th>
        <th class="text-left">${t.netVAT || 'صافي الضريبة'}</th>
      </tr></thead><tbody>`;
      for (const m of vatReport.monthlyBreakdown) {
        html += `<tr>
          <td>${m.label}</td>
          <td class="num">${fmt(m.netSales)}</td>
          <td class="num">${fmt(m.outputTax)}</td>
          <td class="num">${fmt(m.purchasesBase)}</td>
          <td class="num">${fmt(m.inputTax)}</td>
          <td class="num ${m.netVAT >= 0 ? 'text-red' : 'text-green'}"><strong>${fmt(m.netVAT)}</strong></td>
        </tr>`;
      }
      html += `</tbody></table></div>`;
    }

    // Settlements within quarter
    if (vatReport.settlements.length > 0) {
      html += `<div class="section"><div class="section-title">${t.vatSettlementsInQuarter || 'تسويات وسداد الضريبة خلال الربع'}</div>`;
      html += `<table><thead><tr>
        <th>${t.date || 'التاريخ'}</th>
        <th>${t.description || 'البيان'}</th>
        <th>${t.type || 'النوع'}</th>
        <th class="text-left">${t.amount || 'المبلغ'}</th>
      </tr></thead><tbody>`;
      for (const st of vatReport.settlements) {
        const typeLabel = st.type === 'SETTLEMENT'
          ? (t.vatSettlement || 'إقفال الضريبة')
          : (t.vatPayment || 'سداد الضريبة');
        html += `<tr>
          <td>${st.date}</td>
          <td>${st.description}</td>
          <td><span class="badge ${st.type === 'SETTLEMENT' ? 'badge-amber' : 'badge-green'}">${typeLabel}</span></td>
          <td class="num">${fmt(st.amount)}</td>
        </tr>`;
      }
      html += `</tbody></table></div>`;
    }

    // Signature area
    html += `<div style="margin-top:30px;border-top:2px solid #1f2937;padding-top:18px">`;
    html += `<div class="grid grid-cols-2 gap-4">`;
    html += `<div style="text-align:center">
      <div style="border-bottom:1px solid #1f2937;margin-bottom:8px;padding-bottom:30px"></div>
      <div><strong>${t.preparedBy || 'أعد بواسطة'}</strong></div>
    </div>`;
    html += `<div style="text-align:center">
      <div style="border-bottom:1px solid #1f2937;margin-bottom:8px;padding-bottom:30px"></div>
      <div><strong>${t.approvedBy || 'اعتمد بواسطة'}</strong></div>
    </div>`;
    html += `</div></div>`;

    const company = await fetchCompanyInfoForPrint();

    const success = printReportDocument({
      title: t.vatDeclarationTitle || 'إقرار ضريبة القيمة المضافة',
      titleEn: 'VAT Declaration',
      subtitle: q.periodLabel,
      reportNumber: generateReportNumber(`VAT-Q${q.number}`),
      company: {
        ...company,
        name: vatReport.company.name || company.name,
        nameEn: vatReport.company.nameEn || company.nameEn,
        taxNumber: vatReport.company.taxNumber || company.taxNumber,
      },
      period: { from: q.startDate || '—', to: q.endDate || '—' },
      generatedBy: user?.name || '—',
      contentHtml: html,
      format: 'A4',
    });

    if (!success) {
      toast.error(t.failedToOpenPrint || 'فشل في فتح نافذة الطباعة');
    }
  };

  // Export VAT declaration to Excel
  const handleExportVatExcel = () => {
    if (!vatReport) return;

    const fmt = (n: number) => Math.abs(n).toFixed(2);
    const s = vatReport.summary;

    const data = [
      // Summary rows
      { section: t.vatDeclarationSales || 'المبيعات', item: t.totalSalesBase || 'إجمالي المبيعات', amount: fmt(s.totalSalesBase) },
      { section: '', item: t.totalSalesReturnsBase || 'مرتجعات المبيعات', amount: s.totalSalesReturnsBase > 0 ? `(${fmt(s.totalSalesReturnsBase)})` : '0.00' },
      { section: '', item: t.netSalesBase || 'صافي المبيعات', amount: fmt(s.netSalesBase) },
      { section: '', item: t.totalOutputTax || 'ضريبة المخرجات', amount: fmt(s.totalOutputTax) },
      { section: t.vatDeclarationPurchases || 'المشتريات', item: t.totalPurchaseBase || 'إجمالي المشتريات', amount: fmt(s.totalPurchaseBase) },
      { section: '', item: t.totalPurchaseReturnsBase || 'مرتجعات المشتريات', amount: s.totalPurchaseReturnsBase > 0 ? `(${fmt(s.totalPurchaseReturnsBase)})` : '0.00' },
      { section: '', item: t.netPurchaseBase || 'صافي المشتريات', amount: fmt(s.netPurchaseBase) },
      { section: '', item: t.totalInputTax || 'ضريبة المدخلات', amount: fmt(s.totalInputTax) },
      { section: t.vatDeclarationNet || 'صافي الضريبة', item: t.netVAT || 'صافي الضريبة المستحقة', amount: fmt(s.netVAT) },
      // Monthly breakdown
      ...vatReport.monthlyBreakdown.map(m => ({
        section: m.label,
        item: t.netSales || 'صافي المبيعات',
        amount: fmt(m.netSales),
      })),
    ];

    exportToExcel({
      data,
      columns: [
        { key: 'section', header: t.section || 'القسم', width: 20 },
        { key: 'item', header: t.description || 'البيان', width: 30 },
        { key: 'amount', header: t.amount || 'المبلغ (ر.س)', width: 18 },
      ],
      sheetName: t.vatDeclarationTitle || 'إقرار ضريبي',
      fileName: `VAT-Declaration-Q${vatReport.quarter.number}-${vatReport.quarter.year}.xlsx`,
      title: t.vatDeclarationTitle || 'إقرار ضريبة القيمة المضافة',
      subtitle: vatReport.quarter.periodLabel,
    });
  };

  const handlePrint = async () => {
    if (!data) return;
    let html = '';

    // Assets section
    html += `<div class="section"><div class="section-title">${t.assetsLabel}</div>`;
    html += `<table><thead><tr>
      <th>${t.accountCode}</th><th>${t.accountName}</th><th class="text-left">${t.currentBalance}</th><th class="text-center">${t.debitLabel}/${t.creditLabel}</th>
    </tr></thead><tbody>`;
    for (const acc of filterAccounts(data.assetAccounts)) {
      const indicator = acc.isAbnormal
        ? `<span class="text-red text-sm">${acc.normalSide === 'DEBIT' ? t.creditBalanceIndicator : t.debitBalanceIndicator}</span>`
        : `<span class="text-green text-sm">${acc.normalSide === 'DEBIT' ? t.debitLabel : t.creditLabel}</span>`;
      html += `<tr>
        <td class="font-mono text-sm">${acc.code}</td>
        <td>${acc.name}</td>
        <td class="num">${Math.abs(acc.balance).toFixed(2)}</td>
        <td class="text-center">${indicator}</td>
      </tr>`;
    }
    html += `<tr class="total-row">
      <td colspan="2">${t.totalAssets}</td>
      <td class="num">${data.totalAssets.toFixed(2)}</td>
      <td></td>
    </tr>`;
    html += `</tbody></table></div>`;

    // Liabilities section
    html += `<div class="section"><div class="section-title">${t.liabilitiesLabel}</div>`;
    html += `<table><thead><tr>
      <th>${t.accountCode}</th><th>${t.accountName}</th><th class="text-left">${t.currentBalance}</th><th class="text-center">${t.debitLabel}/${t.creditLabel}</th>
    </tr></thead><tbody>`;
    for (const acc of filterAccounts(data.liabilityAccounts)) {
      const indicator = acc.isAbnormal
        ? `<span class="text-red text-sm">${acc.normalSide === 'DEBIT' ? t.creditBalanceIndicator : t.debitBalanceIndicator}</span>`
        : `<span class="text-green text-sm">${acc.normalSide === 'DEBIT' ? t.debitLabel : t.creditLabel}</span>`;
      html += `<tr>
        <td class="font-mono text-sm">${acc.code}</td>
        <td>${acc.name}</td>
        <td class="num">${Math.abs(acc.balance).toFixed(2)}</td>
        <td class="text-center">${indicator}</td>
      </tr>`;
    }
    html += `<tr class="total-row">
      <td colspan="2">${t.totalLiabilitiesLabel}</td>
      <td class="num">${data.totalLiabilities.toFixed(2)}</td>
      <td></td>
    </tr>`;
    html += `</tbody></table></div>`;

    // Equity section
    html += `<div class="section"><div class="section-title">${t.equityLabel}</div>`;
    html += `<table><thead><tr>
      <th>${t.accountCode}</th><th>${t.accountName}</th><th class="text-left">${t.currentBalance}</th><th class="text-center">${t.debitLabel}/${t.creditLabel}</th>
    </tr></thead><tbody>`;
    for (const acc of filterAccounts(data.equityAccounts)) {
      const indicator = acc.isAbnormal
        ? `<span class="text-red text-sm">${acc.normalSide === 'DEBIT' ? t.creditBalanceIndicator : t.debitBalanceIndicator}</span>`
        : `<span class="text-green text-sm">${acc.normalSide === 'DEBIT' ? t.debitLabel : t.creditLabel}</span>`;
      html += `<tr>
        <td class="font-mono text-sm">${acc.code}</td>
        <td>${acc.name}</td>
        <td class="num">${Math.abs(acc.balance).toFixed(2)}</td>
        <td class="text-center">${indicator}</td>
      </tr>`;
    }
    // Net income line
    html += `<tr>
      <td></td>
      <td>${data.netIncome >= 0 ? t.netProfit : t.netLoss}</td>
      <td class="num ${data.netIncome >= 0 ? 'text-green' : 'text-red'}">${Math.abs(data.netIncome).toFixed(2)}</td>
      <td class="text-center"><span class="text-green text-sm">${t.creditLabel}</span></td>
    </tr>`;
    html += `<tr class="total-row">
      <td colspan="2">${t.totalEquityLabel}</td>
      <td class="num">${data.totalEquity.toFixed(2)}</td>
      <td></td>
    </tr>`;
    html += `</tbody></table></div>`;

    // Accounting equation verification
    html += `<div class="summary-total">
      <span>${t.accountingEquation}</span>
      <span>${t.asset}: <span class="num">${data.totalAssets.toFixed(2)}</span> = ${t.liability}: <span class="num">${data.totalLiabilities.toFixed(2)}</span> + ${t.equity}: <span class="num">${data.totalEquity.toFixed(2)}</span></span>
    </div>`;
    html += `<div style="text-align:center;margin-top:8px">
      <span class="badge ${data.accountingEquation.isBalanced ? 'badge-green' : 'badge-red'}">${data.accountingEquation.isBalanced ? t.balancedSymbol : t.unbalancedSymbol}</span>
    </div>`;

    const company = await fetchCompanyInfoForPrint();

    const success = printReportDocument({
      title: t.balanceSheet,
      titleEn: 'Statement of Financial Position',
      reportNumber: generateReportNumber('BS'),
      company,
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
            <X className="size-5" />
            <p className="text-sm font-medium">{error}</p>
          </div>
          <Button onClick={fetchData} variant="outline" className="mt-4" size="sm">
            {t.retry}
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Check if there are any abnormal balances
  const allAccounts = data ? [...data.assetAccounts, ...data.liabilityAccounts, ...data.equityAccounts] : [];
  const hasAbnormalBalances = allAccounts.some(a => a.isAbnormal && a.balance !== 0);

  return (
    <div className="space-y-4 print:p-0">
      {/* Header */}
      <Card className="no-print">
        <CardHeader>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-xl text-emerald-700 dark:text-emerald-400">
                {t.financialPosition}
              </CardTitle>
              <CardDescription>{t.financialPositionDesc}</CardDescription>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <Switch
                  id="hide-zero-fc"
                  checked={hideZeroBalances}
                  onCheckedChange={setHideZeroBalances}
                />
                <Label htmlFor="hide-zero-fc" className="text-sm cursor-pointer">
                  {t.hideZeroBalances}
                </Label>
              </div>

              {/* VAT Declaration Button */}
              <Dialog open={vatDialogOpen} onOpenChange={setVatDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-2 border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-400 dark:hover:bg-amber-950/30">
                    <FileText className="size-4" />
                    {t.vatDeclarationBtn || 'إقرار ضريبي'}
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle className="text-amber-700 dark:text-amber-400">
                      {t.vatDeclarationTitle || 'إقرار ضريبة القيمة المضافة'}
                    </DialogTitle>
                    <DialogDescription>
                      {t.vatDeclarationDesc || 'إنشاء إقرار ضريبي ربع سنوي للفترة المحددة'}
                    </DialogDescription>
                  </DialogHeader>

                  {/* Quarter Selection */}
                  <div className="flex gap-3 items-end py-2">
                    <div className="flex-1">
                      <Label className="text-sm font-medium mb-1.5 block">{t.year || 'السنة'}</Label>
                      <Select value={selectedYear} onValueChange={setSelectedYear}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {yearOptions.map(y => (
                            <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex-1">
                      <Label className="text-sm font-medium mb-1.5 block">{t.quarter || 'الربع'}</Label>
                      <Select value={selectedQuarter} onValueChange={setSelectedQuarter}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="1">Q1 - {t.q1Period || 'يناير - مارس'}</SelectItem>
                          <SelectItem value="2">Q2 - {t.q2Period || 'أبريل - يونيو'}</SelectItem>
                          <SelectItem value="3">Q3 - {t.q3Period || 'يوليو - سبتمبر'}</SelectItem>
                          <SelectItem value="4">Q4 - {t.q4Period || 'أكتوبر - ديسمبر'}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <Button onClick={fetchVatReport} disabled={vatReportLoading} className="gap-2">
                      {vatReportLoading ? <Loader2 className="size-4 animate-spin" /> : null}
                      {t.generate || 'إنشاء'}
                    </Button>
                  </div>

                  {/* Report Content */}
                  {vatReportLoading && (
                    <div className="space-y-4 py-4">
                      <Skeleton className="h-8 w-64" />
                      <Skeleton className="h-4 w-40" />
                      <div className="grid grid-cols-2 gap-4">
                        <Skeleton className="h-20 w-full" />
                        <Skeleton className="h-20 w-full" />
                      </div>
                      <Skeleton className="h-32 w-full" />
                    </div>
                  )}

                  {vatReportError && (
                    <div className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950/30">
                      <X className="size-5 text-red-600" />
                      <p className="text-sm text-red-700 dark:text-red-400">{vatReportError}</p>
                    </div>
                  )}

                  {vatReport && !vatReportLoading && (
                    <div className="space-y-4">
                      {/* Company Info */}
                      <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-4 dark:border-amber-800 dark:bg-amber-950/20">
                        <div className="grid grid-cols-2 gap-2 text-sm">
                          <div><span className="text-muted-foreground">{t.companyName || 'المنشأة'}:</span> <span className="font-semibold">{vatReport.company.name || '—'}</span></div>
                          <div><span className="text-muted-foreground">{t.taxNumber || 'الرقم الضريبي'}:</span> <span className="font-semibold font-mono">{vatReport.company.taxNumber || '—'}</span></div>
                          <div><span className="text-muted-foreground">{t.vatDeclarationPeriod || 'الفترة'}:</span> <span className="font-semibold">{vatReport.quarter.periodLabel}</span></div>
                          {vatReport.company.activity && (
                            <div><span className="text-muted-foreground">{t.activity || 'النشاط'}:</span> <span className="font-semibold">{vatReport.company.activity}</span></div>
                          )}
                        </div>
                      </div>

                      {/* Summary Cards */}
                      <div className="grid grid-cols-2 gap-3">
                        {/* Sales Card */}
                        <Card className="border-emerald-200 dark:border-emerald-800">
                          <CardContent className="p-4">
                            <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 mb-2">
                              {t.vatDeclarationSales || 'المبيعات وضريبة المخرجات'}
                            </p>
                            <div className="space-y-1.5 text-sm">
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">{t.netSalesBase || 'صافي المبيعات'}</span>
                                <span className="font-mono"><CurrencyAmount amount={vatReport.summary.netSalesBase} symbolClassName="w-3 h-3" /></span>
                              </div>
                              <div className="flex justify-between font-bold">
                                <span className="text-emerald-700 dark:text-emerald-400">{t.totalOutputTax || 'ضريبة المخرجات'}</span>
                                <span className="font-mono text-emerald-700 dark:text-emerald-400"><CurrencyAmount amount={vatReport.summary.totalOutputTax} symbolClassName="w-3 h-3" /></span>
                              </div>
                            </div>
                          </CardContent>
                        </Card>

                        {/* Purchases Card */}
                        <Card className="border-red-200 dark:border-red-800">
                          <CardContent className="p-4">
                            <p className="text-xs font-semibold text-red-700 dark:text-red-400 mb-2">
                              {t.vatDeclarationPurchases || 'المشتريات وضريبة المدخلات'}
                            </p>
                            <div className="space-y-1.5 text-sm">
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">{t.netPurchaseBase || 'صافي المشتريات'}</span>
                                <span className="font-mono"><CurrencyAmount amount={vatReport.summary.netPurchaseBase} symbolClassName="w-3 h-3" /></span>
                              </div>
                              <div className="flex justify-between font-bold">
                                <span className="text-red-700 dark:text-red-400">{t.totalInputTax || 'ضريبة المدخلات'}</span>
                                <span className="font-mono text-red-700 dark:text-red-400"><CurrencyAmount amount={vatReport.summary.totalInputTax} symbolClassName="w-3 h-3" /></span>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      </div>

                      {/* Net VAT */}
                      <div className={`rounded-lg border-2 p-4 text-center ${
                        vatReport.summary.netVAT >= 0
                          ? 'border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/30'
                          : 'border-emerald-300 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-950/30'
                      }`}>
                        <p className="text-sm text-muted-foreground mb-1">
                          {vatReport.summary.netVAT >= 0
                            ? (t.vatPayableToAuthority || 'صافي الضريبة المستحقة للهيئة')
                            : (t.vatRefundFromAuthority || 'صافي الضريبة المستردة من الهيئة')
                          }
                        </p>
                        <p className={`text-2xl font-bold font-mono ${
                          vatReport.summary.netVAT >= 0
                            ? 'text-amber-700 dark:text-amber-400'
                            : 'text-emerald-700 dark:text-emerald-400'
                        }`}>
                          <CurrencyAmount amount={Math.abs(vatReport.summary.netVAT)} symbolClassName="w-5 h-5" />
                        </p>
                      </div>

                      {/* Monthly Breakdown */}
                      {vatReport.monthlyBreakdown.length > 0 && (
                        <Card>
                          <CardHeader className="pb-2">
                            <CardTitle className="text-sm">{t.vatMonthlyBreakdown || 'تفصيل شهري'}</CardTitle>
                          </CardHeader>
                          <CardContent>
                            <div className="overflow-x-auto">
                              <table className="w-full text-sm">
                                <thead>
                                  <tr className="border-b">
                                    <th className="text-right py-2 px-2 font-medium text-muted-foreground">{t.month || 'الشهر'}</th>
                                    <th className="text-left py-2 px-2 font-medium text-muted-foreground">{t.netSales || 'صافي المبيعات'}</th>
                                    <th className="text-left py-2 px-2 font-medium text-muted-foreground">{t.outputTax || 'ضريبة مخرجات'}</th>
                                    <th className="text-left py-2 px-2 font-medium text-muted-foreground">{t.purchasesBase || 'المشتريات'}</th>
                                    <th className="text-left py-2 px-2 font-medium text-muted-foreground">{t.inputTax || 'ضريبة مدخلات'}</th>
                                    <th className="text-left py-2 px-2 font-medium text-muted-foreground">{t.netVAT || 'صافي الضريبة'}</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {vatReport.monthlyBreakdown.map((m) => (
                                    <tr key={m.month} className="border-b border-border/50">
                                      <td className="py-1.5 px-2 font-medium">{m.label}</td>
                                      <td className="py-1.5 px-2 font-mono text-left"><CurrencyAmount amount={m.netSales} symbolClassName="w-3 h-3" /></td>
                                      <td className="py-1.5 px-2 font-mono text-left"><CurrencyAmount amount={m.outputTax} symbolClassName="w-3 h-3" /></td>
                                      <td className="py-1.5 px-2 font-mono text-left"><CurrencyAmount amount={m.purchasesBase} symbolClassName="w-3 h-3" /></td>
                                      <td className="py-1.5 px-2 font-mono text-left"><CurrencyAmount amount={m.inputTax} symbolClassName="w-3 h-3" /></td>
                                      <td className={`py-1.5 px-2 font-mono text-left font-bold ${m.netVAT >= 0 ? 'text-amber-700 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                                        <CurrencyAmount amount={Math.abs(m.netVAT)} symbolClassName="w-3 h-3" />
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </CardContent>
                        </Card>
                      )}

                      {/* Current Unsettled Balances */}
                      {Math.abs(vatReport.currentBalances.unsettledNet) > 0.01 && (
                        <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3 dark:border-amber-800 dark:bg-amber-950/20">
                          <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 mb-1">
                            {t.currentUnsettledVAT || 'الأرصدة غير المقفلة حالياً'}
                          </p>
                          <div className="flex gap-4 text-xs">
                            <span><span className="text-muted-foreground">{t.outputTax}:</span> <span className="font-mono"><CurrencyAmount amount={vatReport.currentBalances.outputTax} symbolClassName="w-3 h-3" /></span></span>
                            <span><span className="text-muted-foreground">{t.inputTax}:</span> <span className="font-mono"><CurrencyAmount amount={vatReport.currentBalances.inputTax} symbolClassName="w-3 h-3" /></span></span>
                            <span className="font-bold"><span className="text-amber-700 dark:text-amber-400">{t.netVAT}:</span> <span className="font-mono text-amber-700 dark:text-amber-400"><CurrencyAmount amount={Math.abs(vatReport.currentBalances.unsettledNet)} symbolClassName="w-3 h-3" /></span></span>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  <DialogFooter className="gap-2 flex-wrap">
                    <Button variant="outline" onClick={() => setVatDialogOpen(false)}>
                      {t.close || 'إغلاق'}
                    </Button>
                    {vatReport && (
                      <>
                        <Button variant="outline" onClick={handleExportVatExcel} className="gap-2">
                          <Download className="size-4" />
                          {t.exportExcel || 'تصدير Excel'}
                        </Button>
                        <Button
                          onClick={handleSaveDeclaration}
                          disabled={saveDeclLoading}
                          className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
                        >
                          {saveDeclLoading ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                          {t.saveDeclaration || 'حفظ كإقرار'}
                        </Button>
                        <Button onClick={handlePrintVatDeclaration} className="gap-2 bg-amber-600 hover:bg-amber-700 text-white">
                          <Printer className="size-4" />
                          {t.printDeclaration || 'طباعة الإقرار'}
                        </Button>
                      </>
                    )}
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              {/* Saved Declarations List Button (opens state-machine manager) */}
              <Button
                variant="outline"
                size="sm"
                onClick={openDeclarationsDialog}
                className="gap-2 border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-400 dark:hover:bg-emerald-950/30"
              >
                <History className="size-4" />
                {t.savedDeclarationsBtn || 'الإقرارات المحفوظة'}
              </Button>

              {/* Saved Declarations Dialog (state machine list + actions) */}
              <Dialog open={declarationsDialogOpen} onOpenChange={setDeclarationsDialogOpen}>
                <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle className="text-amber-700 dark:text-amber-400 flex items-center gap-2">
                      <History className="size-5" />
                      {t.savedDeclarations || 'الإقرارات الضريبية المحفوظة'}
                    </DialogTitle>
                    <DialogDescription>
                      {t.savedDeclarationsDesc || 'إدارة الإقرارات الضريبية المحفوظة (مسودة / مقدّم / مقفل)'}
                    </DialogDescription>
                  </DialogHeader>

                  <div className="flex items-center justify-between gap-2 pb-2">
                    <p className="text-sm text-muted-foreground">
                      {declarations.length} {t.declarationCountSuffix || 'إقرار'}
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void fetchDeclarations()}
                      disabled={declarationsLoading}
                      className="gap-2"
                    >
                      {declarationsLoading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                      {t.refresh || 'تحديث'}
                    </Button>
                  </div>

                  {declarationsLoading ? (
                    <div className="space-y-2">
                      {Array.from({ length: 3 }).map((_, i) => (
                        <Skeleton key={i} className="h-20 w-full" />
                      ))}
                    </div>
                  ) : declarations.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-amber-300 dark:border-amber-700 p-8 text-center">
                      <FileText className="size-10 mx-auto mb-2 text-amber-400" />
                      <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
                        {t.noSavedDeclarations || 'لا توجد إقرارات ضريبية محفوظة بعد'}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {t.noSavedDeclarationsHint || 'افتح تقرير ضريبي ربع سنوي ثم اضغط "حفظ كإقرار" لإنشاء إقرار جديد'}
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
                      {declarations.map((decl) => {
                        const isLoadingThis = actionLoadingId === decl.id;
                        return (
                          <div
                            key={decl.id}
                            className="rounded-lg border border-border p-3 hover:bg-accent/30 transition-colors"
                          >
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-mono text-sm font-semibold">{decl.number}</span>
                                  {renderStatusBadge(decl.status)}
                                  <span className="text-xs text-muted-foreground">
                                    {decl.branchName || decl.branchCode || decl.branchId.slice(0, 8)}
                                    {' · '}
                                    {decl.year}/Q{decl.quarter}
                                  </span>
                                </div>
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2 text-xs">
                                  <div>
                                    <span className="text-muted-foreground">{t.netSalesBase || 'صافي المبيعات'}:</span>{' '}
                                    <span className="font-mono"><CurrencyAmount amount={decl.netSalesBase} symbolClassName="w-3 h-3" /></span>
                                  </div>
                                  <div>
                                    <span className="text-muted-foreground">{t.netPurchaseBase || 'صافي المشتريات'}:</span>{' '}
                                    <span className="font-mono"><CurrencyAmount amount={decl.netPurchaseBase} symbolClassName="w-3 h-3" /></span>
                                  </div>
                                  <div>
                                    <span className="text-muted-foreground">{t.totalOutputTax || 'ض. مخرجات'}:</span>{' '}
                                    <span className="font-mono text-emerald-700 dark:text-emerald-400"><CurrencyAmount amount={decl.totalOutputTax} symbolClassName="w-3 h-3" /></span>
                                  </div>
                                  <div>
                                    <span className="text-muted-foreground">{t.totalInputTax || 'ض. مدخلات'}:</span>{' '}
                                    <span className="font-mono text-red-700 dark:text-red-400"><CurrencyAmount amount={decl.totalInputTax} symbolClassName="w-3 h-3" /></span>
                                  </div>
                                </div>
                                <div className="mt-2 text-xs">
                                  <span className={`font-bold font-mono ${decl.netVAT >= 0 ? 'text-amber-700 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400'}`}>
                                    {t.netVAT || 'صافي الضريبة'}:{' '}
                                    <CurrencyAmount amount={Math.abs(decl.netVAT)} symbolClassName="w-3 h-3" />
                                  </span>
                                  <span className="text-muted-foreground ms-3">
                                    {new Date(decl.createdAt).toLocaleDateString('en-GB')}
                                  </span>
                                  {decl.createdByName && (
                                    <span className="text-muted-foreground ms-2">· {decl.createdByName}</span>
                                  )}
                                </div>
                                {decl.reopenReason && (
                                  <div className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                                    <span className="font-medium">{t.reopenReasonLabel || 'سبب إعادة الفتح'}:</span>{' '}
                                    {decl.reopenReason}
                                  </div>
                                )}
                              </div>

                              {/* Action buttons — depend on status + role */}
                              <div className="flex flex-wrap gap-1.5 sm:flex-col sm:items-end">
                                {decl.status === 'DRAFT' && (
                                  <>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="gap-1 h-8 text-xs"
                                      disabled={isLoadingThis}
                                      onClick={() => void handleSubmitDeclaration(decl)}
                                    >
                                      {isLoadingThis ? <Loader2 className="size-3 animate-spin" /> : <Send className="size-3" />}
                                      {t.submitDeclaration || 'تقديم'}
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="gap-1 h-8 text-xs"
                                      disabled={isLoadingThis}
                                      onClick={() => void handleRegenerateDeclaration(decl)}
                                    >
                                      {isLoadingThis ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
                                      {t.regenerateDeclaration || 'إعادة احتساب'}
                                    </Button>
                                    {isAdmin && (
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="gap-1 h-8 text-xs text-red-700 dark:text-red-400 border-red-300 dark:border-red-700 hover:bg-red-50 dark:hover:bg-red-950/30"
                                        disabled={isLoadingThis}
                                        onClick={() => setDeleteTarget(decl)}
                                      >
                                        <Trash2 className="size-3" />
                                        {t.deleteDeclaration || 'حذف'}
                                      </Button>
                                    )}
                                  </>
                                )}
                                {decl.status === 'SUBMITTED' && (
                                  <>
                                    {isAdmin && (
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="gap-1 h-8 text-xs text-emerald-700 dark:text-emerald-400 border-emerald-300 dark:border-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
                                        disabled={isLoadingThis}
                                        onClick={() => void handleLockDeclaration(decl)}
                                      >
                                        {isLoadingThis ? <Loader2 className="size-3 animate-spin" /> : <Lock className="size-3" />}
                                        {t.lockDeclaration || 'إقفال'}
                                      </Button>
                                    )}
                                    {isAdmin && (
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="gap-1 h-8 text-xs"
                                        disabled={isLoadingThis}
                                        onClick={() => openReopenDialog(decl)}
                                      >
                                        <Unlock className="size-3" />
                                        {t.reopenToDraft || 'إعادة فتح لمسودة'}
                                      </Button>
                                    )}
                                  </>
                                )}
                                {decl.status === 'LOCKED' && isAdmin && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="gap-1 h-8 text-xs text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-700 hover:bg-amber-50 dark:hover:bg-amber-950/30"
                                    disabled={isLoadingThis}
                                    onClick={() => openReopenDialog(decl)}
                                  >
                                    {isLoadingThis ? <Loader2 className="size-3 animate-spin" /> : <Unlock className="size-3" />}
                                    {t.reopenDeclaration || 'إعادة فتح'}
                                  </Button>
                                )}
                                {decl.status === 'VOIDED' && (
                                  <span className="text-xs text-muted-foreground italic">
                                    {t.declStatusVoided || 'ملغي'}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <DialogFooter>
                    <Button variant="outline" onClick={() => setDeclarationsDialogOpen(false)}>
                      {t.close || 'إغلاق'}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              {/* Reopen Declaration Dialog — reason required (ADMIN only) */}
              <Dialog
                open={!!reopenTarget}
                onOpenChange={(open) => { if (!open) setReopenTarget(null); }}
              >
                <DialogContent className="max-w-md">
                  <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
                      <Unlock className="size-5" />
                      {t.reopenDeclarationTitle || 'إعادة فتح الإقرار الضريبي'}
                    </DialogTitle>
                    <DialogDescription>
                      {t.reopenDeclarationDesc || 'إعادة فتح إقرار مقفل أو مقدّم. هذه عملية حساسة ويتم تسجيلها في السجل التدقيقي.'}
                    </DialogDescription>
                  </DialogHeader>
                  {reopenTarget && (
                    <div className="space-y-3">
                      <div className="rounded-md border border-border bg-muted/30 p-2 text-xs">
                        <div><span className="text-muted-foreground">{t.declarationNumber || 'رقم الإقرار'}:</span> <span className="font-mono font-semibold">{reopenTarget.number}</span></div>
                        <div><span className="text-muted-foreground">{t.period || 'الفترة'}:</span> {reopenTarget.year}/Q{reopenTarget.quarter}</div>
                        <div><span className="text-muted-foreground">{t.currentStatus || 'الحالة الحالية'}:</span> {renderStatusBadge(reopenTarget.status)}</div>
                      </div>
                      <div>
                        <Label className="text-sm font-medium mb-1.5 block">
                          {t.reopenTargetStatus || 'الحالة المستهدفة'}
                        </Label>
                        <Select
                          value={reopenTargetStatus}
                          onValueChange={(v: 'DRAFT' | 'SUBMITTED') => setReopenTargetStatus(v)}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="DRAFT">{t.declStatusDraft || 'مسودة'}</SelectItem>
                            <SelectItem value="SUBMITTED">{t.declStatusSubmitted || 'مقدّم'}</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label className="text-sm font-medium mb-1.5 block">
                          {t.reopenReasonLabel || 'سبب إعادة الفتح'} <span className="text-red-500">*</span>
                        </Label>
                        <Textarea
                          value={reopenReason}
                          onChange={(e) => setReopenReason(e.target.value)}
                          placeholder={t.reopenReasonPlaceholder || 'أدخل سبب إعادة الفتح (إلزامي)'}
                          rows={3}
                          maxLength={500}
                        />
                        <p className="text-[10px] text-muted-foreground mt-1">
                          {reopenReason.length}/500
                        </p>
                      </div>
                    </div>
                  )}
                  <DialogFooter className="gap-2">
                    <Button variant="outline" onClick={() => setReopenTarget(null)}>
                      {t.cancel || 'إلغاء'}
                    </Button>
                    <Button
                      onClick={() => void handleConfirmReopen()}
                      disabled={!reopenReason.trim() || actionLoadingId === reopenTarget?.id}
                      className="gap-2 bg-amber-600 hover:bg-amber-700 text-white"
                    >
                      {actionLoadingId === reopenTarget?.id ? <Loader2 className="size-4 animate-spin" /> : <Unlock className="size-4" />}
                      {t.confirmReopen || 'تأكيد إعادة الفتح'}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              {/* Delete Declaration Confirmation (ADMIN only) */}
              <AlertDialog
                open={!!deleteTarget}
                onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
              >
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle className="flex items-center gap-2 text-red-700 dark:text-red-400">
                      <AlertTriangle className="size-5" />
                      {t.confirmDeleteDeclarationTitle || 'تأكيد حذف الإقرار'}
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      {deleteTarget && (
                        <>
                          {t.confirmDeleteDeclarationDesc || 'سيتم تغيير حالة الإقرار إلى ملغي (VOIDED). يمكن إنشاء إقرار جديد للفترة لاحقاً.'}
                          <br />
                          <span className="font-mono text-xs">{deleteTarget.number}</span>
                          {' — '}
                          {deleteTarget.year}/Q{deleteTarget.quarter}
                        </>
                      )}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t.cancel || 'إلغاء'}</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={(e) => { e.preventDefault(); void handleConfirmDelete(); }}
                      className="bg-red-600 hover:bg-red-700 text-white"
                    >
                      {t.deleteDeclaration || 'حذف'}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>

              <Button onClick={() => {
                if (!data) return;
                const exportData = [
                  ...data.assetAccounts.map((a) => ({ accountCode: a.code, accountName: a.name, balance: Math.abs(a.balance), nature: a.isAbnormal ? (a.normalSide === 'DEBIT' ? t.creditBalance : t.debitBalance) : (a.normalSide === 'DEBIT' ? t.debitBalance : t.creditBalance), category: t.asset })),
                  ...data.liabilityAccounts.map((a) => ({ accountCode: a.code, accountName: a.name, balance: Math.abs(a.balance), nature: a.isAbnormal ? (a.normalSide === 'DEBIT' ? t.creditBalance : t.debitBalance) : (a.normalSide === 'DEBIT' ? t.debitBalance : t.creditBalance), category: t.liability })),
                  ...data.equityAccounts.map((a) => ({ accountCode: a.code, accountName: a.name, balance: Math.abs(a.balance), nature: a.isAbnormal ? (a.normalSide === 'DEBIT' ? t.creditBalance : t.debitBalance) : (a.normalSide === 'DEBIT' ? t.debitBalance : t.creditBalance), category: t.equity })),
                ];
                exportToExcel({
                  data: exportData,
                  columns: [
                    { key: 'accountCode', header: t.accountCode, width: 12 },
                    { key: 'accountName', header: t.accountName, width: 25 },
                    { key: 'balance', header: t.currentBalance, width: 15 },
                    { key: 'nature', header: t.debitLabel + '/' + t.creditLabel, width: 15 },
                    { key: 'category', header: t.classification, width: 15 },
                  ],
                  sheetName: t.balanceSheet,
                  fileName: `${t.balanceSheet}-${new Date().toISOString().slice(0, 10)}.xlsx`,
                  title: t.balanceSheet,
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
          </div>
        </CardHeader>
      </Card>

      {/* Abnormal Balance Warning */}
      {hasAbnormalBalances && (
        <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
          <AlertTriangle className="size-5 shrink-0 text-amber-600 dark:text-amber-400" />
          <div>
            <p className="font-semibold text-amber-800 dark:text-amber-300">{t.abnormalBalanceNote}</p>
            <p className="text-sm opacity-80">
              {t.abnormalBalanceDesc || 'بعض الحسابات لديها أرصدة عكسية (رصيد دائن في أصول أو رصيد مدين في التزامات) — Some accounts have abnormal balances'}
            </p>
          </div>
        </div>
      )}

      {loading ? (
        <div className="grid gap-4 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-6 space-y-4">
                <Skeleton className="h-6 w-32" />
                <Skeleton className="h-10 w-40" />
                {Array.from({ length: 4 }).map((_, j) => (
                  <div key={j} className="flex justify-between">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-4 w-20" />
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : data ? (
        <>
          {/* Accounting Equation Verification */}
          <div
            className={`flex items-center gap-3 rounded-lg border p-4 ${
              data.accountingEquation.isBalanced
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300'
                : 'border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300'
            }`}
          >
            {data.accountingEquation.isBalanced ? (
              <CheckCircle2 className="size-6 shrink-0" />
            ) : (
              <X className="size-6 shrink-0" />
            )}
            <div className="flex-1">
              <p className="font-semibold text-base">
                {data.accountingEquation.isBalanced
                  ? t.accountingEquationBalanced
                  : t.accountingEquationUnbalanced}
              </p>
              <p className="text-sm opacity-80 mt-1">
                <span className="font-semibold">{t.totalAssets}:</span> <CurrencyAmount amount={data.accountingEquation.assets} symbolClassName="w-3.5 h-3.5" /> ={' '}
                <span className="font-semibold">{t.totalLiabilitiesEquity}:</span>{' '}
                <CurrencyAmount amount={data.accountingEquation.liabilitiesPlusEquity} symbolClassName="w-3.5 h-3.5" />
                {!data.accountingEquation.isBalanced && (
                  <span className="font-bold">
                    {' '} ({t.difference}: <CurrencyAmount amount={Math.abs(data.accountingEquation.assets - data.accountingEquation.liabilitiesPlusEquity)} symbolClassName="w-3.5 h-3.5" />)
                  </span>
                )}
              </p>
            </div>
            <Scale className="size-8 shrink-0 opacity-50" />
          </div>

          {/* Three Section Cards */}
          <div className="grid gap-4 md:grid-cols-3">
            {/* Assets Section */}
            <Card className="border-emerald-200 dark:border-emerald-800">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
                  <TrendingUp className="size-5" />
                  {t.assetsLabel}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {filterAccounts(data.assetAccounts).length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">{t.noAssetAccounts}</p>
                ) : (
                  filterAccounts(data.assetAccounts).map((account) => (
                    <div
                      key={account.code}
                      className="flex items-center justify-between py-1.5 border-b border-border/50 last:border-0"
                    >
                      <div className="flex items-center gap-1.5">
                        <AccountCodeBadge code={account.code} name={account.name} />
                        {account.isAbnormal && account.balance !== 0 && (
                          <Badge variant="outline" className="text-[9px] px-1 py-0 border-red-300 text-red-600 dark:border-red-700 dark:text-red-400">
                            {t.creditBalanceIndicator}
                          </Badge>
                        )}
                      </div>
                      <span className={`text-sm font-mono font-semibold ${account.isAbnormal && account.balance !== 0 ? 'text-red-500' : ''}`}>
                        <CurrencyAmount amount={Math.abs(account.balance)} symbolClassName="w-3.5 h-3.5" />
                      </span>
                    </div>
                  ))
                )}
                <div className="flex items-center justify-between pt-3 border-t-2 border-emerald-300 dark:border-emerald-700">
                  <span className="font-bold text-emerald-700 dark:text-emerald-400">{t.totalAssets}</span>
                  <span className="font-bold font-mono text-emerald-700 dark:text-emerald-400 text-lg">
                    <CurrencyAmount amount={data.totalAssets} symbolClassName="w-3.5 h-3.5" />
                  </span>
                </div>
              </CardContent>
            </Card>

            {/* Liabilities Section */}
            <Card className="border-amber-200 dark:border-amber-800">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg flex items-center gap-2 text-amber-700 dark:text-amber-400">
                  <TrendingDown className="size-5" />
                  {t.liabilitiesLabel}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {filterAccounts(data.liabilityAccounts).length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">{t.noLiabilityAccounts}</p>
                ) : (
                  filterAccounts(data.liabilityAccounts).map((account) => (
                    <div
                      key={account.code}
                      className="flex items-center justify-between py-1.5 border-b border-border/50 last:border-0"
                    >
                      <div className="flex items-center gap-1.5">
                        <AccountCodeBadge code={account.code} name={account.name} />
                        {account.isAbnormal && account.balance !== 0 && (
                          <Badge variant="outline" className="text-[9px] px-1 py-0 border-red-300 text-red-600 dark:border-red-700 dark:text-red-400">
                            {t.debitBalanceIndicator}
                          </Badge>
                        )}
                      </div>
                      <span className={`text-sm font-mono font-semibold ${account.isAbnormal && account.balance !== 0 ? 'text-red-500' : ''}`}>
                        <CurrencyAmount amount={Math.abs(account.balance)} symbolClassName="w-3.5 h-3.5" />
                      </span>
                    </div>
                  ))
                )}

                {/* VAT Breakdown Card */}
                {data.vatBreakdown && (Math.abs(data.vatBreakdown.inputTax) > 0.01 || Math.abs(data.vatBreakdown.outputTax) > 0.01 || Math.abs(data.vatBreakdown.taxPayable) > 0.01) && (
                  <div className="mt-3 p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800 space-y-2">
                    <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 mb-2">
                      {t.vatBreakdownTitle || 'تفصيل الضريبة'}
                    </p>
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">{t.outputTax || 'ضريبة مخرجات'} (2100)</span>
                      <span className="font-mono"><CurrencyAmount amount={Math.abs(data.vatBreakdown.outputTax)} symbolClassName="w-3 h-3" /></span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">{t.inputTax || 'ضريبة مدخلات'} (1200)</span>
                      <span className="font-mono"><CurrencyAmount amount={Math.abs(data.vatBreakdown.inputTax)} symbolClassName="w-3 h-3" /></span>
                    </div>
                    {Math.abs(data.vatBreakdown.unsettledNetTax) > 0.01 && (
                      <div className="flex justify-between text-xs pt-1 border-t border-amber-200 dark:border-amber-700">
                        <span className="text-amber-700 dark:text-amber-400">{t.unsettledVAT || 'صافي غير مقفل'}</span>
                        <span className={`font-mono font-bold ${data.vatBreakdown.unsettledNetTax >= 0 ? 'text-amber-700 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                          <CurrencyAmount amount={Math.abs(data.vatBreakdown.unsettledNetTax)} symbolClassName="w-3 h-3" />
                          {data.vatBreakdown.unsettledNetTax > 0.01 && <span className="text-[10px] ms-1">({t.vatPayable || 'مستحقة'})</span>}
                          {data.vatBreakdown.unsettledNetTax < -0.01 && <span className="text-[10px] ms-1">({t.vatRefundable || 'مستردة'})</span>}
                        </span>
                      </div>
                    )}
                    {Math.abs(data.vatBreakdown.taxPayable) > 0.01 && (
                      <div className="flex justify-between text-xs pt-1 border-t border-amber-200 dark:border-amber-700">
                        <span className="font-semibold text-amber-700 dark:text-amber-400">{t.taxPayableAccount || 'ضريبة مستحقة'} (2600)</span>
                        <span className={`font-mono font-bold ${data.vatBreakdown.taxPayable > 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                          <CurrencyAmount amount={Math.abs(data.vatBreakdown.taxPayable)} symbolClassName="w-3 h-3" />
                          {data.vatBreakdown.taxPayable > 0.01 && <span className="text-[10px] ms-1">({t.vatOwed || 'مطلوب سداد'})</span>}
                          {data.vatBreakdown.taxPayable < -0.01 && <span className="text-[10px] ms-1">({t.vatRefundDue || 'مستردة'})</span>}
                        </span>
                      </div>
                    )}
                  </div>
                )}

                <div className="flex items-center justify-between pt-3 border-t-2 border-amber-300 dark:border-amber-700">
                  <span className="font-bold text-amber-700 dark:text-amber-400">{t.totalLiabilitiesLabel}</span>
                  <span className="font-bold font-mono text-amber-700 dark:text-amber-400 text-lg">
                    <CurrencyAmount amount={data.totalLiabilities} symbolClassName="w-3.5 h-3.5" />
                  </span>
                </div>
              </CardContent>
            </Card>

            {/* Equity Section */}
            <Card className="border-teal-200 dark:border-teal-800">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg flex items-center gap-2 text-teal-700 dark:text-teal-400">
                  <Scale className="size-5" />
                  {t.equityLabel}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {filterAccounts(data.equityAccounts).map((account) => (
                  <div
                    key={account.code}
                    className="flex items-center justify-between py-1.5 border-b border-border/50 last:border-0"
                  >
                    <div className="flex items-center gap-1.5">
                      <AccountCodeBadge code={account.code} name={account.name} />
                      {account.isAbnormal && account.balance !== 0 && (
                        <Badge variant="outline" className="text-[9px] px-1 py-0 border-red-300 text-red-600 dark:border-red-700 dark:text-red-400">
                          {t.debitBalanceIndicator}
                        </Badge>
                      )}
                    </div>
                    <span className={`text-sm font-mono font-semibold ${account.isAbnormal && account.balance !== 0 ? 'text-red-500' : ''}`}>
                      <CurrencyAmount amount={Math.abs(account.balance)} symbolClassName="w-3.5 h-3.5" />
                    </span>
                  </div>
                ))}
                {/* Net Income Line */}
                <div className="flex items-center justify-between py-1.5 border-b border-border/50">
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={data.netIncome >= 0 ? 'default' : 'destructive'}
                      className="text-[10px] px-1.5"
                    >
                      {data.netIncome >= 0 ? t.profit : t.loss}
                    </Badge>
                    <span className="text-sm font-medium">{data.netIncome >= 0 ? t.netProfit : t.netLoss}</span>
                  </div>
                  <span
                    className={`text-sm font-mono font-semibold ${
                      data.netIncome >= 0 ? 'text-emerald-600' : 'text-red-500'
                    }`}
                  >
                    <CurrencyAmount amount={Math.abs(data.netIncome)} symbolClassName="w-3.5 h-3.5" />
                  </span>
                </div>
                <div className="flex items-center justify-between pt-3 border-t-2 border-teal-300 dark:border-teal-700">
                  <span className="font-bold text-teal-700 dark:text-teal-400">
                    {t.totalEquityLabel}
                  </span>
                  <span className="font-bold font-mono text-teal-700 dark:text-teal-400 text-lg">
                    <CurrencyAmount amount={data.totalEquity} symbolClassName="w-3.5 h-3.5" />
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Summary Equation Card */}
          <Card className="border-emerald-200 dark:border-emerald-800 bg-emerald-50/30 dark:bg-emerald-950/10">
            <CardContent className="p-6">
              <div className="flex flex-col items-center gap-4 text-center">
                <h3 className="text-lg font-bold text-emerald-700 dark:text-emerald-400">
                  {t.accountingEquation}
                </h3>
                <div className="flex flex-col sm:flex-row items-center gap-3 text-lg font-mono">
                  <div className="px-4 py-2 rounded-lg bg-emerald-100 dark:bg-emerald-900/40 font-bold">
                    <CurrencyAmount amount={data.totalAssets} symbolClassName="w-3.5 h-3.5" />
                  </div>
                  <span className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">=</span>
                  <div className="px-4 py-2 rounded-lg bg-amber-100 dark:bg-amber-900/40 font-bold">
                    <CurrencyAmount amount={data.totalLiabilities} symbolClassName="w-3.5 h-3.5" />
                  </div>
                  <span className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">+</span>
                  <div className="px-4 py-2 rounded-lg bg-teal-100 dark:bg-teal-900/40 font-bold">
                    <CurrencyAmount amount={data.totalEquity} symbolClassName="w-3.5 h-3.5" />
                  </div>
                </div>
                <div className="flex flex-col sm:flex-row items-center gap-3 text-sm text-muted-foreground">
                  <span>{t.assetsLabel}</span>
                  <span>=</span>
                  <span>{t.liabilitiesLabel}</span>
                  <span>+</span>
                  <span>{t.equityLabel}</span>
                </div>
                <div className="flex items-center gap-2 mt-2">
                  {data.accountingEquation.isBalanced ? (
                    <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700">
                      <CheckCircle2 className="size-3.5 ml-1" />
                      {t.balancedSymbol}
                    </Badge>
                  ) : (
                    <Badge variant="destructive">
                      <X className="size-3.5 ml-1" />
                      {t.unbalancedSymbol}
                    </Badge>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      ) : (
        <Card>
          <CardContent className="p-12 text-center text-muted-foreground">
            <p className="text-lg font-medium">{t.noData}</p>
            <p className="text-sm mt-1">{t.ensureAccountsBalances}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
