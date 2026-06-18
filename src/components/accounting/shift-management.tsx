'use client';

import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import {
  Clock,
  Wallet,
  ChevronRight,
  ChevronLeft,
  Loader2,
  CircleDot,
  CircleCheck,
  AlertTriangle,
  FileBarChart,
  History,
  Banknote,
  CreditCard,
  Receipt,
  ReceiptText,
  Calculator,
  X,
  Printer,
  FileDown,
} from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
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
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { ScrollArea } from '@/components/ui/scroll-area';
import { formatNumber } from '@/lib/types';
import { round2 } from '@/lib/decimal';
import { CurrencyAmount, CurrencySymbol } from '@/components/ui/currency-symbol';
import { useAppStore } from '@/lib/store';
import { useTranslation } from '@/lib/i18n';
import { printReportDocument, fetchCompanyInfoForPrint, fetchBranchInfoForPrint, generateReportNumber } from '@/lib/report-print';

// ─── Types ────────────────────────────────────────────────────────

interface ShiftData {
  id: string;
  shiftNumber: string;
  branch: string;
  status: 'OPEN' | 'CLOSED';
  openingCash: number;
  closingCash: number | null;
  expectedCash: number | null;
  cashDifference: number | null;
  totalSales: number | null;
  totalReturns: number | null;
  totalDiscounts: number | null;
  totalCashSales: number | null;
  totalCardSales: number | null;
  totalOtherSales: number | null;
  invoiceCount: number | null;
  returnCount: number | null;
  notes: string | null;
  openedAt: string;
  closedAt: string | null;
  userId: string;
  user?: { name: string; email: string };
}

interface ShiftHistoryItem {
  id: string;
  shiftNumber: string;
  branch: string;
  status: string;
  openingCash: number;
  closingCash: number | null;
  expectedCash: number | null;
  cashDifference: number | null;
  totalSales: number | null;
  openedAt: string;
  closedAt: string | null;
  user?: { name: string; email: string };
}

interface CashierReportData {
  mode?: 'shift' | 'dateRange';
  shift?: {
    id: string;
    number: string;
    userId?: string;
    userName: string | null;
    branch: string;
    status: string;
    openedAt: string;
    closedAt: string | null;
    openingCash: number;
    closingCash: number | null;
    expectedCash: number | null;
    cashDifference: number | null;
  } | null;
  summary: {
    totalSales: number;
    totalReturns: number;
    totalDiscounts: number;
    totalTax: number;
    netSales: number;
    totalCashSales: number;
    totalCardSales: number;
    totalOtherSales: number;
    invoiceCount: number;
    returnCount: number;
  };
  paymentBreakdown: Record<string, { amount: number; count: number }>;
  topProducts: { name: string; quantity: number; total: number }[];
  invoices: {
    id: string;
    invoiceNumber: string;
    totalAmount: number;
    paymentMethod: string | null;
    isReturn: boolean;
    createdAt: string;
    customerName: string | null;
    subtotal: number;
    discountAmount: number;
    taxAmount: number;
  }[];
}

// ─── Helper ───────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}m`;
}

function getBranchNameLocalized(key: string, t: any): string {
  if (key === 'CHINA_TOWN') return t.branchChinaTown || 'China Town';
  if (key === 'PALACE_INDIA') return t.branchPalaceIndia || 'Palace India';
  return key;
}

function getPaymentMethodLabel(method: string | null, t: any): string {
  if (!method) return '—';
  const labels: Record<string, string> = {
    CASH: t.cash || 'نقدي',
    MADA: 'مدى',
    VISA: 'فيزا',
    MASTERCARD: 'ماستركارد',
    OTHER_CARD: t.otherCard || 'بطاقة أخرى',
    SPLIT: t.splitPayment || 'دفع مقسم',
  };
  return labels[method] || method;
}

// ─── Component Props ──────────────────────────────────────────────

interface ShiftManagementProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-select this branch when opening a shift */
  defaultBranch?: string;
  /** Called when shift is opened or closed */
  onShiftChange?: () => void;
  /** Branches list from parent */
  branches?: { key: string; name: string; enabled: boolean }[];
}

// ─── Component ────────────────────────────────────────────────────

export default function ShiftManagement({ open, onOpenChange, defaultBranch, onShiftChange, branches: parentBranches }: ShiftManagementProps) {
  const { t, isRTL } = useTranslation();
  const { authToken } = useAppStore();

  // State
  const [activeShift, setActiveShift] = useState<ShiftData | null>(null);
  const [shiftHistory, setShiftHistory] = useState<ShiftHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [openingShift, setOpeningShift] = useState(false);
  const [closingShift, setClosingShift] = useState(false);

  // Open shift form
  const [openBranch, setOpenBranch] = useState(defaultBranch || '');
  const [openingCashInput, setOpeningCashInput] = useState('');
  const [openNotes, setOpenNotes] = useState('');

  // Close shift dialog
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);
  const [closingCashInput, setClosingCashInput] = useState('');
  const [closeNotes, setCloseNotes] = useState('');

  // Close confirm dialog
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);

  // Cashier report dialog
  const [reportDialogOpen, setReportDialogOpen] = useState(false);
  const [reportData, setReportData] = useState<CashierReportData | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportShiftId, setReportShiftId] = useState<string>('');

  // Duration ticker for active shift
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!activeShift) return;
    const interval = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(interval);
  }, [activeShift]);

  // ─── Fetch Active Shift ──────────────────────────────────────

  const fetchActiveShift = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/pos/shifts/active', {
        headers: { 'Authorization': `Bearer ${authToken}` },
      });
      if (!res.ok) throw new Error(t.failedToFetchShifts);
      const data = await res.json();
      if (data.active && data.shift) {
        setActiveShift(data.shift);
      } else {
        setActiveShift(null);
      }
    } catch {
      toast.error(t.failedToFetchShifts);
      setActiveShift(null);
    } finally {
      setLoading(false);
    }
  }, [authToken, t]);

  // ─── Fetch Shift History ─────────────────────────────────────

  const fetchShiftHistory = useCallback(async () => {
    try {
      const res = await fetch('/api/pos/shifts?limit=10', {
        headers: { 'Authorization': `Bearer ${authToken}` },
      });
      if (!res.ok) throw new Error(t.failedToFetchShifts);
      const data = await res.json();
      setShiftHistory(Array.isArray(data) ? data : (data.shifts || []));
    } catch {
      // Silently fail
    }
  }, [authToken, t]);

  // ─── Effects ─────────────────────────────────────────────────

  useEffect(() => {
    if (open) {
      fetchActiveShift();
      fetchShiftHistory();
    }
  }, [open, fetchActiveShift, fetchShiftHistory]);

  // Set default branch when dialog opens
  useEffect(() => {
    if (open && defaultBranch && !openBranch) {
      setOpenBranch(defaultBranch);
    }
  }, [open, defaultBranch, openBranch]);

  // ─── Open Shift ──────────────────────────────────────────────

  const handleOpenShift = async () => {
    if (!openBranch) {
      toast.error(t.selectBranch);
      return;
    }
    const openingCash = parseFloat(openingCashInput);
    if (isNaN(openingCash) || openingCash < 0) {
      toast.error(t.enterOpeningCash);
      return;
    }

    try {
      setOpeningShift(true);
      const res = await fetch('/api/pos/shifts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          branch: openBranch,
          openingCash,
          notes: openNotes || null,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || t.failedToOpenShift);
      }
      const shift = await res.json();
      setActiveShift(shift);
      toast.success(t.shiftOpened);
      setOpeningCashInput('');
      setOpenNotes('');
      onShiftChange?.();
    } catch (error: any) {
      toast.error(error.message || t.failedToOpenShift);
    } finally {
      setOpeningShift(false);
    }
  };

  // ─── Close Shift ─────────────────────────────────────────────

  const handleOpenCloseDialog = () => {
    if (!activeShift) return;
    setClosingCashInput('');
    setCloseNotes('');
    setCloseDialogOpen(true);
  };

  const handleCloseShift = async () => {
    if (!activeShift) return;
    const closingCash = parseFloat(closingCashInput);
    if (isNaN(closingCash) || closingCash < 0) {
      toast.error(t.enterClosingCash);
      return;
    }

    try {
      setClosingShift(true);
      const res = await fetch(`/api/pos/shifts/${activeShift.id}/close`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          closingCash,
          notes: closeNotes || null,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || t.failedToCloseShift);
      }
      const closedShift = await res.json();
      setActiveShift(null);
      setCloseDialogOpen(false);
      setCloseConfirmOpen(false);
      toast.success(t.shiftClosed);
      onShiftChange?.();
      fetchShiftHistory();
    } catch (error: any) {
      toast.error(error.message || t.failedToCloseShift);
    } finally {
      setClosingShift(false);
    }
  };

  // ─── Cashier Report ──────────────────────────────────────────

  const handleOpenReport = async (shiftId?: string) => {
    const targetShiftId = shiftId || activeShift?.id || reportShiftId;
    if (!targetShiftId) return;

    try {
      setReportLoading(true);
      setReportDialogOpen(true);
      const params = new URLSearchParams({ shiftId: targetShiftId });
      const res = await fetch(`/api/pos/shifts/report?${params}`, {
        headers: { 'Authorization': `Bearer ${authToken}` },
      });
      if (!res.ok) throw new Error(t.failedToFetchData);
      const data = await res.json();
      setReportData(data);
    } catch {
      toast.error(t.failedToFetchData);
      setReportData(null);
    } finally {
      setReportLoading(false);
    }
  };

  // ─── Print Report (unified printReportDocument approach) ───

  const handlePrintReport = useCallback(async () => {
    if (!reportData) return;

    const branchKey = reportData.shift?.branch || '';
    const branchName = branchKey ? getBranchNameLocalized(branchKey, t) : '—';
    const cashierName = reportData.shift?.userName || '—';
    const shiftNumber = reportData.shift?.number || '—';
    const status = reportData.shift?.status === 'OPEN' ? (t.open || 'مفتوحة') : (t.closed || 'مغلقة');
    const openedAt = reportData.shift?.openedAt ? new Date(reportData.shift.openedAt).toLocaleString('ar-SA-u-nu-latn') : '—';
    const closedAt = reportData.shift?.closedAt ? new Date(reportData.shift.closedAt).toLocaleString('ar-SA-u-nu-latn') : '—';

    // Financial data
    const s = reportData.summary;
    const openingCash = reportData.shift?.openingCash || 0;
    const expectedCash = round2(openingCash + s.totalCashSales - s.totalReturns);
    const closingCash = reportData.shift?.closingCash ?? null;
    const cashDiff = closingCash !== null ? round2(closingCash - expectedCash) : null;

    // ── Build the report body HTML ────────────────────────────────
    // The letterhead (logo + company name + branch + VAT) and the info bar
    // (report number | period | generated-by | generated-at) are injected
    // by printReportDocument — we only provide the report body below.

    let body = '';

    // Cashier / shift meta-grid
    body += `<div class="section">
      <div class="summary-grid">
        <div class="summary-card"><label>${t.cashierName || 'الكاشير'}</label><div class="value">${cashierName}</div></div>
        <div class="summary-card"><label>${t.shiftNumber}</label><div class="value" style="font-family:'Courier New',monospace">${shiftNumber}</div></div>
        <div class="summary-card"><label>${t.branch}</label><div class="value" style="font-size:11pt">${branchName}</div></div>
        <div class="summary-card"><label>${t.shiftOpenedAt}</label><div class="value" style="font-size:10pt;direction:ltr">${openedAt}</div></div>
        ${reportData.shift?.closedAt ? `<div class="summary-card"><label>${t.shiftClosedAt || 'وقت الإغلاق'}</label><div class="value" style="font-size:10pt;direction:ltr">${closedAt}</div></div>` : ''}
        <div class="summary-card"><label>${t.openingCash}</label><div class="value">${formatNumber(openingCash)}</div></div>
        <div class="summary-card"><label>${t.status || 'الحالة'}</label><div class="value ${status === (t.open || 'مفتوحة') ? 'amber' : 'green'}">${status}</div></div>
      </div>
    </div>`;

    // Financial summary cards (3×3 grid)
    body += `<div class="section">
      <div class="section-title">${t.financialSummary || 'الملخص المالي'}</div>
      <div class="summary-grid">
        <div class="summary-card"><label>${t.shiftTotalSales}</label><div class="value green">${formatNumber(s.totalSales)}</div></div>
        <div class="summary-card"><label>${t.totalCashSales}</label><div class="value green">${formatNumber(s.totalCashSales)}</div></div>
        <div class="summary-card"><label>${t.totalCardSales}</label><div class="value blue">${formatNumber(s.totalCardSales)}</div></div>
        <div class="summary-card"><label>${t.totalOtherSales}</label><div class="value amber">${formatNumber(s.totalOtherSales)}</div></div>
        <div class="summary-card"><label>${t.shiftTotalReturns}</label><div class="value red">${formatNumber(s.totalReturns)}</div></div>
        <div class="summary-card"><label>${t.shiftTotalDiscounts}</label><div class="value amber">${formatNumber(s.totalDiscounts)}</div></div>
        <div class="summary-card"><label>${t.totalTax}</label><div class="value">${formatNumber(s.totalTax)}</div></div>
        <div class="summary-card"><label>${t.netSales}</label><div class="value green" style="font-size:16pt">${formatNumber(s.netSales)}</div></div>
        <div class="summary-card"><label>${t.invoice}</label><div class="value">${s.invoiceCount}</div></div>
      </div>
    </div>`;

    // Expected cash block
    body += `<div class="section">
      <div class="section-title">${t.expectedCash || 'الصندوق المتوقع'}</div>
      <div class="card">
        <div class="summary-row"><span>${t.openingCash}</span><span class="num">${formatNumber(openingCash)}</span></div>
        <div class="summary-row"><span>${t.totalCashSales} (+)</span><span class="num text-green">${formatNumber(s.totalCashSales)}</span></div>
        <div class="summary-row"><span>${t.shiftTotalReturns} (-)</span><span class="num text-red">${formatNumber(s.totalReturns)}</span></div>
        <div class="summary-total"><span>${t.expectedCash}</span><span class="num">${formatNumber(expectedCash)}</span></div>
        ${closingCash !== null ? `
          <div class="summary-row"><span>${t.closingCash || 'الصندوق الفعلي'}</span><span class="num">${formatNumber(closingCash)}</span></div>
          <div class="summary-total"><span>${t.difference || 'الفرق'}</span><span class="num ${cashDiff !== null && Math.abs(cashDiff) < 0.01 ? 'text-green' : 'text-red'}">${cashDiff !== null ? formatNumber(cashDiff) : '—'}</span></div>
        ` : ''}
      </div>
    </div>`;

    // Payment-method breakdown
    if (Object.keys(reportData.paymentBreakdown || {}).length > 0) {
      body += `<div class="section">
        <div class="section-title">${t.paymentMethods || 'طرق الدفع'}</div>
        <table>
          <thead><tr><th>${t.paymentMethod || 'طريقة الدفع'}</th><th class="text-center">#</th><th class="text-left">${t.amount || 'المبلغ'}</th></tr></thead>
          <tbody>
            ${Object.entries(reportData.paymentBreakdown).map(([method, data]: [string, any]) => `
              <tr><td>${getPaymentMethodLabel(method, t)}</td><td class="num">${data.count}</td><td class="num">${formatNumber(data.amount)}</td></tr>
            `).join('')}
          </tbody>
        </table>
      </div>`;
    }

    // Top products
    if ((reportData.topProducts || []).length > 0) {
      body += `<div class="section">
        <div class="section-title">${t.topItems || 'الأصناف الأكثر مبيعاً'}</div>
        <table>
          <thead><tr><th class="text-center">#</th><th>${t.products || 'الصنف'}</th><th class="text-center">${t.quantity || 'الكمية'}</th><th class="text-left">${t.total || 'الإجمالي'}</th></tr></thead>
          <tbody>
            ${reportData.topProducts.map((p, i) => `<tr><td class="num">${i + 1}</td><td>${p.name}</td><td class="num">${p.quantity}</td><td class="num">${formatNumber(p.total)}</td></tr>`).join('')}
          </tbody>
        </table>
      </div>`;
    }

    // Invoices list
    if ((reportData.invoices || []).length > 0) {
      body += `<div class="section">
        <div class="section-title">${t.invoices || 'الفواتير'} (${reportData.invoices.length})</div>
        <table>
          <thead><tr><th class="text-center">#</th><th>${t.invoiceNumber || 'رقم الفاتورة'}</th><th>${t.paymentMethod || 'طريقة الدفع'}</th><th class="text-left">${t.total || 'الإجمالي'}</th></tr></thead>
          <tbody>
            ${reportData.invoices.map((inv, i) => `<tr><td class="num">${i + 1}</td><td class="font-mono text-sm">${inv.invoiceNumber}</td><td>${getPaymentMethodLabel(inv.paymentMethod, t)}</td><td class="num ${inv.isReturn ? 'text-red' : ''}">${formatNumber(inv.totalAmount)}</td></tr>`).join('')}
          </tbody>
        </table>
      </div>`;
    }

    // Signature area (cashier / supervisor)
    body += `<div style="margin-top:24px;border-top:2px solid #1f2937;padding-top:14px">
      <div class="grid grid-cols-2 gap-4">
        <div style="text-align:center">
          <div style="border-bottom:1px solid #1f2937;margin-bottom:8px;padding-bottom:24px"></div>
          <div><strong>${t.cashierName || 'الكاشير'}</strong></div>
        </div>
        <div style="text-align:center">
          <div style="border-bottom:1px solid #1f2937;margin-bottom:8px;padding-bottom:24px"></div>
          <div><strong>${t.approvedBy || 'اعتماد المسؤول'}</strong></div>
        </div>
      </div>
    </div>`;

    // ── Fetch company + branch info in parallel, then print ─────────
    const [company, branch] = await Promise.all([
      fetchCompanyInfoForPrint(),
      fetchBranchInfoForPrint(branchKey || null),
    ]);

    const success = printReportDocument({
      title: t.cashierReport || 'تقرير الكاشير',
      titleEn: 'Cashier Daily Report',
      subtitle: `${branchName} — ${shiftNumber} — ${status}`,
      reportNumber: generateReportNumber('CSH'),
      company,
      branch,
      period: {
        from: openedAt !== '—' ? openedAt : '—',
        to: closedAt !== '—' ? closedAt : (openedAt !== '—' ? openedAt : '—'),
      },
      generatedBy: cashierName,
      contentHtml: body,
      format: 'A4',
    });

    if (!success) {
      toast.error(t.allowPopups || 'السماح بالنوافذ المنبثقة');
    }
  }, [reportData, t]);

  // ─── Computed: Close shift calculations ──────────────────────

  const closingCash = parseFloat(closingCashInput) || 0;
  const expectedCash = activeShift
    ? round2(activeShift.openingCash + (activeShift.totalCashSales || 0) - (activeShift.totalReturns || 0))
    : 0;
  const cashDiff = round2(closingCash - expectedCash);

  // ─── Branches ────────────────────────────────────────────────

  const branchList = parentBranches && parentBranches.length > 0
    ? parentBranches.filter(b => b.enabled)
    : [
        { key: 'CHINA_TOWN', name: 'China Town', enabled: true },
        { key: 'PALACE_INDIA', name: 'Palace India', enabled: true },
      ];

  // ─── Filter branches by user's allowedBranches ───
  const { canAccessBranch } = useAppStore.getState();
  const filteredBranchList = branchList.filter((b) => canAccessBranch(b.key));

  // ─── Render ──────────────────────────────────────────────────

  return (
    <>
      {/* Main Dialog */}
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent dir={isRTL ? 'rtl' : 'ltr'} className="sm:max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wallet className="size-5 text-emerald-600" />
              {t.shiftManagement}
            </DialogTitle>
            <DialogDescription className="sr-only">إدارة الورديات</DialogDescription>
          </DialogHeader>

          <ScrollArea className="flex-1 -mx-6 px-6">
            <div className="space-y-4 pb-4">

              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="size-8 animate-spin text-emerald-600" />
                  <span className="ml-3 text-muted-foreground">{t.loading}</span>
                </div>
              ) : activeShift ? (
                /* ─── Active Shift Dashboard ─── */
                <>
                  {/* Shift Info Card */}
                  <Card className="border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20">
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <CircleDot className="size-4 text-emerald-600 animate-pulse" />
                          <Badge className="bg-emerald-600 text-white">{t.open}</Badge>
                          <span className="text-sm font-bold font-mono">{activeShift.shiftNumber}</span>
                        </div>
                        <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => handleOpenReport()}>
                          <FileBarChart className="size-3.5" />
                          {t.cashierReport}
                        </Button>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                        <div>
                          <p className="text-xs text-muted-foreground">{t.branch}</p>
                          <p className="font-medium">{getBranchNameLocalized(activeShift.branch, t)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">{t.shiftOpenedAt}</p>
                          <p className="font-medium" dir="ltr">{new Date(activeShift.openedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">{t.shiftDuration}</p>
                          <p className="font-medium" dir="ltr">{formatDuration(now - new Date(activeShift.openedAt).getTime())}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">{t.openingCash}</p>
                          <p className="font-bold text-emerald-600 dark:text-emerald-400">
                            <CurrencyAmount amount={activeShift.openingCash} symbolClassName="w-3.5 h-3.5" />
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Sales Summary Cards */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <Card>
                      <CardContent className="p-3 text-center">
                        <Receipt className="size-5 mx-auto mb-1 text-primary" />
                        <p className="text-xs text-muted-foreground">{t.shiftTotalSales}</p>
                        <p className="text-lg font-bold text-primary">
                          <CurrencyAmount amount={activeShift.totalSales || 0} symbolClassName="w-3 h-3" bold />
                        </p>
                        <p className="text-xs text-muted-foreground">{activeShift.invoiceCount || 0} {t.invoice}</p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="p-3 text-center">
                        <Banknote className="size-5 mx-auto mb-1 text-emerald-600" />
                        <p className="text-xs text-muted-foreground">{t.totalCashSales}</p>
                        <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
                          <CurrencyAmount amount={activeShift.totalCashSales || 0} symbolClassName="w-3 h-3" bold />
                        </p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="p-3 text-center">
                        <CreditCard className="size-5 mx-auto mb-1 text-blue-600" />
                        <p className="text-xs text-muted-foreground">{t.totalCardSales}</p>
                        <p className="text-lg font-bold text-blue-600 dark:text-blue-400">
                          <CurrencyAmount amount={activeShift.totalCardSales || 0} symbolClassName="w-3 h-3" bold />
                        </p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="p-3 text-center">
                        <Wallet className="size-5 mx-auto mb-1 text-amber-600" />
                        <p className="text-xs text-muted-foreground">{t.totalOtherSales}</p>
                        <p className="text-lg font-bold text-amber-600 dark:text-amber-400">
                          <CurrencyAmount amount={activeShift.totalOtherSales || 0} symbolClassName="w-3 h-3" bold />
                        </p>
                      </CardContent>
                    </Card>
                  </div>

                  {/* Quick Actions */}
                  <div className="flex gap-2">
                    <Button
                      variant="destructive"
                      className="flex-1 gap-2"
                      onClick={handleOpenCloseDialog}
                    >
                      <Calculator className="size-4" />
                      {t.closeShift}
                    </Button>
                  </div>

                  {/* Returns & Discounts Info */}
                  {(activeShift.totalReturns && activeShift.totalReturns > 0) || (activeShift.totalDiscounts && activeShift.totalDiscounts > 0) ? (
                    <Card className="border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20">
                      <CardContent className="p-3">
                        <div className="flex flex-wrap gap-4 text-sm">
                          {activeShift.totalReturns && activeShift.totalReturns > 0 && (
                            <div>
                              <span className="text-xs text-muted-foreground">{t.shiftTotalReturns}</span>
                              <p className="font-bold text-red-600">
                                <CurrencyAmount amount={activeShift.totalReturns} symbolClassName="w-3 h-3" />
                              </p>
                            </div>
                          )}
                          {activeShift.totalDiscounts && activeShift.totalDiscounts > 0 && (
                            <div>
                              <span className="text-xs text-muted-foreground">{t.shiftTotalDiscounts}</span>
                              <p className="font-bold text-amber-600">
                                <CurrencyAmount amount={activeShift.totalDiscounts} symbolClassName="w-3 h-3" />
                              </p>
                            </div>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  ) : null}
                </>
              ) : (
                /* ─── No Active Shift: Open Shift Form ─── */
                <Card className="border-emerald-200 dark:border-emerald-800">
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <CircleDot className="size-5 text-emerald-600" />
                      {t.openShift}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <Label>{t.branch}</Label>
                      <Select value={openBranch} onValueChange={setOpenBranch}>
                        <SelectTrigger>
                          <SelectValue placeholder={t.selectBranch} />
                        </SelectTrigger>
                        <SelectContent>
                          {filteredBranchList.map((b) => (
                            <SelectItem key={b.key} value={b.key}>
                              {b.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>{t.openingCash}</Label>
                      <div className="relative">
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder={t.enterOpeningCash}
                          value={openingCashInput}
                          onChange={(e) => setOpeningCashInput(e.target.value)}
                          className="pr-16"
                          dir="ltr"
                        />
                        <div className="absolute left-3 top-1/2 -translate-y-1/2">
                          <CurrencySymbol className="w-4 h-4" />
                        </div>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label className="text-muted-foreground">{t.notes} ({t.optional})</Label>
                      <Textarea
                        placeholder="..."
                        value={openNotes}
                        onChange={(e) => setOpenNotes(e.target.value)}
                        rows={2}
                      />
                    </div>

                    <Button
                      className="w-full gap-2 bg-emerald-600 hover:bg-emerald-700"
                      onClick={handleOpenShift}
                      disabled={openingShift || !openBranch}
                    >
                      {openingShift ? <Loader2 className="size-4 animate-spin" /> : <CircleDot className="size-4" />}
                      {openingShift ? t.loading : t.openShift}
                    </Button>
                  </CardContent>
                </Card>
              )}

              {/* ─── Shift History ─── */}
              <Separator />
              <div>
                <h3 className="text-sm font-bold flex items-center gap-2 mb-3">
                  <History className="size-4 text-muted-foreground" />
                  {t.shiftHistory}
                </h3>
                {shiftHistory.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-4">{t.noData}</p>
                ) : (
                  <div className="border rounded-lg overflow-hidden">
                    <div className="overflow-x-auto max-h-64">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-muted/50 border-b">
                            <th className="text-start p-2 font-medium">{t.shiftNumber}</th>
                            <th className="text-start p-2 font-medium">{t.branch}</th>
                            <th className="text-start p-2 font-medium">{t.openingCash}</th>
                            <th className="text-start p-2 font-medium">{t.shiftTotalSales}</th>
                            <th className="text-start p-2 font-medium">{t.cashDifference}</th>
                            <th className="text-start p-2 font-medium">{t.status}</th>
                            <th className="text-start p-2 font-medium"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {shiftHistory.map((shift) => {
                            const diff = shift.cashDifference;
                            const diffColor = diff === null || diff === 0
                              ? 'text-emerald-600'
                              : diff > 0
                                ? 'text-amber-600'
                                : 'text-red-600';
                            return (
                              <tr key={shift.id} className="border-b last:border-b-0 hover:bg-muted/30">
                                <td className="p-2 font-mono">{shift.shiftNumber}</td>
                                <td className="p-2">{getBranchNameLocalized(shift.branch, t)}</td>
                                <td className="p-2" dir="ltr">{formatNumber(shift.openingCash)}</td>
                                <td className="p-2 font-bold" dir="ltr">{formatNumber(shift.totalSales || 0)}</td>
                                <td className={`p-2 font-bold ${diffColor}`} dir="ltr">
                                  {diff !== null ? (diff >= 0 ? '+' : '') + formatNumber(diff) : '-'}
                                </td>
                                <td className="p-2">
                                  <Badge variant={shift.status === 'OPEN' ? 'default' : 'secondary'} className="text-[10px]">
                                    {shift.status === 'OPEN' ? t.open : t.closed}
                                  </Badge>
                                </td>
                                <td className="p-2">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 text-[10px] gap-1"
                                    onClick={() => {
                                      setReportShiftId(shift.id);
                                      handleOpenReport(shift.id);
                                    }}
                                  >
                                    <FileBarChart className="size-3" />
                                  </Button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* Close Shift Dialog */}
      <Dialog open={closeDialogOpen} onOpenChange={setCloseDialogOpen}>
        <DialogContent dir={isRTL ? 'rtl' : 'ltr'} className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Calculator className="size-5 text-red-500" />
              {t.closeShift}
            </DialogTitle>
            <DialogDescription className="sr-only">إقفال الوردية</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            {/* Shift Summary */}
            <Card className="border-muted">
              <CardContent className="p-3 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{t.shiftNumber}</span>
                  <span className="font-mono font-bold">{activeShift?.shiftNumber}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{t.shiftTotalSales}</span>
                  <span className="font-bold text-primary">
                    <CurrencyAmount amount={activeShift?.totalSales || 0} symbolClassName="w-3 h-3" />
                  </span>
                </div>
                <Separator />
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{t.totalCashSales}</span>
                  <span className="font-medium">
                    <CurrencyAmount amount={activeShift?.totalCashSales || 0} symbolClassName="w-3 h-3" />
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{t.totalCardSales}</span>
                  <span className="font-medium">
                    <CurrencyAmount amount={activeShift?.totalCardSales || 0} symbolClassName="w-3 h-3" />
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{t.shiftTotalReturns}</span>
                  <span className="font-medium text-red-600">
                    <CurrencyAmount amount={activeShift?.totalReturns || 0} symbolClassName="w-3 h-3" />
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{t.shiftTotalDiscounts}</span>
                  <span className="font-medium text-amber-600">
                    <CurrencyAmount amount={activeShift?.totalDiscounts || 0} symbolClassName="w-3 h-3" />
                  </span>
                </div>
              </CardContent>
            </Card>

            {/* Closing Cash Input */}
            <div className="space-y-2">
              <Label className="font-bold">{t.closingCash}</Label>
              <div className="relative">
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder={t.enterClosingCash}
                  value={closingCashInput}
                  onChange={(e) => setClosingCashInput(e.target.value)}
                  className="pr-16 text-lg font-bold"
                  dir="ltr"
                  autoFocus
                />
                <div className="absolute left-3 top-1/2 -translate-y-1/2">
                  <CurrencySymbol className="w-4 h-4" />
                </div>
              </div>
            </div>

            {/* Expected Cash */}
            <Card className={cashDiff === 0 ? 'border-emerald-300 dark:border-emerald-700' : Math.abs(cashDiff) > 0.01 ? 'border-red-300 dark:border-red-700' : 'border-muted'}>
              <CardContent className="p-3 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{t.openingCash}</span>
                  <span dir="ltr">{formatNumber(activeShift?.openingCash || 0)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{t.totalCashSales}</span>
                  <span className="text-emerald-600" dir="ltr">+ {formatNumber(activeShift?.totalCashSales || 0)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{t.shiftTotalReturns}</span>
                  <span className="text-red-600" dir="ltr">- {formatNumber(activeShift?.totalReturns || 0)}</span>
                </div>
                <Separator />
                <div className="flex justify-between text-sm font-bold">
                  <span>{t.expectedCash}</span>
                  <span dir="ltr">{formatNumber(expectedCash)}</span>
                </div>
                {closingCashInput && (
                  <>
                    <Separator />
                    <div className="flex justify-between font-bold">
                      <span className="flex items-center gap-1">
                        {t.cashDifference}
                        {Math.abs(cashDiff) <= 0.01 && closingCash > 0 ? (
                          <CircleCheck className="size-4 text-emerald-600" />
                        ) : cashDiff > 0 ? (
                          <AlertTriangle className="size-4 text-amber-600" />
                        ) : (
                          <AlertTriangle className="size-4 text-red-600" />
                        )}
                      </span>
                      <span className={cashDiff === 0 || Math.abs(cashDiff) <= 0.01 ? 'text-emerald-600' : cashDiff > 0 ? 'text-amber-600' : 'text-red-600'} dir="ltr">
                        {cashDiff >= 0 ? '+' : ''}{formatNumber(cashDiff)}
                        {' '}
                        <span className="text-xs font-normal">
                          {Math.abs(cashDiff) <= 0.01 && closingCash > 0
                            ? ''
                            : cashDiff > 0
                              ? `(${t.cashOver})`
                              : cashDiff < 0
                                ? `(${t.cashShort})`
                                : ''}
                        </span>
                      </span>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {/* Notes */}
            <div className="space-y-2">
              <Label className="text-muted-foreground">{t.notes}</Label>
              <Textarea
                placeholder="..."
                value={closeNotes}
                onChange={(e) => setCloseNotes(e.target.value)}
                rows={2}
              />
            </div>

            {/* Action Buttons */}
            <div className="flex gap-2">
              <Button
                variant="destructive"
                className="flex-1 gap-2"
                onClick={() => setCloseConfirmOpen(true)}
                disabled={closingShift || !closingCashInput}
              >
                {closingShift ? <Loader2 className="size-4 animate-spin" /> : <Calculator className="size-4" />}
                {t.confirmCloseShift}
              </Button>
              <Button variant="outline" onClick={() => setCloseDialogOpen(false)} disabled={closingShift}>
                {t.cancel}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Close Shift Confirm Dialog */}
      <AlertDialog open={closeConfirmOpen} onOpenChange={setCloseConfirmOpen}>
        <AlertDialogContent dir={isRTL ? 'rtl' : 'ltr'}>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="size-5 text-red-500" />
              {t.confirmCloseShift}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t.closeShiftConfirmMsg}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={closingShift}>{t.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleCloseShift}
              disabled={closingShift}
              className="bg-red-600 hover:bg-red-700"
            >
              {closingShift ? <Loader2 className="size-4 animate-spin ml-2" /> : null}
              {t.closeShift}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Cashier Report Dialog - Professional POS Report */}
      <Dialog open={reportDialogOpen} onOpenChange={setReportDialogOpen}>
        <DialogContent dir={isRTL ? 'rtl' : 'ltr'} className="sm:max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <div className="flex items-center justify-between w-full">
              <DialogTitle className="flex items-center gap-2">
                <FileBarChart className="size-5 text-primary" />
                {t.cashierReport}
              </DialogTitle>
              <div className="flex items-center gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 text-xs h-8"
                  onClick={handlePrintReport}
                  disabled={reportLoading || !reportData}
                >
                  <Printer className="size-3.5" />
                  {t.print || 'طباعة'}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 text-xs h-8"
                  onClick={handlePrintReport}
                  disabled={reportLoading || !reportData}
                >
                  <FileDown className="size-3.5" />
                  PDF
                </Button>
              </div>
            </div>
            <DialogDescription className="sr-only">تقرير الكاشير</DialogDescription>
          </DialogHeader>

          <ScrollArea className="flex-1 -mx-6 px-6">
            {reportLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="size-8 animate-spin text-primary" />
                <span className="ml-3 text-muted-foreground">{t.loading}</span>
              </div>
            ) : reportData ? (
              <div className="space-y-4 pb-4">

                {/* ── Report Header ── */}
                <Card className="border-primary/20 bg-primary/5 dark:bg-primary/10">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <Receipt className="size-5 text-primary" />
                        <span className="font-bold text-base">{t.cashierReport}</span>
                      </div>
                      <Badge variant={reportData.shift?.status === 'OPEN' ? 'default' : 'secondary'} className="text-xs">
                        {reportData.shift?.status === 'OPEN' ? t.open : t.closed}
                      </Badge>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-sm">
                      <div>
                        <p className="text-xs text-muted-foreground">{t.cashierName || 'الكاشير'}</p>
                        <p className="font-semibold">{reportData.shift?.userName || '—'}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">{t.shiftNumber}</p>
                        <p className="font-semibold font-mono">{reportData.shift?.number || '—'}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">{t.branch}</p>
                        <p className="font-semibold">{reportData.shift?.branch ? getBranchNameLocalized(reportData.shift.branch, t) : '—'}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">{t.shiftOpenedAt}</p>
                        <p className="font-semibold" dir="ltr">
                          {reportData.shift?.openedAt
                            ? new Date(reportData.shift.openedAt).toLocaleString('ar-SA-u-nu-latn', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })
                            : '—'}
                        </p>
                      </div>
                      {reportData.shift?.openingCash !== undefined && reportData.shift?.openingCash !== null && reportData.shift.openingCash > 0 && (
                        <div>
                          <p className="text-xs text-muted-foreground">{t.openingCash}</p>
                          <p className="font-semibold text-emerald-600">
                            <CurrencyAmount amount={reportData.shift.openingCash} symbolClassName="w-3 h-3" />
                          </p>
                        </div>
                      )}
                    </div>
                    {reportData.shift?.closedAt && (
                      <div className="mt-2 pt-2 border-t">
                        <div className="grid grid-cols-2 gap-3 text-sm">
                          <div>
                            <p className="text-xs text-muted-foreground">{t.shiftClosedAt || 'وقت الإغلاق'}</p>
                            <p className="font-semibold" dir="ltr">{new Date(reportData.shift.closedAt).toLocaleString('ar-SA-u-nu-latn', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}</p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground">{t.shiftDuration}</p>
                            <p className="font-semibold" dir="ltr">
                              {formatDuration(new Date(reportData.shift.closedAt).getTime() - new Date(reportData.shift.openedAt).getTime())}
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* ── Financial Summary ── */}
                <div className="grid grid-cols-3 sm:grid-cols-7 gap-2">
                  <Card className="border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20">
                    <CardContent className="p-3 text-center">
                      <Receipt className="size-4 mx-auto mb-1 text-emerald-600" />
                      <p className="text-[10px] text-muted-foreground">{t.shiftTotalSales}</p>
                      <p className="text-base font-bold text-emerald-600">
                        <CurrencyAmount amount={reportData.summary.totalSales} bold symbolClassName="w-3 h-3" />
                      </p>
                      <p className="text-[10px] text-muted-foreground">{reportData.summary.invoiceCount} {t.invoice}</p>
                    </CardContent>
                  </Card>
                  <Card className="border-green-200 dark:border-green-800">
                    <CardContent className="p-3 text-center">
                      <Banknote className="size-4 mx-auto mb-1 text-green-600" />
                      <p className="text-[10px] text-muted-foreground">{t.totalCashSales}</p>
                      <p className="text-base font-bold text-green-600 dark:text-green-400">
                        <CurrencyAmount amount={reportData.summary.totalCashSales} bold symbolClassName="w-3 h-3" />
                      </p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-3 text-center">
                      <CreditCard className="size-4 mx-auto mb-1 text-blue-600" />
                      <p className="text-[10px] text-muted-foreground">{t.totalCardSales}</p>
                      <p className="text-base font-bold text-blue-600 dark:text-blue-400">
                        <CurrencyAmount amount={reportData.summary.totalCardSales} bold symbolClassName="w-3 h-3" />
                      </p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-3 text-center">
                      <Wallet className="size-4 mx-auto mb-1 text-amber-600" />
                      <p className="text-[10px] text-muted-foreground">{t.totalOtherSales}</p>
                      <p className="text-base font-bold text-amber-600 dark:text-amber-400">
                        <CurrencyAmount amount={reportData.summary.totalOtherSales} bold symbolClassName="w-3 h-3" />
                      </p>
                    </CardContent>
                  </Card>
                  <Card className="border-red-200 dark:border-red-800">
                    <CardContent className="p-3 text-center">
                      <AlertTriangle className="size-4 mx-auto mb-1 text-red-600" />
                      <p className="text-[10px] text-muted-foreground">{t.shiftTotalReturns}</p>
                      <p className="text-base font-bold text-red-600">
                        <CurrencyAmount amount={reportData.summary.totalReturns} bold symbolClassName="w-3 h-3" />
                      </p>
                      <p className="text-[10px] text-muted-foreground">{reportData.summary.returnCount} {t.returnLabel || 'مرتجع'}</p>
                    </CardContent>
                  </Card>
                  <Card className="border-violet-200 dark:border-violet-800">
                    <CardContent className="p-3 text-center">
                      <Calculator className="size-4 mx-auto mb-1 text-violet-600" />
                      <p className="text-[10px] text-muted-foreground">{t.totalTax || 'الضريبة'}</p>
                      <p className="text-base font-bold text-violet-600 dark:text-violet-400">
                        <CurrencyAmount amount={reportData.summary.totalTax} bold symbolClassName="w-3 h-3" />
                      </p>
                    </CardContent>
                  </Card>
                  <Card className="border-primary/30 bg-primary/5 dark:bg-primary/10">
                    <CardContent className="p-3 text-center">
                      <ReceiptText className="size-4 mx-auto mb-1 text-primary" />
                      <p className="text-[10px] text-muted-foreground">{t.netSales || 'صافي المبيعات'}</p>
                      <p className="text-base font-bold text-primary">
                        <CurrencyAmount amount={reportData.summary.netSales} bold symbolClassName="w-3 h-3" />
                      </p>
                    </CardContent>
                  </Card>
                </div>

                {/* ── Invoices List ── */}
                {reportData.invoices && reportData.invoices.length > 0 && (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <ReceiptText className="size-4 text-primary" />
                        {t.invoices || 'الفواتير'} ({reportData.summary.invoiceCount + reportData.summary.returnCount})
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-0">
                      <div className="overflow-x-auto max-h-64">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="bg-muted/50 border-b">
                              <th className="text-start p-2 font-medium">#</th>
                              <th className="text-start p-2 font-medium">{t.invoiceNumber || 'رقم الفاتورة'}</th>
                              <th className="text-start p-2 font-medium">{t.customer || 'العميل'}</th>
                              <th className="text-start p-2 font-medium">{t.time || 'الوقت'}</th>
                              <th className="text-start p-2 font-medium">{t.paymentMethod || 'طريقة الدفع'}</th>
                              <th className="text-end p-2 font-medium">{t.total || 'الإجمالي'}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {reportData.invoices.map((inv, idx) => (
                              <tr key={inv.id} className={`border-b last:border-b-0 hover:bg-muted/30 ${inv.isReturn ? 'text-red-600' : ''}`}>
                                <td className="p-2 text-muted-foreground">{idx + 1}</td>
                                <td className="p-2 font-mono">
                                  {inv.isReturn && <span className="text-red-500">⟲ </span>}
                                  {inv.invoiceNumber}
                                </td>
                                <td className="p-2">{inv.customerName || 'نقدي'}</td>
                                <td className="p-2" dir="ltr">{new Date(inv.createdAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</td>
                                <td className="p-2">
                                  <Badge variant="outline" className="text-[10px]">
                                    {getPaymentMethodLabel(inv.paymentMethod, t)}
                                  </Badge>
                                </td>
                                <td className="p-2 text-end font-bold" dir="ltr">
                                  {inv.isReturn ? '-' : ''}{formatNumber(inv.totalAmount)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* ── Detailed Financial Breakdown ── */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Calculator className="size-4 text-muted-foreground" />
                      {t.financialSummary || 'الملخص المالي'}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-4 pt-0">
                    <div className="space-y-1.5">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">{t.shiftTotalSales}</span>
                        <span className="font-bold text-emerald-600" dir="ltr">
                          <CurrencyAmount amount={reportData.summary.totalSales} symbolClassName="w-3 h-3" />
                        </span>
                      </div>
                      {reportData.summary.totalDiscounts > 0 && (
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">{t.shiftTotalDiscounts}</span>
                          <span className="font-bold text-amber-600" dir="ltr">
                            - <CurrencyAmount amount={reportData.summary.totalDiscounts} symbolClassName="w-3 h-3" />
                          </span>
                        </div>
                      )}
                      {reportData.summary.totalTax > 0 && (
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">{t.totalTax}</span>
                          <span className="font-bold" dir="ltr">
                            <CurrencyAmount amount={reportData.summary.totalTax} symbolClassName="w-3 h-3" />
                          </span>
                        </div>
                      )}
                      {reportData.summary.totalReturns > 0 && (
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">{t.shiftTotalReturns}</span>
                          <span className="font-bold text-red-600" dir="ltr">
                            - <CurrencyAmount amount={reportData.summary.totalReturns} symbolClassName="w-3 h-3" />
                          </span>
                        </div>
                      )}
                      <Separator />
                      <div className="flex justify-between text-sm font-bold">
                        <span>{t.netSales}</span>
                        <span className="text-primary" dir="ltr">
                          <CurrencyAmount amount={reportData.summary.netSales} symbolClassName="w-3 h-3" bold />
                        </span>
                      </div>
                      {reportData.shift?.openingCash !== undefined && reportData.shift?.openingCash !== null && (
                        <>
                          <Separator />
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">{t.openingCash}</span>
                            <span dir="ltr"><CurrencyAmount amount={reportData.shift.openingCash} symbolClassName="w-3 h-3" /></span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">{t.totalCashSales}</span>
                            <span className="text-emerald-600" dir="ltr">+ <CurrencyAmount amount={reportData.summary.totalCashSales} symbolClassName="w-3 h-3" /></span>
                          </div>
                          {reportData.summary.totalReturns > 0 && (
                            <div className="flex justify-between text-sm">
                              <span className="text-muted-foreground">{t.shiftTotalReturns}</span>
                              <span className="text-red-600" dir="ltr">- <CurrencyAmount amount={reportData.summary.totalReturns} symbolClassName="w-3 h-3" /></span>
                            </div>
                          )}
                          <div className="flex justify-between text-sm font-bold">
                            <span>{t.expectedCash}</span>
                            <span dir="ltr">
                              <CurrencyAmount amount={round2(reportData.shift.openingCash + reportData.summary.totalCashSales - reportData.summary.totalReturns)} symbolClassName="w-3 h-3" bold />
                            </span>
                          </div>
                        </>
                      )}
                    </div>
                  </CardContent>
                </Card>

                {/* ── Payment Method Breakdown ── */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">{t.paymentMethods}</CardTitle>
                  </CardHeader>
                  <CardContent className="p-4 pt-0">
                    <div className="space-y-2">
                      {Object.entries(reportData.paymentBreakdown || {}).map(([method, data]: [string, any]) => (
                        <div key={method} className="flex items-center justify-between text-sm">
                          <div className="flex items-center gap-2">
                            {method === 'CASH' ? <Banknote className="size-3.5 text-green-600" /> :
                             method === 'MADA' ? <CreditCard className="size-3.5 text-blue-600" /> :
                             method === 'VISA' ? <CreditCard className="size-3.5 text-blue-700" /> :
                             method === 'MASTERCARD' ? <CreditCard className="size-3.5 text-orange-600" /> :
                             <Wallet className="size-3.5 text-amber-600" />}
                            <span className="font-medium">{getPaymentMethodLabel(method, t)}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant="secondary" className="text-xs">{data.count}</Badge>
                            <span className="font-bold" dir="ltr">
                              <CurrencyAmount amount={data.amount} symbolClassName="w-3 h-3" />
                            </span>
                          </div>
                        </div>
                      ))}
                      {Object.keys(reportData.paymentBreakdown || {}).length === 0 && (
                        <p className="text-xs text-muted-foreground">{t.noData}</p>
                      )}
                    </div>
                  </CardContent>
                </Card>

                {/* ── Top Products ── */}
                {(reportData.topProducts || []).length > 0 && (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">{t.topItems}</CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-0">
                      <div className="space-y-1 max-h-40 overflow-y-auto">
                        {(reportData.topProducts || []).map((product, idx) => (
                          <div key={product.name} className="flex items-center justify-between text-sm">
                            <div className="flex items-center gap-2 flex-1 min-w-0">
                              <span className="text-xs text-muted-foreground font-mono w-4 shrink-0">{idx + 1}</span>
                              <span className="truncate">{product.name}</span>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <Badge variant="secondary" className="text-xs">{product.quantity}×</Badge>
                              <span className="font-bold text-xs" dir="ltr">
                                <CurrencyAmount amount={product.total} symbolClassName="w-2.5 h-2.5" />
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}


              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <p className="text-sm">{t.noData}</p>
              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  );
}
