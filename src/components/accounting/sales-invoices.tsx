'use client';

import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { useTranslation } from '@/lib/i18n';
import {
  Printer,
  FileSpreadsheet,
  Search,
  Filter,
  ChevronDown,
  ChevronUp,
  Receipt,
  RotateCcw,
  Calendar,
  X,
  FileBarChart,
  Loader2,
  Eye,
  Trash2,
  AlertTriangle,
} from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
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
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';

import {
  formatNumber,
  formatCurrencyWithSymbol,
  TAX_RATE,
} from '@/lib/types';
import { CurrencyAmount, CurrencySymbol, formatReceiptCurrency } from '@/components/ui/currency-symbol';
import { useAppStore, useScreenAccess } from '@/lib/store';
import { exportToExcel } from '@/lib/export-utils';

// ─── Local Types ─────────────────────────────────────────────────

interface POSInvoiceItem {
  id: string;
  name: string;
  nameEn?: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}

interface POSInvoicePayment {
  id: string;
  method: string;
  amount: number;
}

interface POSInvoice {
  id: string;
  invoiceNumber: string;
  branch: string;
  // UUID — the API returns this; `branch` is kept as a backward-compat alias
  branchId?: string;
  status: 'DRAFT' | 'FINALIZED' | 'CANCELLED' | 'RETURNED';
  customerId: string | null;
  customerName: string | null;
  isReturn?: boolean;
  originalInvoiceId?: string | null;
  receiptHtml?: string | null;
  subtotal: number;
  discountAmount: number;
  discountPercentage: number;
  taxAmount: number;
  totalAmount: number;
  paidAmount: number;
  paymentMethod: string | null;
  items: POSInvoiceItem[];
  payments?: POSInvoicePayment[];
  table?: { id: string; name: string } | null;
  createdAt: string;
}

interface Customer {
  id: string;
  name: string;
  nameEn?: string;
  type: string;
  discountPercentage: number;
}

interface BranchInfo {
  key: string;
  name: string;
  enabled: boolean;
}

interface CompanyInfo {
  companyName: string;
  companyNameEn: string;
  taxNumber: string;
  address: string;
  addressEn: string;
  phone: string;
}

// ─── i18n Helper Functions ──────────────────────────────────────

function getBranchDisplayName(t: any, branchKey: string): string {
  const branchMap: Record<string, string> = {
    CHINA_TOWN: t.branchChinaTown,
    PALACE_INDIA: t.branchPalaceIndia,
  };
  return branchMap[branchKey] || branchKey;
}

function getPaymentMethodLabel(t: any, method: string): string {
  const map: Record<string, string> = {
    CASH: t.cash,
    MADA: t.mada,
    VISA: t.visa,
    MASTERCARD: t.mastercard,
    OTHER_CARD: t.otherCard,
    CREDIT: t.credit,
    SADAD: t.sadad || 'Sadad',
    TRANSFER: t.bankTransfer || 'Transfer',
  };
  return map[method] || method;
}

// ─── Component ───────────────────────────────────────────────────

export default function SalesInvoices() {
  const { t, isRTL, locale } = useTranslation();
  const currencySymbolUrl = useAppStore((s) => s.currencySymbolUrl);
  const { canEdit } = useScreenAccess('sales-invoices');

  // Tab state
  const [activeTab, setActiveTab] = useState<string>('sales');

  // Data
  const [invoices, setInvoices] = useState<POSInvoice[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [filterCustomer, setFilterCustomer] = useState<string>('all');
  const [filterBranch, setFilterBranch] = useState<string>('all');
  const [filterDateFrom, setFilterDateFrom] = useState<string>('');
  const [filterDateTo, setFilterDateTo] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [showFilters, setShowFilters] = useState(false);

  // Expanded rows
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  // Receipt preview dialog
  const [receiptPreviewOpen, setReceiptPreviewOpen] = useState(false);
  const [receiptPreviewHtml, setReceiptPreviewHtml] = useState<string>('');
  const [receiptPreviewLoading, setReceiptPreviewLoading] = useState(false);

  // Company info for receipt printing
  const [companyInfo, setCompanyInfo] = useState<CompanyInfo>({
    companyName: '',
    companyNameEn: '',
    taxNumber: '',
    address: '',
    addressEn: '',
    phone: '',
  });
  const [logoDataUrl, setLogoDataUrl] = useState<string>('');
  const [printSettings, setPrintSettings] = useState({
    receiptWidth: 80,
    fontSize: 11,
    logoWidth: 40,
    logoHeight: 20,
  });

  // Delete invoice dialog (with supervisor password)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteTargetInvoice, setDeleteTargetInvoice] = useState<POSInvoice | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [supervisorPassword, setSupervisorPassword] = useState('');
  const [supervisorPasswordError, setSupervisorPasswordError] = useState('');

  // ─── Fetch Invoices ──────────────────────────────────────────

  const fetchInvoices = useCallback(async () => {
    try {
      setLoading(true);
      // Fetch both finalized and returned invoices
      const [finalizedRes, returnedRes] = await Promise.all([
        fetch('/api/pos/invoices?status=FINALIZED'),
        fetch('/api/pos/invoices?status=RETURNED'),
      ]);

      const finalizedData = finalizedRes.ok ? await finalizedRes.json() : [];
      const returnedData = returnedRes.ok ? await returnedRes.json() : [];

      const finalizedInvoices: POSInvoice[] = Array.isArray(finalizedData) ? finalizedData : (finalizedData.invoices || []);
      const returnedInvoices: POSInvoice[] = Array.isArray(returnedData) ? returnedData : (returnedData.invoices || []);

      setInvoices([...finalizedInvoices, ...returnedInvoices]);
    } catch {
      toast.error(t.failedToFetchData);
      setInvoices([]);
    } finally {
      setLoading(false);
    }
  }, [t]);

  // ─── Fetch Customers ────────────────────────────────────────

  const fetchCustomers = useCallback(async () => {
    try {
      const res = await fetch('/api/customers');
      if (res.ok) {
        const data = await res.json();
        // API returns { customers: [...], total, limit, offset }
        const customersList = Array.isArray(data) ? data : (data.customers || []);
        setCustomers(customersList);
      }
    } catch {
      // Silently fail
    }
  }, []);

  // ─── Fetch Branches & Settings ──────────────────────────────

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/settings');
      if (res.ok) {
        const data: Record<string, string> = await res.json();

        // Parse branches
        let branchList: BranchInfo[] = [];
        if (data.branches) {
          try {
            const saved = JSON.parse(data.branches);
            if (Array.isArray(saved) && saved.length > 0) {
              branchList = saved.filter((b: BranchInfo) => b.enabled);
            }
          } catch {
            // fall through
          }
        }
        if (branchList.length === 0) {
          branchList = [
            { key: 'CHINA_TOWN', name: 'China Town', enabled: true },
            { key: 'PALACE_INDIA', name: 'Palace India', enabled: true },
          ];
        }
        setBranches(branchList);

        // Company info
        setCompanyInfo({
          companyName: data.companyName || '',
          companyNameEn: data.companyNameEn || '',
          taxNumber: data.taxNumber || '',
          address: data.address || '',
          addressEn: data.addressEn || '',
          phone: data.phone || '',
        });

        // Print settings
        setPrintSettings({
          receiptWidth: parseFloat(data.receiptWidth) || 80,
          fontSize: parseFloat(data.receiptFontSize) || 11,
          logoWidth: parseFloat(data.logoWidth) || 40,
          logoHeight: parseFloat(data.logoHeight) || 20,
        });
      }
    } catch {
      setBranches([
        { key: 'CHINA_TOWN', name: 'China Town', enabled: true },
        { key: 'PALACE_INDIA', name: 'Palace India', enabled: true },
      ]);
    }
  }, []);

  // ─── Effects ────────────────────────────────────────────────

  useEffect(() => {
    fetchInvoices();
    fetchCustomers();
    fetchSettings();
  }, [fetchInvoices, fetchCustomers, fetchSettings]);

  // ─── Filtered Invoices ──────────────────────────────────────

  const filteredInvoices = invoices.filter((inv) => {
    // Tab filter: sales vs returns
    if (activeTab === 'sales' && inv.isReturn) return false;
    if (activeTab === 'returns' && !inv.isReturn) return false;

    // Customer filter
    if (filterCustomer !== 'all' && inv.customerId !== filterCustomer) return false;

    // Branch filter
    if (filterBranch !== 'all' && inv.branch !== filterBranch) return false;

    // Date range filter
    if (filterDateFrom) {
      const invDate = new Date(inv.createdAt);
      const fromDate = new Date(filterDateFrom);
      fromDate.setHours(0, 0, 0, 0);
      if (invDate < fromDate) return false;
    }
    if (filterDateTo) {
      const invDate = new Date(inv.createdAt);
      const toDate = new Date(filterDateTo);
      toDate.setHours(23, 59, 59, 999);
      if (invDate > toDate) return false;
    }

    // Search query - prioritize invoice number
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const qTrimmed = q.trim();
      const matchesNumber = inv.invoiceNumber?.toLowerCase().includes(qTrimmed);
      const matchesCustomer = inv.customerName?.toLowerCase().includes(q);
      const matchesBranch = getBranchDisplayName(t, inv.branch).includes(q);
      const matchesItems = inv.items?.some(
        (item) => item.name.toLowerCase().includes(q) || (item.nameEn && item.nameEn.toLowerCase().includes(q))
      );
      if (!matchesNumber && !matchesCustomer && !matchesBranch && !matchesItems) return false;
    }

    return true;
  });

  // Sort: invoice number matches first when searching
  if (searchQuery) {
    const q = searchQuery.toLowerCase().trim();
    filteredInvoices.sort((a, b) => {
      const aMatch = a.invoiceNumber?.toLowerCase().includes(q) ? 0 : 1;
      const bMatch = b.invoiceNumber?.toLowerCase().includes(q) ? 0 : 1;
      return aMatch - bMatch;
    });
  }

  // ─── Summary Stats ──────────────────────────────────────────

  const salesInvoices = filteredInvoices.filter((inv) => !inv.isReturn);
  const returnInvoices = filteredInvoices.filter((inv) => inv.isReturn);

  const totalSales = salesInvoices.reduce((sum, inv) => sum + inv.totalAmount, 0);
  const totalReturns = returnInvoices.reduce((sum, inv) => sum + inv.totalAmount, 0);
  const totalTax = filteredInvoices.reduce((sum, inv) => sum + inv.taxAmount, 0);
  const totalDiscount = filteredInvoices.reduce((sum, inv) => sum + inv.discountAmount, 0);

  // ─── Toggle Row Expansion ───────────────────────────────────

  const toggleRowExpand = (invoiceId: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(invoiceId)) {
        next.delete(invoiceId);
      } else {
        next.add(invoiceId);
      }
      return next;
    });
  };

  // ─── Clear Filters ──────────────────────────────────────────

  const clearFilters = () => {
    setFilterCustomer('all');
    setFilterBranch('all');
    setFilterDateFrom('');
    setFilterDateTo('');
    setSearchQuery('');
  };

  const hasActiveFilters = filterCustomer !== 'all' || filterBranch !== 'all' || filterDateFrom || filterDateTo || searchQuery;

  // ─── Delete Invoice (with Supervisor Password) ────────────────────

  const handleDeleteInvoice = (invoice: POSInvoice) => {
    setDeleteTargetInvoice(invoice);
    setSupervisorPassword('');
    setSupervisorPasswordError('');
    setDeleteConfirmOpen(true);
  };

  const confirmDeleteInvoice = async () => {
    if (!deleteTargetInvoice) return;

    // Verify supervisor password first
    if (!supervisorPassword.trim()) {
      setSupervisorPasswordError('كلمة المرور مطلوبة / Password required');
      return;
    }

    try {
      // Verify supervisor password
      const verifyRes = await fetch('/api/settings/verify-supervisor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: supervisorPassword }),
      });
      const verifyData = await verifyRes.json();
      if (!verifyData.valid) {
        setSupervisorPasswordError('كلمة المرور غير صحيحة / Incorrect password');
        return;
      }

      setDeleting(true);
      // Use DELETE to permanently remove invoice and all related accounting entries
      const res = await fetch(`/api/pos/invoices/${deleteTargetInvoice.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to delete invoice');
      }
      toast.success('تم حذف الفاتورة وجميع القيود المرتبطة / Invoice and all related entries deleted');
      setDeleteConfirmOpen(false);
      setDeleteTargetInvoice(null);
      setSupervisorPassword('');
      setSupervisorPasswordError('');
      // Refresh
      fetchInvoices();
    } catch (error: any) {
      toast.error(error.message || 'فشل حذف الفاتورة');
    } finally {
      setDeleting(false);
    }
  };

  // ─── View Receipt (Exact Replica) ────────────────────────────────

  const handleViewReceipt = async (invoice: POSInvoice) => {
    try {
      setReceiptPreviewLoading(true);
      setReceiptPreviewOpen(true);

      // Fetch full invoice with receiptHtml
      const res = await fetch(`/api/pos/invoices/${invoice.id}`);
      if (!res.ok) throw new Error(t.failedToFetchInvoice);
      const fullInvoice = await res.json();

      if (fullInvoice.receiptHtml) {
        // Use saved receipt HTML (exact replica)
        setReceiptPreviewHtml(fullInvoice.receiptHtml);
      } else {
        // Fallback: generate receipt from data (for old invoices)
        const generatedHtml = await generateFallbackReceipt(fullInvoice);
        setReceiptPreviewHtml(generatedHtml);
      }
    } catch (error: any) {
      toast.error(error.message || t.failedToFetchInvoice);
      setReceiptPreviewOpen(false);
    } finally {
      setReceiptPreviewLoading(false);
    }
  };

  // ─── Generate Fallback Receipt (for old invoices without saved HTML) ──

  const generateFallbackReceipt = async (invoice: POSInvoice): Promise<string> => {
    // Fetch logo for the branch
    let logoUrl = '';
    try {
      const logoRes = await fetch(`/api/settings/logo?branchId=${invoice.branchId || invoice.branch}`);
      if (logoRes.ok) {
        const logoJson = await logoRes.json();
        if (logoJson.logoData) logoUrl = logoJson.logoData;
      }
    } catch {}

    // Generate QR code
    let qrDataUrl = '';
    try {
      const QRCode = (await import('qrcode')).default;
      const sellerName = companyInfo.companyName || t.salesInvoices;
      const vatNumber = companyInfo.taxNumber || '';
      const totalAmount = formatNumber(invoice.totalAmount);
      const vatAmount = formatNumber(invoice.taxAmount);
      const qrContent = `${sellerName}|${vatNumber}|${invoice.createdAt}|${totalAmount}|${vatAmount}`;
      qrDataUrl = await QRCode.toDataURL(qrContent, {
        width: 128, margin: 1,
        color: { dark: '#000000', light: '#ffffff' },
      });
    } catch {}

    const rw = printSettings.receiptWidth;
    const fs = printSettings.fontSize;
    const lw = printSettings.logoWidth;
    const lh = printSettings.logoHeight;
    const isReturn = invoice.isReturn;
    const branchNameEn = getBranchDisplayName(t, invoice.branch);
    const customerDisplay = invoice.customerName || t.cashCustomerLabel;

    const invDate = new Date(invoice.createdAt);
    const dateStr = invDate.toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: '2-digit' });
    const timeStr = invDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });

    const receiptCurrency = (amount: number) => {
      const formatted = formatNumber(amount);
      if (currencySymbolUrl) {
        return `${formatted} <img src="${currencySymbolUrl}" alt="SAR" style="width:10px;height:10px;object-fit:contain;vertical-align:middle;display:inline;" />`;
      }
      return `${formatted} SAR`;
    };

    const itemsRows = (invoice.items || []).map((item) => `
      <tr>
        <td class="item-name-cell">
          <span class="item-name-ar">${item.name}</span>
          ${item.nameEn ? `<span class="item-name-en">${item.nameEn}</span>` : ''}
        </td>
        <td class="item-qty-cell">${item.quantity}</td>
        <td class="item-price-cell">${receiptCurrency(item.totalPrice)}</td>
      </tr>
    `).join('');

    const paymentsHtml = (invoice.payments || []).map((p) => {
      const methodLabel = getPaymentMethodLabel(t, p.method);
      return `<div class="payment-line"><span>${methodLabel}</span><span>${receiptCurrency(p.amount)}</span></div>`;
    }).join('');

    const discountLine = invoice.discountAmount > 0
      ? `<div class="totals-row discount"><span>${t.invoiceDiscount} ${invoice.discountPercentage}%</span><span>-${receiptCurrency(invoice.discountAmount)}</span></div>`
      : '';

    const content = `
      <div class="receipt">
        ${logoUrl ? `<div class="center" style="margin-bottom:4px;"><img class="logo" src="${logoUrl}" alt="${t.print}" /></div>` : ''}
        <div class="center">
          <div class="company-name">${companyInfo.companyName || t.salesInvoices}</div>
          <div class="company-name-en">${companyInfo.companyNameEn || ''}</div>
        </div>
        ${(companyInfo.address || companyInfo.addressEn) ? `
          <div class="center">
            ${companyInfo.address ? `<div class="company-address">${companyInfo.address}</div>` : ''}
            ${companyInfo.addressEn ? `<div class="company-address-en">${companyInfo.addressEn}</div>` : ''}
          </div>
        ` : ''}
        ${companyInfo.phone ? `<div class="center"><div class="company-info">${t.phone || 'Tel'} : ${companyInfo.phone}</div></div>` : ''}
        ${companyInfo.taxNumber ? `<div class="center"><div class="company-info">${t.vatNumber} : ${companyInfo.taxNumber}</div></div>` : ''}
        ${isReturn ? `<div class="separator"></div><div class="center bold" style="font-size:13px; color:#c00;">${t.returned}</div>` : ''}
        <div class="separator"></div>
        <div class="info-row"><span>${t.branch} : ${branchNameEn}</span></div>
        <div class="info-row"><span>${t.invoiceNumber} : ${invoice.invoiceNumber}</span></div>
        <div class="info-row"><span>${t.date} : ${dateStr}</span></div>
        <div class="info-row"><span>${t.description} : ${timeStr}</span></div>
        ${invoice.table?.name ? `<div class="info-row"><span>${t.tableName || t.branch} : ${invoice.table.name}</span></div>` : ''}
        <div class="info-row"><span>${t.invoiceCustomer} : ${customerDisplay}</span></div>
        <div class="double-separator"></div>
        <table class="items-table">
          <thead>
            <tr>
              <th>الصنف / Item</th>
              <th>الكمية / Qty</th>
              <th>السعر / Price</th>
            </tr>
          </thead>
          <tbody>
            ${itemsRows}
          </tbody>
        </table>
        <div class="totals-row"><span>${t.subtotal}</span><span>${receiptCurrency(invoice.subtotal)}</span></div>
        ${discountLine}
        <div class="totals-row"><span>${t.tax} 15%</span><span>${receiptCurrency(invoice.taxAmount)}</span></div>
        <div class="double-separator"></div>
        <div class="totals-row bold"><span>${t.total}</span><span>${receiptCurrency(invoice.totalAmount)}</span></div>
        <div class="double-separator"></div>
        <div class="payment-header">${t.paymentMethod}</div>
        ${paymentsHtml}
        <div class="totals-row"><span>${t.paid}</span><span>${receiptCurrency(invoice.paidAmount)}</span></div>
        <div class="status-line"><span>الحالة / Status</span><span>${invoice.payments?.some((p: any) => p.method === 'CREDIT') ? 'آجل / Unpaid' : 'مدفوع / Paid'}</span></div>
        ${qrDataUrl ? `<div class="single-separator"></div><div class="qr-code"><img src="${qrDataUrl}" alt="QR Code" /></div>` : ''}
        ${companyInfo.taxNumber ? `<div class="vat-label">${t.vatNumber}: ${companyInfo.taxNumber}</div>` : ''}
        <div class="footer">
          <div class="footer-thanks">${t.thankYou || ''}</div>
          <div class="footer-wish">${t.haveANiceDay || ''}</div>
        </div>
      </div>
    `;

    return `<!DOCTYPE html>
<html dir="${isRTL ? 'rtl' : 'ltr'}" lang="${isRTL ? 'ar' : 'en'}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=${rw}mm">
  <title>${t.receipt} ${invoice.invoiceNumber}</title>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&family=Roboto+Mono:wght@400;500;700&display=swap">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Cairo', sans-serif; width: ${rw}mm; margin: 0 auto; padding: 4mm; font-size: ${fs}px; line-height: 1.5; color: #000; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .num, .font-mono, .num-cell { font-family: 'Roboto Mono', 'Courier New', monospace !important; direction: ltr; font-variant-numeric: tabular-nums; font-feature-settings: 'tnum'; }
    .receipt { width: 100%; }
    .center { text-align: center; }
    .bold { font-weight: 700; }
    .separator { border-top: 1px dashed #555; margin: 3px 0; }
    .single-separator { border-top: 1px solid #555; margin: 3px 0; }
    .double-separator { border-top: 2px solid #000; margin: 3px 0; }
    .logo { width: ${lw}mm; height: ${lh}mm; margin: 0 auto 4px; display: block; object-fit: contain; }
    .company-name { font-size: 14px; font-weight: 700; line-height: 1.4; }
    .company-name-en { font-size: 11px; font-weight: 400; color: #444; line-height: 1.3; }
    .company-address { font-size: 9px; color: #444; line-height: 1.3; }
    .company-address-en { font-size: 9px; color: #444; line-height: 1.3; }
    .company-info { font-size: 9px; color: #444; line-height: 1.3; }
    .info-row { display: flex; justify-content: space-between; gap: 8px; padding: 1px 0; font-size: 10px; }
    .items-table { width: 100%; border-collapse: collapse; font-size: 10px; }
    .items-table th { font-weight: 700; font-size: 10px; padding: 2px 1px; text-align: right; border-bottom: 1px solid #000; }
    .items-table th:nth-child(2) { text-align: center; }
    .items-table th:nth-child(3) { text-align: left; direction: ltr; }
    .items-table td { padding: 2px 1px; vertical-align: top; line-height: 1.3; }
    .items-table td:nth-child(1) { text-align: right; }
    .items-table td:nth-child(2) { text-align: center; direction: ltr; white-space: nowrap; }
    .items-table td:nth-child(3) { text-align: left; direction: ltr; white-space: nowrap; }
    .items-table .item-name-ar { font-weight: 400; }
    .items-table .item-name-en { display: block; font-size: 8px; color: #555; direction: ltr; }
    .item-name-cell { text-align: right; }
    .item-qty-cell { text-align: center; direction: ltr; white-space: nowrap; font-family: 'Roboto Mono', 'Courier New', monospace; font-variant-numeric: tabular-nums; }
    .item-price-cell { text-align: left; direction: ltr; white-space: nowrap; font-family: 'Roboto Mono', 'Courier New', monospace; font-variant-numeric: tabular-nums; }
    .totals-row { display: flex; justify-content: space-between; gap: 8px; padding: 1px 0; font-size: 10px; }
    .totals-row.bold { font-weight: 700; font-size: 13px; padding: 2px 0; }
    .totals-row.discount { color: #c00; }
    .tax-sub-label { font-size: 8px; color: #555; }
    .payment-header { font-size: 10px; font-weight: 700; margin-bottom: 2px; }
    .payment-line { display: flex; justify-content: space-between; gap: 8px; padding: 1px 0; font-size: 10px; }
    .status-line { display: flex; justify-content: space-between; gap: 8px; padding: 1px 0; font-size: 10px; font-weight: 700; }
    .change-line { font-weight: 700; font-size: 12px; text-align: center; padding: 3px 0; border: 1px solid #000; margin: 2px 0; }
    .qr-code { text-align: center; margin: 4px auto; }
    .qr-code img { width: 28mm; height: 28mm; }
    .vat-label { font-size: 8px; color: #555; text-align: center; margin-top: 2px; }
    .footer { text-align: center; font-size: 9px; color: #666; margin-top: 4px; line-height: 1.4; }
    .footer-thanks { font-size: 11px; font-weight: 700; color: #333; }
    .footer-en { font-size: 8px; color: #888; }
    .footer-wish { font-size: 11px; font-weight: 700; color: #333; }
    @media print { body { width: ${rw}mm; margin: 0; padding: 2mm; } @page { margin: 0; size: ${rw}mm auto; } }
  </style>
</head>
<body>${content}</body>
</html>`;
  };

  // ─── Print Receipt from Preview ─────────────────────────────────

  const handlePrintFromPreview = () => {
    if (!receiptPreviewHtml) return;

    const printWindow = window.open('', '_blank', 'width=320,height=600');
    if (!printWindow) {
      toast.error(t.allowPopups);
      return;
    }

    printWindow.document.write(receiptPreviewHtml);
    printWindow.document.close();
    printWindow.focus();

    const waitForResources = async () => {
      try { await printWindow.document.fonts.ready; } catch {}
      const images = printWindow.document.querySelectorAll('img');
      if (images.length > 0) {
        await Promise.all(Array.from(images).map(img =>
          new Promise<void>((resolve) => {
            if (img.complete) resolve();
            else { img.onload = () => resolve(); img.onerror = () => resolve(); }
          })
        ));
      }
      await new Promise(r => setTimeout(r, 200));
      printWindow.print();
      setTimeout(() => printWindow.close(), 1000);
    };

    waitForResources();
  };

  // ─── Reprint Invoice (quick print without preview) ──────────────

  const handleReprint = async (invoice: POSInvoice) => {
    // Same as view receipt but auto-prints
    try {
      const res = await fetch(`/api/pos/invoices/${invoice.id}`);
      if (!res.ok) throw new Error(t.failedToFetchInvoice);
      const fullInvoice = await res.json();

      let htmlToPrint = '';
      if (fullInvoice.receiptHtml) {
        htmlToPrint = fullInvoice.receiptHtml;
      } else {
        htmlToPrint = await generateFallbackReceipt(fullInvoice);
      }

      const printWindow = window.open('', '_blank', 'width=320,height=600');
      if (!printWindow) {
        toast.error(t.allowPopups);
        return;
      }

      printWindow.document.write(htmlToPrint);
      printWindow.document.close();
      printWindow.focus();

      const waitForResources = async () => {
        try { await printWindow.document.fonts.ready; } catch {}
        const images = printWindow.document.querySelectorAll('img');
        if (images.length > 0) {
          await Promise.all(Array.from(images).map(img =>
            new Promise<void>((resolve) => {
              if (img.complete) resolve();
              else { img.onload = () => resolve(); img.onerror = () => resolve(); }
            })
          ));
        }
        await new Promise(r => setTimeout(r, 200));
        printWindow.print();
        setTimeout(() => printWindow.close(), 1000);
      };

      waitForResources();
    } catch (error: any) {
      toast.error(error.message || t.failedToFetchInvoice);
    }
  };

  // ─── Export to Excel ────────────────────────────────────────

  const handleExport = async () => {
    try {
      const data = filteredInvoices.map((inv) => ({
        invoiceNumber: inv.invoiceNumber,
        date: new Date(inv.createdAt).toLocaleDateString(isRTL ? 'ar-SA-u-nu-latn' : 'en-US'),
        customer: inv.customerName || t.walkIn,
        branch: getBranchDisplayName(t, inv.branch),
        subtotal: inv.subtotal,
        discount: inv.discountAmount,
        tax: inv.taxAmount,
        total: inv.totalAmount,
        paymentMethod: inv.paymentMethod ? getPaymentMethodLabel(t, inv.paymentMethod) : '-',
        status: inv.isReturn ? t.returned : t.sales || t.sale,
      }));

      await exportToExcel({
        data,
        columns: [
          { key: 'invoiceNumber', header: t.invoiceNumber, width: 18 },
          { key: 'date', header: t.date, width: 14 },
          { key: 'customer', header: t.invoiceCustomer, width: 20 },
          { key: 'branch', header: t.branch, width: 16 },
          { key: 'subtotal', header: t.subtotal, width: 14 },
          { key: 'discount', header: t.discount, width: 12 },
          { key: 'tax', header: t.tax, width: 12 },
          { key: 'total', header: t.total, width: 14 },
          { key: 'paymentMethod', header: t.paymentMethod, width: 14 },
          { key: 'status', header: t.status, width: 10 },
        ],
        sheetName: activeTab === 'sales' ? t.sales : t.returnsLabel || t.returns,
        fileName: activeTab === 'sales' ? `sales-invoices-${new Date().toISOString().slice(0, 10)}.xlsx` : `return-invoices-${new Date().toISOString().slice(0, 10)}.xlsx`,
        title: activeTab === 'sales' ? t.salesInvoices : t.returnsLabel || t.returns,
      });

      toast.success(t.success);
    } catch {
      toast.error(t.error);
    }
  };

  // ─── Print A4 Sales Report ──────────────────────────────────

  const [reportLoading, setReportLoading] = useState(false);

  const handlePrintA4Report = async () => {
    try {
      setReportLoading(true);
      const params = new URLSearchParams();
      if (filterDateFrom) params.set('dateFrom', filterDateFrom);
      if (filterDateTo) params.set('dateTo', filterDateTo);
      if (filterBranch !== 'all') params.set('branch', filterBranch);

      const res = await fetch(`/api/reports/sales-report?${params.toString()}`);
      if (!res.ok) throw new Error(t.failedToFetchData);
      const report = await res.json();

      const dateFromStr = filterDateFrom ? new Date(filterDateFrom).toLocaleDateString(isRTL ? 'ar-SA-u-nu-latn' : 'en-US') : t.from;
      const dateToStr = filterDateTo ? new Date(filterDateTo).toLocaleDateString(isRTL ? 'ar-SA-u-nu-latn' : 'en-US') : t.to;
      const branches = Object.values(report.branches) as any[];
      const gt = report.grandTotals;

      const formatAmt = (n: number) => formatNumber(n);

      // Build branch detail sections
      const branchSections = branches.map((b: any) => {
        const platformEntries = Object.entries(b.platforms || {}) as [string, any][];
        const platformHtml = platformEntries.length > 0 ? `
          <div class="section-title">${t.platform || 'Platform'} ${t.sales}</div>
          <table class="detail-table">
            <thead>
              <tr>
                <th>${t.platform || 'Platform'}</th>
                <th>${t.invoicesCount}</th>
                <th>${t.amount}</th>
              </tr>
            </thead>
            <tbody>
              ${platformEntries.map(([name, data]: [string, any]) => `
                <tr>
                  <td>${name}</td>
                  <td class="num-cell">${data.count}</td>
                  <td class="num-cell">${formatAmt(data.amount)}</td>
                </tr>
              `).join('')}
              <tr class="total-row">
                <td><strong>${t.total} ${t.platform || 'Platform'}</strong></td>
                <td></td>
                <td class="num-cell"><strong>${formatAmt(platformEntries.reduce((s: number, [, d]: [string, any]) => s + d.amount, 0))}</strong></td>
              </tr>
            </tbody>
          </table>
        ` : '';

        return `
          <div class="branch-section">
            <div class="branch-header">${b.nameAr} / ${b.name}</div>

            <!-- Bank Breakdown -->
            <div class="section-title">${t.bankSub || 'Bank'}</div>
            <table class="detail-table">
              <thead>
                <tr>
                  <th>${t.paymentMethod}</th>
                  <th>${t.invoicesCount}</th>
                  <th>${t.amount}</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>${t.mada}</td>
                  <td class="num-cell">${b.bank.mada.count}</td>
                  <td class="num-cell">${formatAmt(b.bank.mada.amount)}</td>
                </tr>
                <tr>
                  <td>${t.visa}</td>
                  <td class="num-cell">${b.bank.visa.count}</td>
                  <td class="num-cell">${formatAmt(b.bank.visa.amount)}</td>
                </tr>
                <tr>
                  <td>${t.mastercard}</td>
                  <td class="num-cell">${b.bank.mastercard.count}</td>
                  <td class="num-cell">${formatAmt(b.bank.mastercard.amount)}</td>
                </tr>
                <tr>
                  <td>${t.otherCard}</td>
                  <td class="num-cell">${b.bank.otherCard.count}</td>
                  <td class="num-cell">${formatAmt(b.bank.otherCard.amount)}</td>
                </tr>
                <tr class="total-row">
                  <td><strong>${t.total} ${t.bankSub || 'Bank'}</strong></td>
                  <td></td>
                  <td class="num-cell"><strong>${formatAmt(b.bank.total)}</strong></td>
                </tr>
              </tbody>
            </table>

            <!-- Platform Sales -->
            ${platformHtml}

            <!-- Branch Summary -->
            <div class="section-title">${t.branch} ${t.sales}</div>
            <table class="detail-table">
              <tbody>
                <tr>
                  <td>${t.sales}</td>
                  <td class="num-cell">${formatAmt(b.sales.total)}</td>
                </tr>
                <tr>
                  <td>${t.discount}</td>
                  <td class="num-cell">${formatAmt(b.sales.discount)}</td>
                </tr>
                <tr>
                  <td>${t.tax}</td>
                  <td class="num-cell">${formatAmt(b.sales.tax)}</td>
                </tr>
                <tr>
                  <td>${t.cash}</td>
                  <td class="num-cell">${formatAmt(b.cash.total)}</td>
                </tr>
                <tr>
                  <td>${t.bankSub || 'Bank'}</td>
                  <td class="num-cell">${formatAmt(b.bank.total)}</td>
                </tr>
                <tr>
                  <td>${t.credit}</td>
                  <td class="num-cell">${formatAmt(b.credit.total)}</td>
                </tr>
                <tr>
                  <td>${t.returnsLabel || t.returns}</td>
                  <td class="num-cell">${formatAmt(b.returns.total)}</td>
                </tr>
                <tr>
                  <td>${t.invoicesCount}</td>
                  <td class="num-cell">${b.sales.count}</td>
                </tr>
                <tr>
                  <td>${t.items}</td>
                  <td class="num-cell">${b.sales.itemsCount}</td>
                </tr>
              </tbody>
            </table>
          </div>
        `;
      }).join('');

      // Summary cards HTML
      const summaryCards = branches.map((b: any) => `
        <div class="summary-card">
          <div class="card-title">${b.nameAr}</div>
          <div class="card-row"><span>${t.sales}</span><span class="num-cell">${formatAmt(b.sales.total)}</span></div>
          <div class="card-row"><span>${t.discount}</span><span class="num-cell">${formatAmt(b.sales.discount)}</span></div>
          <div class="card-row"><span>${t.tax}</span><span class="num-cell">${formatAmt(b.sales.tax)}</span></div>
          <div class="card-row"><span>${t.invoicesCount}</span><span class="num-cell">${b.sales.count}</span></div>
          <div class="card-row"><span>${t.bankSub || 'Bank'}</span><span class="num-cell">${formatAmt(b.bank.total)}</span></div>
          <div class="card-row"><span>${t.cash}</span><span class="num-cell">${formatAmt(b.cash.total)}</span></div>
          <div class="card-row"><span>${t.credit}</span><span class="num-cell">${formatAmt(b.credit.total)}</span></div>
          <div class="card-row"><span>${t.items}</span><span class="num-cell">${b.sales.itemsCount}</span></div>
        </div>
      `).join('');

      const printContent = `
        <div class="report">
          <div class="report-header">
            <div class="company-name">${companyInfo.companyName || t.companyName}</div>
            <div class="company-name-en">${companyInfo.companyNameEn || ''}</div>
            <div class="report-title">${t.salesInvoices} - ${t.dailyReport || 'Report'}</div>
            <div class="report-period">${t.from} ${dateFromStr} ${t.to} ${dateToStr}</div>
            ${companyInfo.taxNumber ? `<div class="tax-number">${t.vatNumber}: ${companyInfo.taxNumber}</div>` : ''}
          </div>

          <!-- Grand Totals -->
          <div class="grand-totals">
            <div class="grand-total-item"><span>${t.total} ${t.sales}</span><span class="num-cell">${formatAmt(gt.sales)}</span></div>
            <div class="grand-total-item"><span>${t.total} ${t.discount}</span><span class="num-cell">${formatAmt(gt.discount)}</span></div>
            <div class="grand-total-item"><span>${t.total} ${t.tax}</span><span class="num-cell">${formatAmt(gt.tax)}</span></div>
            <div class="grand-total-item"><span>${t.invoicesCount}</span><span class="num-cell">${gt.invoiceCount}</span></div>
            <div class="grand-total-item"><span>${t.total} ${t.bankSub || 'Bank'}</span><span class="num-cell">${formatAmt(gt.bank)}</span></div>
            <div class="grand-total-item"><span>${t.total} ${t.cash}</span><span class="num-cell">${formatAmt(gt.cash)}</span></div>
            <div class="grand-total-item"><span>${t.total} ${t.credit}</span><span class="num-cell">${formatAmt(gt.credit)}</span></div>
            <div class="grand-total-item"><span>${t.total} ${t.items}</span><span class="num-cell">${gt.itemsCount}</span></div>
            <div class="grand-total-item highlight"><span>${t.netSales}</span><span class="num-cell">${formatAmt(gt.net)}</span></div>
          </div>

          <!-- Branch Summary Cards -->
          <div class="summary-cards">${summaryCards}</div>

          <!-- Branch Details -->
          ${branchSections}
        </div>
      `;

      const printWindow = window.open('', '_blank', 'width=800,height=1100');
      if (!printWindow) {
        toast.error(t.allowPopups);
        return;
      }

      printWindow.document.write(`
        <!DOCTYPE html>
        <html dir="${isRTL ? 'rtl' : 'ltr'}" lang="${isRTL ? 'ar' : 'en'}">
        <head>
          <meta charset="UTF-8">
          <title>${t.salesInvoices} - ${t.dailyReport || 'Report'}</title>
          <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&family=Roboto+Mono:wght@400;500;700&display=swap">
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body {
              font-family: 'Cairo', sans-serif;
              direction: ${isRTL ? 'rtl' : 'ltr'};
              width: 210mm;
              margin: 0 auto;
              padding: 10mm;
              font-size: 11px;
              line-height: 1.6;
              color: #000;
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }
            .num, .font-mono, .num-cell { font-family: 'Roboto Mono', 'Courier New', monospace !important; direction: ltr; font-variant-numeric: tabular-nums; font-feature-settings: 'tnum'; }
            .report { width: 100%; }
            .report-header { text-align: center; margin-bottom: 20px; border-bottom: 2px solid #000; padding-bottom: 12px; }
            .company-name { font-size: 20px; font-weight: 700; }
            .company-name-en { font-size: 14px; color: #555; }
            .report-title { font-size: 16px; font-weight: 700; margin-top: 8px; color: #1a7a4c; }
            .report-period { font-size: 12px; color: #555; margin-top: 4px; }
            .tax-number { font-size: 10px; color: #777; margin-top: 2px; }

            .grand-totals {
              display: grid;
              grid-template-columns: repeat(3, 1fr);
              gap: 6px;
              margin-bottom: 16px;
            }
            .grand-total-item {
              display: flex;
              justify-content: space-between;
              gap: 10px;
              padding: 6px 10px;
              border: 1px solid #ddd;
              border-radius: 4px;
              background: #f8f9fa;
              font-size: 11px;
            }
            .grand-total-item.highlight {
              background: #e8f5e9;
              border-color: #4caf50;
              font-weight: 700;
              font-size: 13px;
            }

            .summary-cards {
              display: grid;
              grid-template-columns: repeat(${Math.min(branches.length, 3)}, 1fr);
              gap: 8px;
              margin-bottom: 20px;
            }
            .summary-card {
              border: 1px solid #ccc;
              border-radius: 6px;
              padding: 10px;
              background: #fff;
            }
            .card-title {
              font-size: 13px;
              font-weight: 700;
              text-align: center;
              margin-bottom: 8px;
              padding-bottom: 4px;
              border-bottom: 1px solid #ddd;
              color: #1a7a4c;
            }
            .card-row {
              display: flex;
              justify-content: space-between;
              gap: 8px;
              padding: 2px 0;
              font-size: 10px;
            }

            .branch-section {
              margin-bottom: 16px;
              page-break-inside: avoid;
            }
            .branch-header {
              font-size: 15px;
              font-weight: 700;
              padding: 6px 12px;
              background: #1a7a4c;
              color: #fff;
              border-radius: 4px;
              margin-bottom: 10px;
            }
            .section-title {
              font-size: 12px;
              font-weight: 700;
              margin: 10px 0 6px;
              ${isRTL ? 'padding-right' : 'padding-left'}: 8px;
              ${isRTL ? 'border-right' : 'border-left'}: 3px solid #1a7a4c;
              color: #333;
            }
            .detail-table {
              width: 100%;
              border-collapse: collapse;
              margin-bottom: 6px;
            }
            .detail-table th, .detail-table td {
              padding: 4px 10px;
              border: 1px solid #ddd;
              text-align: ${isRTL ? 'right' : 'left'};
              font-size: 10px;
            }
            .detail-table th {
              background: #f0f0f0;
              font-weight: 700;
            }
            .detail-table .total-row {
              background: #f8f9fa;
              font-weight: 700;
            }

            @media print {
              body { width: 210mm; margin: 0; padding: 8mm; }
              @page { margin: 8mm; size: A4; }
            }
          </style>
        </head>
        <body>${printContent}</body>
        </html>
      `);
      printWindow.document.close();
      printWindow.focus();

      const waitForResources = async () => {
        try {
          await printWindow.document.fonts.ready;
        } catch { /* fallback */ }
        await new Promise((r) => setTimeout(r, 300));
        printWindow.print();
        setTimeout(() => { printWindow.close(); }, 1000);
      };
      waitForResources();
    } catch (error: any) {
      toast.error(error.message || t.failedToCreateReport);
    } finally {
      setReportLoading(false);
    }
  };

  // ─── Format Date ────────────────────────────────────────────

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString(isRTL ? 'ar-SA-u-nu-latn' : 'en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  };

  const formatTime = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // ─── Render ─────────────────────────────────────────────────

  return (
    <div dir={isRTL ? 'rtl' : 'ltr'} className="flex flex-col gap-4 p-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Receipt className="h-6 w-6 text-emerald-600" />
          <h1 className="text-xl font-bold">{t.salesInvoices}</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handlePrintA4Report}
            disabled={reportLoading}
            className="gap-1"
          >
            {reportLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileBarChart className="h-4 w-4" />}
            {t.dailyReport || t.print}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            disabled={filteredInvoices.length === 0}
          >
            <FileSpreadsheet className="h-4 w-4 ml-1" />
            {t.exportExcel}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowFilters(!showFilters)}
            className={showFilters ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : ''}
          >
            <Filter className="h-4 w-4 ml-1" />
            {t.filter}
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="border-emerald-200 bg-emerald-50/50">
          <CardContent className="p-4">
            <div className="text-xs text-emerald-600 mb-1">{t.total} {t.sales}</div>
            <div className="text-lg font-bold text-emerald-700">
              <CurrencyAmount amount={totalSales} bold />
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {salesInvoices.length} {t.invoiceNumber}
            </div>
          </CardContent>
        </Card>
        <Card className="border-red-200 bg-red-50/50">
          <CardContent className="p-4">
            <div className="text-xs text-red-600 mb-1">{t.total} {t.returnsLabel || t.returns}</div>
            <div className="text-lg font-bold text-red-700">
              <CurrencyAmount amount={totalReturns} bold />
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {returnInvoices.length} {t.invoiceNumber}
            </div>
          </CardContent>
        </Card>
        <Card className="border-amber-200 bg-amber-50/50">
          <CardContent className="p-4">
            <div className="text-xs text-amber-600 mb-1">{t.total} {t.discount}</div>
            <div className="text-lg font-bold text-amber-700">
              <CurrencyAmount amount={totalDiscount} bold />
            </div>
          </CardContent>
        </Card>
        <Card className="border-sky-200 bg-sky-50/50">
          <CardContent className="p-4">
            <div className="text-xs text-sky-600 mb-1">{t.total} {t.tax}</div>
            <div className="text-lg font-bold text-sky-700">
              <CurrencyAmount amount={totalTax} bold />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Search Bar */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t.searchInvoices}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pr-9"
          />
        </div>
        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            <X className="h-4 w-4 ml-1" />
            {t.clear}
          </Button>
        )}
      </div>

      {/* Filters Panel */}
      {showFilters && (
        <Card>
          <CardContent className="p-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
              {/* Customer Filter */}
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">{t.invoiceCustomer}</label>
                <Select value={filterCustomer} onValueChange={setFilterCustomer}>
                  <SelectTrigger>
                    <SelectValue placeholder={t.all} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t.all}</SelectItem>
                    {customers.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Branch Filter */}
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">{t.branch}</label>
                <Select value={filterBranch} onValueChange={setFilterBranch}>
                  <SelectTrigger>
                    <SelectValue placeholder={t.all} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t.all}</SelectItem>
                    {branches.map((b) => (
                      <SelectItem key={b.key} value={b.key}>
                        {getBranchDisplayName(t, b.key)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Date From */}
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">{t.dateFrom}</label>
                <div className="relative">
                  <Calendar className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                  <Input
                    type="date"
                    value={filterDateFrom}
                    onChange={(e) => setFilterDateFrom(e.target.value)}
                    className="pr-9"
                  />
                </div>
              </div>

              {/* Date To */}
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">{t.dateTo}</label>
                <div className="relative">
                  <Calendar className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                  <Input
                    type="date"
                    value={filterDateTo}
                    onChange={(e) => setFilterDateTo(e.target.value)}
                    className="pr-9"
                  />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tabs and Table */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value="sales" className="flex-1 sm:flex-initial gap-1">
            <Receipt className="h-4 w-4" />
            {t.sales}
            <Badge variant="secondary" className="mr-1 text-xs">
              {salesInvoices.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="returns" className="flex-1 sm:flex-initial gap-1">
            <RotateCcw className="h-4 w-4" />
            {t.returnsLabel || t.returns}
            <Badge variant="secondary" className="mr-1 text-xs">
              {returnInvoices.length}
            </Badge>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="sales" className="mt-3">
          <InvoiceTable
            invoices={salesInvoices}
            loading={loading}
            expandedRows={expandedRows}
            toggleRowExpand={toggleRowExpand}
            onReprint={handleReprint}
            onViewReceipt={handleViewReceipt}
            onDelete={handleDeleteInvoice}
            formatDate={formatDate}
            formatTime={formatTime}
            isReturnTab={false}
            currencySymbolUrl={currencySymbolUrl}
            canEdit={canEdit}
          />
        </TabsContent>

        <TabsContent value="returns" className="mt-3">
          <InvoiceTable
            invoices={returnInvoices}
            loading={loading}
            expandedRows={expandedRows}
            toggleRowExpand={toggleRowExpand}
            onReprint={handleReprint}
            onViewReceipt={handleViewReceipt}
            onDelete={handleDeleteInvoice}
            formatDate={formatDate}
            formatTime={formatTime}
            isReturnTab={true}
            currencySymbolUrl={currencySymbolUrl}
            canEdit={canEdit}
          />
        </TabsContent>
      </Tabs>

      {/* Receipt Preview Dialog */}
      <Dialog open={receiptPreviewOpen} onOpenChange={setReceiptPreviewOpen}>
        <DialogContent dir={isRTL ? 'rtl' : 'ltr'} className="sm:max-w-[400px] p-0 gap-0 max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader className="sr-only">
            <DialogTitle>{t.receipt}</DialogTitle>
            <DialogDescription className="sr-only">معاينة الإيصال</DialogDescription>
          </DialogHeader>

          {/* Receipt Preview Content */}
          <div className="flex-1 overflow-auto">
            {receiptPreviewLoading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="size-8 animate-spin text-emerald-600" />
              </div>
            ) : receiptPreviewHtml ? (
              <iframe
                srcDoc={receiptPreviewHtml}
                className="w-full border-0"
                style={{ height: '60vh', minWidth: '300px' }}
                title={t.receipt}
              />
            ) : (
              <div className="flex items-center justify-center py-20 text-muted-foreground">
                {t.noData}
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex gap-2 p-3 border-t shrink-0">
            <Button
              className="flex-1 gap-2"
              onClick={handlePrintFromPreview}
              disabled={!receiptPreviewHtml || receiptPreviewLoading}
            >
              <Printer className="size-4" />
              {t.printReceipt}
            </Button>
            <Button
              variant="outline"
              className="flex-1 gap-2"
              onClick={() => setReceiptPreviewOpen(false)}
            >
              <X className="size-4" />
              {t.close}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Invoice Confirmation Dialog (with Supervisor Password) */}
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent dir="rtl" className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-center justify-center">
              <AlertTriangle className="size-5 text-red-500" />
              حذف الفاتورة / Delete Invoice
            </DialogTitle>
            <DialogDescription className="sr-only">تأكيد حذف الفاتورة</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center gap-4 py-4">
            <div className="flex size-16 items-center justify-center rounded-full bg-red-100 dark:bg-red-950/30">
              <Trash2 className="size-8 text-red-500" />
            </div>
            <div className="text-center">
              <p className="font-medium">{deleteTargetInvoice?.invoiceNumber}</p>
              <p className="text-sm text-muted-foreground mt-1">
                المبلغ: {formatNumber(deleteTargetInvoice?.totalAmount || 0)} ر.س
              </p>
            </div>
            <p className="text-sm text-red-600 text-center">
              سيتم حذف الفاتورة وجميع القيود المحاسبية المرتبطة بها نهائياً
              <br />
              <span className="text-xs">This will permanently delete the invoice and all related accounting entries</span>
            </p>
            <div className="w-full max-w-xs space-y-2">
              <Input
                type="password"
                placeholder="كلمة مرور المشرف / Supervisor Password"
                value={supervisorPassword}
                onChange={(e) => { setSupervisorPassword(e.target.value); setSupervisorPasswordError(''); }}
                onKeyDown={(e) => { if (e.key === 'Enter') confirmDeleteInvoice(); }}
                className="text-center text-lg tracking-widest"
                autoFocus
              />
              {supervisorPasswordError && (
                <p className="text-xs text-red-500 text-center">{supervisorPasswordError}</p>
              )}
            </div>
            <div className="flex gap-2 w-full max-w-xs">
              <Button variant="destructive" className="flex-1 gap-2"
                onClick={confirmDeleteInvoice} disabled={!supervisorPassword.trim() || deleting}>
                {deleting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                حذف نهائي
              </Button>
              <Button variant="outline" className="flex-1"
                onClick={() => { setDeleteConfirmOpen(false); setSupervisorPassword(''); setSupervisorPasswordError(''); }}>
                إلغاء
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Invoice Table Sub-Component ──────────────────────────────────

function InvoiceTable({
  invoices,
  loading,
  expandedRows,
  toggleRowExpand,
  onReprint,
  onViewReceipt,
  onDelete,
  formatDate,
  formatTime,
  isReturnTab,
  currencySymbolUrl,
  canEdit,
}: {
  invoices: POSInvoice[];
  loading: boolean;
  expandedRows: Set<string>;
  toggleRowExpand: (id: string) => void;
  onReprint: (invoice: POSInvoice) => void;
  onViewReceipt: (invoice: POSInvoice) => void;
  onDelete: (invoice: POSInvoice) => void;
  formatDate: (d: string) => string;
  formatTime: (d: string) => string;
  isReturnTab: boolean;
  currencySymbolUrl: string;
  canEdit: boolean;
}) {
  const { t } = useTranslation();

  if (loading) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <div className="flex flex-col items-center gap-3">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-200 border-t-emerald-600" />
            <p className="text-sm text-muted-foreground">{t.loading}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (invoices.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <div className="flex flex-col items-center gap-3">
            <Receipt className="h-12 w-12 text-muted-foreground/30" />
            <p className="text-muted-foreground">
              {t.noInvoices}
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8"></TableHead>
                <TableHead>{t.invoiceNumber}</TableHead>
                <TableHead>{t.date}</TableHead>
                <TableHead>{t.invoiceCustomer}</TableHead>
                <TableHead>{t.branch}</TableHead>
                <TableHead className="text-left" dir="ltr">{t.subtotal}</TableHead>
                <TableHead className="text-left" dir="ltr">{t.discount}</TableHead>
                <TableHead className="text-left" dir="ltr">{t.tax}</TableHead>
                <TableHead className="text-left" dir="ltr">{t.total}</TableHead>
                <TableHead>{t.paymentMethod}</TableHead>
                <TableHead>{t.status}</TableHead>
                <TableHead>{t.actions}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.map((invoice) => {
                const isExpanded = expandedRows.has(invoice.id);
                return (
                  <InvoiceRow
                    key={invoice.id}
                    invoice={invoice}
                    isExpanded={isExpanded}
                    toggleExpand={() => toggleRowExpand(invoice.id)}
                    onReprint={onReprint}
                    onViewReceipt={onViewReceipt}
                    onDelete={onDelete}
                    formatDate={formatDate}
                    formatTime={formatTime}
                    isReturnTab={isReturnTab}
                    currencySymbolUrl={currencySymbolUrl}
                    canEdit={canEdit}
                  />
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Invoice Row Sub-Component ────────────────────────────────────

function InvoiceRow({
  invoice,
  isExpanded,
  toggleExpand,
  onReprint,
  onViewReceipt,
  onDelete,
  formatDate,
  formatTime,
  isReturnTab,
  currencySymbolUrl,
  canEdit,
}: {
  invoice: POSInvoice;
  isExpanded: boolean;
  toggleExpand: () => void;
  onReprint: (invoice: POSInvoice) => void;
  onViewReceipt: (invoice: POSInvoice) => void;
  onDelete: (invoice: POSInvoice) => void;
  formatDate: (d: string) => string;
  formatTime: (d: string) => string;
  isReturnTab: boolean;
  currencySymbolUrl: string;
  canEdit: boolean;
}) {
  const { t } = useTranslation();

  const statusColor = invoice.isReturn
    ? 'bg-red-100 text-red-700 border-red-200'
    : 'bg-emerald-100 text-emerald-700 border-emerald-200';
  const statusLabel = invoice.isReturn ? t.returned : t.posted;

  const paymentLabel = invoice.paymentMethod
    ? getPaymentMethodLabel(t, invoice.paymentMethod)
    : '-';

  return (
    <>
      <TableRow
        className="cursor-pointer hover:bg-muted/50 transition-colors"
        onClick={toggleExpand}
      >
        <TableCell className="w-8">
          {isExpanded ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </TableCell>
        <TableCell className="font-mono font-medium text-sm">
          {invoice.invoiceNumber}
        </TableCell>
        <TableCell className="text-sm">
          <div>{formatDate(invoice.createdAt)}</div>
          <div className="text-xs text-muted-foreground">{formatTime(invoice.createdAt)}</div>
        </TableCell>
        <TableCell className="text-sm">
          {invoice.customerName || (
            <span className="text-muted-foreground">{t.walkIn}</span>
          )}
        </TableCell>
        <TableCell className="text-sm">
          {getBranchDisplayName(t, invoice.branch)}
        </TableCell>
        <TableCell className="text-left" dir="ltr">
          <span className="text-sm">{formatNumber(invoice.subtotal)}</span>
        </TableCell>
        <TableCell className="text-left" dir="ltr">
          <span className="text-sm text-red-600">
            {invoice.discountAmount > 0 ? `-${formatNumber(invoice.discountAmount)}` : '-'}
          </span>
        </TableCell>
        <TableCell className="text-left" dir="ltr">
          <span className="text-sm">{formatNumber(invoice.taxAmount)}</span>
        </TableCell>
        <TableCell className="text-left" dir="ltr">
          <span className={`text-sm font-bold ${invoice.isReturn ? 'text-red-600' : 'text-emerald-700'}`}>
            {formatNumber(invoice.totalAmount)}
          </span>
        </TableCell>
        <TableCell className="text-sm">{paymentLabel}</TableCell>
        <TableCell>
          <Badge variant="outline" className={`text-xs ${statusColor}`}>
            {statusLabel}
          </Badge>
        </TableCell>
        <TableCell>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={(e) => {
                e.stopPropagation();
                onViewReceipt(invoice);
              }}
              title={t.view}
            >
              <Eye className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={(e) => {
                e.stopPropagation();
                onReprint(invoice);
              }}
              title={t.printReceipt}
            >
              <Printer className="h-4 w-4" />
            </Button>
            {!invoice.isReturn && invoice.status === 'FINALIZED' && canEdit && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-red-500 hover:text-red-700 hover:bg-red-50"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(invoice);
                }}
                title="حذف الفاتورة / Delete Invoice"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        </TableCell>
      </TableRow>

      {/* Expanded Items Row */}
      {isExpanded && (
        <TableRow className="bg-muted/30 hover:bg-muted/30">
          <TableCell colSpan={12} className="p-0">
            <div className="p-4">
              <div className="rounded-lg border bg-background p-3">
                {/* Invoice Details Header */}
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-semibold flex items-center gap-2">
                    <Receipt className="h-4 w-4 text-emerald-600" />
                    {t.invoiceNumber} {invoice.invoiceNumber}
                  </h4>
                  {invoice.table?.name && (
                    <Badge variant="secondary" className="text-xs">
                      {t.tableName}: {invoice.table.name}
                    </Badge>
                  )}
                </div>

                {/* Items Table */}
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">{t.items}</TableHead>
                        <TableHead className="text-xs text-left" dir="ltr">{t.qty}</TableHead>
                        <TableHead className="text-xs text-left" dir="ltr">{t.unitPrice}</TableHead>
                        <TableHead className="text-xs text-left" dir="ltr">{t.totalPrice}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(invoice.items || []).map((item) => (
                        <TableRow key={item.id}>
                          <TableCell className="text-sm py-2">
                            <div>{item.name}</div>
                            {item.nameEn && (
                              <div className="text-xs text-muted-foreground" dir="ltr">{item.nameEn}</div>
                            )}
                          </TableCell>
                          <TableCell className="text-sm py-2 text-left" dir="ltr">
                            {item.quantity}
                          </TableCell>
                          <TableCell className="text-sm py-2 text-left" dir="ltr">
                            {formatNumber(item.unitPrice)}
                          </TableCell>
                          <TableCell className="text-sm py-2 text-left font-medium" dir="ltr">
                            {formatNumber(item.totalPrice)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                {/* Totals Summary */}
                <Separator className="my-3" />
                <div className="flex flex-col items-end gap-1" dir="ltr">
                  <div className="flex items-center gap-4 text-sm">
                    <span className="text-muted-foreground">{t.subtotal}:</span>
                    <span className="font-medium w-24 text-right">{formatNumber(invoice.subtotal)}</span>
                  </div>
                  {invoice.discountAmount > 0 && (
                    <div className="flex items-center gap-4 text-sm">
                      <span className="text-muted-foreground">{t.discount} ({invoice.discountPercentage}%):</span>
                      <span className="font-medium w-24 text-right text-red-600">-{formatNumber(invoice.discountAmount)}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-4 text-sm">
                    <span className="text-muted-foreground">{t.tax} (15%):</span>
                    <span className="font-medium w-24 text-right">{formatNumber(invoice.taxAmount)}</span>
                  </div>
                  <Separator className="my-1" />
                  <div className="flex items-center gap-4 text-sm">
                    <span className="font-bold">{t.total}:</span>
                    <span className={`font-bold w-24 text-right ${invoice.isReturn ? 'text-red-600' : 'text-emerald-700'}`}>
                      {formatNumber(invoice.totalAmount)}
                    </span>
                  </div>
                </div>

                {/* Payments Info */}
                {invoice.payments && invoice.payments.length > 0 && (
                  <>
                    <Separator className="my-3" />
                    <div>
                      <h5 className="text-xs font-semibold mb-2">{t.paymentMethods}</h5>
                      <div className="flex flex-wrap gap-2">
                        {invoice.payments.map((p) => (
                          <Badge key={p.id} variant="outline" className="text-xs">
                            {getPaymentMethodLabel(t, p.method)}: {formatNumber(p.amount)}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </>
                )}

                {/* Original Invoice Reference */}
                {invoice.isReturn && invoice.originalInvoiceId && (
                  <>
                    <Separator className="my-3" />
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <RotateCcw className="h-3 w-3" />
                      <span>{t.returnLabel || t.returned}</span>
                    </div>
                  </>
                )}
              </div>
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}
