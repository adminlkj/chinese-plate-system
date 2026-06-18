'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import {
  BarChart3,
  Package,
  Users,
  Truck,
  TrendingUp,
  TrendingDown,
  Loader2,
  Download,
  Filter,
  Calendar,
  Search,
  AlertTriangle,
  FileSpreadsheet,
  ArrowUpDown,
  Wallet,
  Receipt,
} from 'lucide-react';
import { CurrencyAmount } from '@/components/ui/currency-symbol';
import { formatNumber } from '@/lib/types';
import { useTranslation } from '@/lib/i18n';
import { useAppStore } from '@/lib/store';
import { exportToExcel } from '@/lib/export-utils';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';

// ============================================================================
// Interfaces
// ============================================================================

interface ProductPerformanceItem {
  productId: string;
  productName: string;
  category: string;
  qtySold: number;
  revenue: number;
  cost: number;
  grossProfit: number;
  marginPercent: number;
}

interface ProductPerformanceSummary {
  totalRevenue: number;
  totalProfit: number;
  avgMargin: number;
  topProduct: string;
}

interface ProductPerformanceData {
  summary: ProductPerformanceSummary;
  items: ProductPerformanceItem[];
}

interface InventoryValuationItem {
  productId: string;
  productName: string;
  category: string;
  stockQty: number;
  costPrice: number;
  stockValue: number;
  sellingPrice: number;
  potentialRevenue: number;
}

interface CategoryBreakdown {
  category: string;
  productCount: number;
  totalStockValue: number;
  potentialRevenue: number;
}

interface InventoryValuationSummary {
  totalProducts: number;
  totalStockValue: number;
  potentialRevenue: number;
  avgMargin: number;
}

interface InventoryValuationData {
  summary: InventoryValuationSummary;
  items: InventoryValuationItem[];
  categoryBreakdown: CategoryBreakdown[];
}

interface CustomerInfo {
  id: string;
  name: string;
  nameEn?: string;
  balance: number;
  type: string;
}

interface StatementTransaction {
  date: string;
  type: string;
  reference: string;
  debit: number;
  credit: number;
  balance: number;
}

interface CustomerStatementData {
  customer: CustomerInfo;
  openingBalance: number;
  closingBalance: number;
  transactions: StatementTransaction[];
}

interface PurchaseReportItem {
  supplierId: string;
  supplierName: string;
  purchaseCount: number;
  totalAmount: number;
  tax: number;
  net: number;
}

interface PurchaseReportSummary {
  totalPurchases: number;
  totalTax: number;
  netAmount: number;
  supplierCount: number;
}

interface PurchaseReportData {
  summary: PurchaseReportSummary;
  items: PurchaseReportItem[];
}

interface Category {
  id: string;
  name: string;
}

interface CustomerOption {
  id: string;
  name: string;
}

interface SupplierOption {
  id: string;
  name: string;
}

interface BranchOption {
  id: string;
  name: string;
}

// ============================================================================
// Helper: auth headers
// ============================================================================

function useAuthHeaders() {
  const authToken = useAppStore((s) => s.authToken);
  return { Authorization: `Bearer ${authToken}` };
}

// ============================================================================
// Margin color helper
// ============================================================================

function getMarginColor(margin: number): { bg: string; text: string; badge: string } {
  if (margin >= 30) {
    return {
      bg: 'bg-emerald-50 dark:bg-emerald-950/30',
      text: 'text-emerald-700 dark:text-emerald-400',
      badge: 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-900/40 dark:text-emerald-300 dark:border-emerald-700',
    };
  }
  if (margin >= 15) {
    return {
      bg: 'bg-amber-50 dark:bg-amber-950/30',
      text: 'text-amber-700 dark:text-amber-400',
      badge: 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-700',
    };
  }
  return {
    bg: 'bg-red-50 dark:bg-red-950/30',
    text: 'text-red-700 dark:text-red-400',
    badge: 'bg-red-100 text-red-800 border-red-300 dark:bg-red-900/40 dark:text-red-300 dark:border-red-700',
  };
}

function getMarginLabel(margin: number, t: any): string {
  if (margin >= 30) return t.highMargin || 'هامش مرتفع';
  if (margin >= 15) return t.mediumMargin || 'هامش متوسط';
  return t.lowMargin || 'هامش منخفض';
}

// ============================================================================
// Summary Card Component
// ============================================================================

function SummaryCard({
  icon,
  label,
  value,
  isCurrency = true,
  accent = 'emerald',
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  isCurrency?: boolean;
  accent?: 'emerald' | 'amber' | 'teal';
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
    teal: {
      iconBg: 'bg-teal-100 dark:bg-teal-900/40',
      iconText: 'text-teal-600 dark:text-teal-400',
      border: 'border-teal-200 dark:border-teal-800',
      gradient: 'from-teal-50 to-transparent dark:from-teal-950/30',
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
            <p className={`text-lg font-bold font-mono ${c.iconText} truncate`}>
              {isCurrency ? <CurrencyAmount amount={Number(value)} symbolClassName="w-3 h-3" /> : value}
            </p>
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
// Main Component
// ============================================================================

export default function AdvancedReports() {
  const { t, isRTL } = useTranslation();
  const headers = useAuthHeaders();

  // ---- Shared state ----
  const [activeTab, setActiveTab] = useState('product-performance');
  const [categories, setCategories] = useState<Category[]>([]);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [branches, setBranches] = useState<BranchOption[]>([]);

  // ---- Tab 1: Product Performance ----
  const [ppDateFrom, setPpDateFrom] = useState('');
  const [ppDateTo, setPpDateTo] = useState('');
  const [ppBranch, setPpBranch] = useState('ALL');
  const [ppCategory, setPpCategory] = useState('ALL');
  const [ppSortBy, setPpSortBy] = useState('revenue');
  const [ppData, setPpData] = useState<ProductPerformanceData | null>(null);
  const [ppLoading, setPpLoading] = useState(false);
  const [ppError, setPpError] = useState<string | null>(null);

  // ---- Tab 2: Inventory Valuation ----
  const [ivBranch, setIvBranch] = useState('ALL');
  const [ivCategory, setIvCategory] = useState('ALL');
  const [ivData, setIvData] = useState<InventoryValuationData | null>(null);
  const [ivLoading, setIvLoading] = useState(false);
  const [ivError, setIvError] = useState<string | null>(null);

  // ---- Tab 3: Customer Statement ----
  const [csCustomerId, setCsCustomerId] = useState('');
  const [csDateFrom, setCsDateFrom] = useState('');
  const [csDateTo, setCsDateTo] = useState('');
  const [csData, setCsData] = useState<CustomerStatementData | null>(null);
  const [csLoading, setCsLoading] = useState(false);
  const [csError, setCsError] = useState<string | null>(null);

  // ---- Tab 4: Purchase Report ----
  const [prDateFrom, setPrDateFrom] = useState('');
  const [prDateTo, setPrDateTo] = useState('');
  const [prSupplier, setPrSupplier] = useState('ALL');
  const [prBranch, setPrBranch] = useState('ALL');
  const [prData, setPrData] = useState<PurchaseReportData | null>(null);
  const [prLoading, setPrLoading] = useState(false);
  const [prError, setPrError] = useState<string | null>(null);

  // ---- Tab 5: Supplier Statement ----
  const [ssSupplierId, setSsSupplierId] = useState('');
  const [ssDateFrom, setSsDateFrom] = useState('');
  const [ssDateTo, setSsDateTo] = useState('');
  const [ssData, setSsData] = useState<CustomerStatementData | null>(null);  // Reuse same interface
  const [ssLoading, setSsLoading] = useState(false);
  const [ssError, setSsError] = useState<string | null>(null);

  // ---- Tab 6: Salary Statement ----
  const [salDateFrom, setSalDateFrom] = useState('');
  const [salDateTo, setSalDateTo] = useState('');
  const [salBranch, setSalBranch] = useState('ALL');
  const [salData, setSalData] = useState<any>(null);
  const [salLoading, setSalLoading] = useState(false);
  const [salError, setSalError] = useState<string | null>(null);

  // ---- Fetch filter options ----
  useEffect(() => {
    const fetchFilters = async () => {
      try {
        const [catRes, custRes, supRes, branchRes] = await Promise.all([
          fetch('/api/pos/categories', { headers }),
          fetch('/api/customers', { headers }),
          fetch('/api/suppliers', { headers }),
          fetch('/api/branches', { headers: { ...headers, 'Content-Type': 'application/json' } }),
        ]);
        if (catRes.ok) {
          const catData = await catRes.json();
          setCategories(Array.isArray(catData) ? catData : catData.categories || []);
        }
        if (custRes.ok) {
          const custData = await custRes.json();
          setCustomers(Array.isArray(custData) ? custData : custData.customers || []);
        }
        if (supRes.ok) {
          const supData = await supRes.json();
          setSuppliers(Array.isArray(supData) ? supData : supData.suppliers || []);
        }
        if (branchRes.ok) {
          const branchData = await branchRes.json();
          const rawBranches = Array.isArray(branchData) ? branchData : branchData.branches || [];
          // Map to use branch code as value for API queries
          setBranches(rawBranches.map((b: any) => ({ id: b.code, name: b.nameEn || b.name })));
        }
      } catch {
        // silently fail - filters are optional
      }
    };
    fetchFilters();
  }, []);

  // ---- Fetch: Product Performance ----
  const fetchProductPerformance = useCallback(async () => {
    setPpLoading(true);
    setPpError(null);
    try {
      const params = new URLSearchParams();
      if (ppDateFrom) params.set('dateFrom', ppDateFrom);
      if (ppDateTo) params.set('dateTo', ppDateTo);
      if (ppBranch && ppBranch !== 'ALL') params.set('branch', ppBranch);
      if (ppCategory && ppCategory !== 'ALL') params.set('categoryId', ppCategory);
      if (ppSortBy) params.set('sortBy', ppSortBy);
      const res = await fetch(`/api/reports/product-performance?${params.toString()}`, { headers });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || t.failedToFetchData);
      }
      const json = await res.json();
      // Normalize API response to match frontend expectations
      const normalizedData: ProductPerformanceData = {
        summary: {
          totalRevenue: json.summary?.totalRevenue ?? 0,
          totalProfit: json.summary?.totalProfit ?? 0,
          avgMargin: json.summary?.averageMargin ?? json.summary?.avgMargin ?? 0,
          topProduct: json.top5?.[0]?.name ?? json.products?.[0]?.name ?? '-',
        },
        items: (json.products ?? json.items ?? []).map((p: any) => ({
          productId: p.productId,
          productName: p.name ?? p.productName,
          category: p.category,
          qtySold: p.quantitySold ?? p.qtySold ?? 0,
          revenue: p.totalRevenue ?? p.revenue ?? 0,
          cost: p.totalCost ?? p.cost ?? 0,
          grossProfit: p.grossProfit ?? 0,
          marginPercent: p.profitMargin ?? p.marginPercent ?? 0,
        })),
      };
      setPpData(normalizedData);
    } catch (err: any) {
      setPpError(err.message || t.failedToFetchData);
      toast.error(err.message || t.failedToFetchData);
    } finally {
      setPpLoading(false);
    }
  }, [ppDateFrom, ppDateTo, ppBranch, ppCategory, ppSortBy, t.failedToFetchData]);

  // ---- Fetch: Inventory Valuation ----
  const fetchInventoryValuation = useCallback(async () => {
    setIvLoading(true);
    setIvError(null);
    try {
      const params = new URLSearchParams();
      if (ivBranch && ivBranch !== 'ALL') params.set('branch', ivBranch);
      if (ivCategory && ivCategory !== 'ALL') params.set('categoryId', ivCategory);
      const res = await fetch(`/api/reports/inventory-valuation?${params.toString()}`, { headers });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || t.failedToFetchData);
      }
      const json = await res.json();
      // Normalize API response to match frontend expectations
      const normalizedData: InventoryValuationData = {
        summary: {
          totalProducts: json.summary?.totalProducts ?? 0,
          totalStockValue: json.summary?.totalStockValue ?? 0,
          potentialRevenue: json.summary?.totalPotentialRevenue ?? json.summary?.potentialRevenue ?? 0,
          avgMargin: json.summary?.averageMargin ?? json.summary?.avgMargin ?? 0,
        },
        items: (json.products ?? json.items ?? []).map((p: any) => ({
          productId: p.productId,
          productName: p.name ?? p.productName,
          category: p.category,
          stockQty: p.currentStock ?? p.stockQty ?? 0,
          costPrice: p.costPrice ?? 0,
          stockValue: p.stockValue ?? 0,
          sellingPrice: p.price ?? p.sellingPrice ?? 0,
          potentialRevenue: p.potentialRevenue ?? 0,
        })),
        categoryBreakdown: (json.categoryBreakdown ?? []).map((c: any) => ({
          category: c.categoryName ?? c.category,
          productCount: c.productCount ?? 0,
          totalStockValue: c.totalStockValue ?? 0,
          potentialRevenue: c.totalPotentialRevenue ?? c.potentialRevenue ?? 0,
        })),
      };
      setIvData(normalizedData);
    } catch (err: any) {
      setIvError(err.message || t.failedToFetchData);
      toast.error(err.message || t.failedToFetchData);
    } finally {
      setIvLoading(false);
    }
  }, [ivBranch, ivCategory, t.failedToFetchData]);

  // ---- Fetch: Customer Statement ----
  const fetchCustomerStatement = useCallback(async () => {
    if (!csCustomerId) return;
    setCsLoading(true);
    setCsError(null);
    try {
      const params = new URLSearchParams();
      params.set('customerId', csCustomerId);
      if (csDateFrom) params.set('dateFrom', csDateFrom);
      if (csDateTo) params.set('dateTo', csDateTo);
      const res = await fetch(`/api/reports/customer-statement?${params.toString()}`, { headers });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || t.failedToFetchData);
      }
      const json = await res.json();
      // Normalize API response to match frontend expectations
      const normalizedData: CustomerStatementData = {
        customer: {
          id: json.customer?.id,
          name: json.customer?.name,
          nameEn: json.customer?.nameEn,
          balance: json.customer?.currentBalance ?? json.customer?.balance ?? 0,
          type: json.customer?.type,
        },
        openingBalance: json.openingBalance ?? 0,
        closingBalance: json.closingBalance ?? 0,
        transactions: (json.transactions ?? []).map((tx: any) => ({
          date: tx.date,
          type: tx.type,
          reference: tx.reference,
          debit: tx.debit ?? 0,
          credit: tx.credit ?? 0,
          balance: tx.balance ?? 0,
        })),
      };
      setCsData(normalizedData);
    } catch (err: any) {
      setCsError(err.message || t.failedToFetchData);
      toast.error(err.message || t.failedToFetchData);
    } finally {
      setCsLoading(false);
    }
  }, [csCustomerId, csDateFrom, csDateTo, t.failedToFetchData]);

  // ---- Fetch: Purchase Report ----
  const fetchPurchaseReport = useCallback(async () => {
    setPrLoading(true);
    setPrError(null);
    try {
      const params = new URLSearchParams();
      if (prDateFrom) params.set('dateFrom', prDateFrom);
      if (prDateTo) params.set('dateTo', prDateTo);
      if (prSupplier && prSupplier !== 'ALL') params.set('supplierId', prSupplier);
      if (prBranch && prBranch !== 'ALL') params.set('branch', prBranch);
      const res = await fetch(`/api/reports/purchase-report?${params.toString()}`, { headers });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || t.failedToFetchData);
      }
      const json = await res.json();
      // Normalize API response to match frontend expectations
      const normalizedData: PurchaseReportData = {
        summary: {
          totalPurchases: json.summary?.grandPurchaseAmount ?? json.summary?.totalPurchases ?? 0,
          totalTax: json.summary?.grandTax ?? json.summary?.totalTax ?? 0,
          netAmount: json.summary?.grandNet ?? json.summary?.netAmount ?? 0,
          supplierCount: json.summary?.totalSuppliers ?? json.summary?.supplierCount ?? 0,
        },
        items: (json.bySupplier ?? json.items ?? []).map((s: any) => ({
          supplierId: s.supplierId,
          supplierName: s.supplierName,
          purchaseCount: s.purchaseCount ?? 0,
          totalAmount: s.totalPurchaseAmount ?? s.totalAmount ?? 0,
          tax: s.totalTax ?? s.tax ?? 0,
          net: s.netAmount ?? s.net ?? 0,
        })),
      };
      setPrData(normalizedData);
    } catch (err: any) {
      setPrError(err.message || t.failedToFetchData);
      toast.error(err.message || t.failedToFetchData);
    } finally {
      setPrLoading(false);
    }
  }, [prDateFrom, prDateTo, prSupplier, prBranch, t.failedToFetchData]);

  // ---- Fetch: Supplier Statement ----
  const fetchSupplierStatement = useCallback(async () => {
    if (!ssSupplierId) return;
    setSsLoading(true);
    setSsError(null);
    try {
      const params = new URLSearchParams();
      params.set('supplierId', ssSupplierId);
      if (ssDateFrom) params.set('dateFrom', ssDateFrom);
      if (ssDateTo) params.set('dateTo', ssDateTo);
      const res = await fetch(`/api/reports/supplier-statement?${params.toString()}`, { headers });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || t.failedToFetchData);
      }
      const json = await res.json();
      const normalizedData: CustomerStatementData = {
        customer: {
          id: json.supplier?.id,
          name: json.supplier?.name,
          nameEn: json.supplier?.nameEn,
          balance: json.supplier?.currentBalance ?? json.supplier?.balance ?? 0,
          type: 'supplier',
        },
        openingBalance: json.openingBalance ?? 0,
        closingBalance: json.closingBalance ?? 0,
        transactions: (json.transactions ?? []).map((tx: any) => ({
          date: tx.date,
          type: tx.type,
          reference: tx.reference,
          debit: tx.debit ?? 0,
          credit: tx.credit ?? 0,
          balance: tx.balance ?? 0,
        })),
      };
      setSsData(normalizedData);
    } catch (err: any) {
      setSsError(err.message || t.failedToFetchData);
      toast.error(err.message || t.failedToFetchData);
    } finally {
      setSsLoading(false);
    }
  }, [ssSupplierId, ssDateFrom, ssDateTo, t.failedToFetchData]);

  // ---- Fetch: Salary Statement ----
  const fetchSalaryStatement = useCallback(async () => {
    setSalLoading(true);
    setSalError(null);
    try {
      const params = new URLSearchParams();
      if (salDateFrom) params.set('dateFrom', salDateFrom);
      if (salDateTo) params.set('dateTo', salDateTo);
      if (salBranch && salBranch !== 'ALL') params.set('branch', salBranch);
      const res = await fetch(`/api/reports/salary-statement?${params.toString()}`, { headers });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || t.failedToFetchData);
      }
      const json = await res.json();
      setSalData(json);
    } catch (err: any) {
      setSalError(err.message || t.failedToFetchData);
      toast.error(err.message || t.failedToFetchData);
    } finally {
      setSalLoading(false);
    }
  }, [salDateFrom, salDateTo, salBranch, t.failedToFetchData]);

  // ---- Export helpers ----
  const handleExportProductPerformance = () => {
    if (!ppData) return;
    exportToExcel({
      data: ppData.items.map((item) => ({
        productName: item.productName,
        category: item.category,
        qtySold: item.qtySold,
        revenue: formatNumber(item.revenue),
        cost: formatNumber(item.cost),
        grossProfit: formatNumber(item.grossProfit),
        marginPercent: formatNumber(item.marginPercent, 1) + '%',
      })),
      columns: [
        { key: 'productName', header: t.productName || 'اسم المنتج', width: 25 },
        { key: 'category', header: t.categoryName || 'القسم', width: 18 },
        { key: 'qtySold', header: t.qtySold || 'الكمية المباعة', width: 14 },
        { key: 'revenue', header: t.totalRevenue || 'الإيرادات', width: 15 },
        { key: 'cost', header: t.costPrice || 'التكلفة', width: 15 },
        { key: 'grossProfit', header: t.grossProfit || 'إجمالي الربح', width: 15 },
        { key: 'marginPercent', header: t.marginPercent || 'الهامش %', width: 12 },
      ],
      sheetName: t.productPerformanceTab || 'أداء المنتجات',
      fileName: `product-performance-${new Date().toISOString().slice(0, 10)}.xlsx`,
      title: t.productPerformanceTab || 'أداء المنتجات',
    });
  };

  const handleExportInventoryValuation = () => {
    if (!ivData) return;
    exportToExcel({
      data: ivData.items.map((item) => ({
        productName: item.productName,
        category: item.category,
        stockQty: item.stockQty,
        costPrice: formatNumber(item.costPrice),
        stockValue: formatNumber(item.stockValue),
        sellingPrice: formatNumber(item.sellingPrice),
        potentialRevenue: formatNumber(item.potentialRevenue),
      })),
      columns: [
        { key: 'productName', header: t.productName || 'المنتج', width: 25 },
        { key: 'category', header: t.categoryName || 'القسم', width: 18 },
        { key: 'stockQty', header: t.stockQty || 'كمية المخزون', width: 14 },
        { key: 'costPrice', header: t.costPrice || 'سعر التكلفة', width: 15 },
        { key: 'stockValue', header: t.stockValue || 'قيمة المخزون', width: 15 },
        { key: 'sellingPrice', header: t.sellingPrice || 'سعر البيع', width: 15 },
        { key: 'potentialRevenue', header: t.potentialRevenue || 'الإيرادات المتوقعة', width: 18 },
      ],
      sheetName: t.inventoryValuationTab || 'تقييم المخزون',
      fileName: `inventory-valuation-${new Date().toISOString().slice(0, 10)}.xlsx`,
      title: t.inventoryValuationTab || 'تقييم المخزون',
    });
  };

  const handleExportCustomerStatement = () => {
    if (!csData) return;
    exportToExcel({
      data: csData.transactions.map((tx) => ({
        date: tx.date,
        type: tx.type,
        reference: tx.reference,
        debit: tx.debit ? formatNumber(tx.debit) : '',
        credit: tx.credit ? formatNumber(tx.credit) : '',
        balance: formatNumber(tx.balance),
      })),
      columns: [
        { key: 'date', header: t.date || 'التاريخ', width: 14 },
        { key: 'type', header: t.type || 'النوع', width: 12 },
        { key: 'reference', header: t.reference || 'المرجع', width: 18 },
        { key: 'debit', header: t.debitLabel || 'مدين', width: 15 },
        { key: 'credit', header: t.creditLabel || 'دائن', width: 15 },
        { key: 'balance', header: t.balance || 'الرصيد', width: 15 },
      ],
      sheetName: t.customerStatementTab || 'كشف حساب العميل',
      fileName: `customer-statement-${csData.customer.name}-${new Date().toISOString().slice(0, 10)}.xlsx`,
      title: `${t.customerStatementTab || 'كشف حساب العميل'} - ${csData.customer.name}`,
    });
  };

  const handleExportPurchaseReport = () => {
    if (!prData) return;
    exportToExcel({
      data: prData.items.map((item) => ({
        supplierName: item.supplierName,
        purchaseCount: item.purchaseCount,
        totalAmount: formatNumber(item.totalAmount),
        tax: formatNumber(item.tax),
        net: formatNumber(item.net),
      })),
      columns: [
        { key: 'supplierName', header: t.supplierName || 'المورد', width: 25 },
        { key: 'purchaseCount', header: t.purchaseCount || 'عدد المشتريات', width: 16 },
        { key: 'totalAmount', header: t.totalAmount || 'المبلغ', width: 15 },
        { key: 'tax', header: t.tax || 'الضريبة', width: 15 },
        { key: 'net', header: t.netAmount || 'الصافي', width: 15 },
      ],
      sheetName: t.purchaseReportTab || 'تقرير المشتريات',
      fileName: `purchase-report-${new Date().toISOString().slice(0, 10)}.xlsx`,
      title: t.purchaseReportTab || 'تقرير المشتريات',
    });
  };

  // ---- Filter bar component ----
  const DateRangeFilter = ({
    dateFrom,
    setDateFrom,
    dateTo,
    setDateTo,
  }: {
    dateFrom: string;
    setDateFrom: (v: string) => void;
    dateTo: string;
    setDateTo: (v: string) => void;
  }) => (
    <>
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
    </>
  );

  const BranchFilter = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground">{t.branch || 'الفرع'}</label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ALL">{t.all || 'الكل'}</SelectItem>
          {branches.map((b) => (
            <SelectItem key={b.id} value={b.id}>
              {b.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  const CategoryFilter = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground">{t.categoryName || 'القسم'}</label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ALL">{t.allCategories || 'جميع الأقسام'}</SelectItem>
          {categories.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {c.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

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
                <BarChart3 className="size-5" />
                {t.advancedReports || 'التقارير المتقدمة'}
              </CardTitle>
              <CardDescription>{t.advancedReportsDesc || 'تقارير تحليلية متقدمة لإدارة الأعمال'}</CardDescription>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-3 sm:grid-cols-6">
          <TabsTrigger value="product-performance" className="gap-1.5 text-xs sm:text-sm">
            <TrendingUp className="size-4 hidden sm:block" />
            {t.productPerformanceTab || 'أداء المنتجات'}
          </TabsTrigger>
          <TabsTrigger value="inventory-valuation" className="gap-1.5 text-xs sm:text-sm">
            <Package className="size-4 hidden sm:block" />
            {t.inventoryValuationTab || 'تقييم المخزون'}
          </TabsTrigger>
          <TabsTrigger value="customer-statement" className="gap-1.5 text-xs sm:text-sm">
            <Users className="size-4 hidden sm:block" />
            {t.customerStatementTab || 'كشف حساب العميل'}
          </TabsTrigger>
          <TabsTrigger value="purchase-report" className="gap-1.5 text-xs sm:text-sm">
            <Truck className="size-4 hidden sm:block" />
            {t.purchaseReportTab || 'تقرير المشتريات'}
          </TabsTrigger>
          <TabsTrigger value="supplier-statement" className="gap-1.5 text-xs sm:text-sm">
            <Wallet className="size-4 hidden sm:block" />
            {t.supplierStatementTab || 'كشف حساب المورد'}
          </TabsTrigger>
          <TabsTrigger value="salary-statement" className="gap-1.5 text-xs sm:text-sm">
            <Receipt className="size-4 hidden sm:block" />
            {t.salaryStatementTab || 'كشف الرواتب'}
          </TabsTrigger>
        </TabsList>

        {/* ======================================================================
            TAB 1: Product Performance
        ====================================================================== */}
        <TabsContent value="product-performance" className="space-y-4">
          {/* Filters */}
          <Card>
            <CardContent className="p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="flex-1 grid grid-cols-2 sm:grid-cols-5 gap-3">
                  <DateRangeFilter dateFrom={ppDateFrom} setDateFrom={setPpDateFrom} dateTo={ppDateTo} setDateTo={setPpDateTo} />
                  <BranchFilter value={ppBranch} onChange={setPpBranch} />
                  <CategoryFilter value={ppCategory} onChange={setPpCategory} />
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                      <ArrowUpDown className="size-3" />
                      {t.sortBy || 'ترتيب حسب'}
                    </label>
                    <Select value={ppSortBy} onValueChange={setPpSortBy}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="revenue">{t.sortByRevenue || 'الإيرادات'}</SelectItem>
                        <SelectItem value="profit">{t.sortByProfit || 'الربح'}</SelectItem>
                        <SelectItem value="margin">{t.sortByMargin || 'الهامش'}</SelectItem>
                        <SelectItem value="qtySold">{t.sortByQtySold || 'الكمية المباعة'}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button onClick={fetchProductPerformance} disabled={ppLoading} size="sm" className="gap-1.5">
                    {ppLoading ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
                    {t.show || 'عرض'}
                  </Button>
                  <Button onClick={handleExportProductPerformance} disabled={!ppData || ppLoading} variant="outline" size="sm" className="gap-1.5">
                    <Download className="size-4" />
                    <span className="hidden sm:inline">{t.exportExcel || 'تصدير Excel'}</span>
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Error */}
          {ppError && (
            <Card className="border-destructive/50">
              <CardContent className="p-4">
                <div className="flex items-center gap-3 text-destructive">
                  <AlertTriangle className="size-5" />
                  <p className="text-sm font-medium">{ppError}</p>
                </div>
                <Button onClick={fetchProductPerformance} variant="outline" className="mt-3" size="sm">
                  {t.retry || 'إعادة المحاولة'}
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Loading */}
          {ppLoading && (
            <div className="space-y-4">
              <div className="grid gap-4 grid-cols-2 sm:grid-cols-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Card key={i}><CardContent className="p-4"><Skeleton className="h-16 w-full" /></CardContent></Card>
                ))}
              </div>
              <Card><CardContent className="p-4"><Skeleton className="h-64 w-full" /></CardContent></Card>
            </div>
          )}

          {/* Data */}
          {ppData && !ppLoading && !ppError && (
            <>
              {/* Summary Cards */}
              <div className="grid gap-4 grid-cols-2 sm:grid-cols-4">
                <SummaryCard
                  icon={<TrendingUp className="size-5" />}
                  label={t.totalRevenue || 'إجمالي الإيرادات'}
                  value={ppData.summary.totalRevenue}
                  accent="emerald"
                />
                <SummaryCard
                  icon={<TrendingUp className="size-5" />}
                  label={t.totalProfit || 'إجمالي الأرباح'}
                  value={ppData.summary.totalProfit}
                  accent="emerald"
                />
                <SummaryCard
                  icon={<BarChart3 className="size-5" />}
                  label={t.avgMargin || 'متوسط الهامش'}
                  value={`${formatNumber(ppData.summary.avgMargin, 1)}%`}
                  isCurrency={false}
                  accent="amber"
                />
                <SummaryCard
                  icon={<Package className="size-5" />}
                  label={t.topProduct || 'أفضل منتج'}
                  value={ppData.summary.topProduct}
                  isCurrency={false}
                  accent="teal"
                />
              </div>

              {/* Table */}
              {ppData.items.length === 0 ? (
                <EmptyState
                  icon={<BarChart3 className="size-8 text-muted-foreground" />}
                  title={t.noReportData || 'لا توجد بيانات للتقرير'}
                  description={t.noReportDataDesc || 'قم بتعديل الفلاتر أو تأكد من وجود بيانات'}
                />
              ) : (
                <Card>
                  <CardContent className="p-0">
                    <div className="max-h-[60vh] overflow-y-auto">
                      <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-muted/95 backdrop-blur z-10">
                          <tr className="border-b">
                            <th className="text-right py-3 px-3 font-medium text-muted-foreground">{t.productName || 'المنتج'}</th>
                            <th className="text-right py-3 px-3 font-medium text-muted-foreground">{t.categoryName || 'القسم'}</th>
                            <th className="text-center py-3 px-3 font-medium text-muted-foreground">{t.qtySold || 'الكمية المباعة'}</th>
                            <th className="text-left py-3 px-3 font-medium text-muted-foreground">{t.totalRevenue || 'الإيرادات'}</th>
                            <th className="text-left py-3 px-3 font-medium text-muted-foreground">{t.costPrice || 'التكلفة'}</th>
                            <th className="text-left py-3 px-3 font-medium text-muted-foreground">{t.grossProfit || 'إجمالي الربح'}</th>
                            <th className="text-center py-3 px-3 font-medium text-muted-foreground">{t.marginPercent || 'الهامش %'}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {ppData.items.map((item) => {
                            const mc = getMarginColor(item.marginPercent);
                            return (
                              <tr key={item.productId} className={`border-b border-border/50 hover:bg-muted/30 ${mc.bg}`}>
                                <td className="py-2.5 px-3 font-medium">{item.productName}</td>
                                <td className="py-2.5 px-3 text-muted-foreground">{item.category}</td>
                                <td className="py-2.5 px-3 text-center font-mono" dir="ltr">{formatNumber(item.qtySold, 0)}</td>
                                <td className="py-2.5 px-3 text-left font-mono" dir="ltr"><CurrencyAmount amount={item.revenue} symbolClassName="w-3 h-3" /></td>
                                <td className="py-2.5 px-3 text-left font-mono" dir="ltr"><CurrencyAmount amount={item.cost} symbolClassName="w-3 h-3" /></td>
                                <td className={`py-2.5 px-3 text-left font-mono font-semibold ${item.grossProfit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`} dir="ltr">
                                  <CurrencyAmount amount={item.grossProfit} symbolClassName="w-3 h-3" />
                                </td>
                                <td className="py-2.5 px-3 text-center">
                                  <Badge variant="outline" className={`${mc.badge} text-xs`}>
                                    {formatNumber(item.marginPercent, 1)}%
                                  </Badge>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </TabsContent>

        {/* ======================================================================
            TAB 2: Inventory Valuation
        ====================================================================== */}
        <TabsContent value="inventory-valuation" className="space-y-4">
          {/* Filters */}
          <Card>
            <CardContent className="p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="flex-1 grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <BranchFilter value={ivBranch} onChange={setIvBranch} />
                  <CategoryFilter value={ivCategory} onChange={setIvCategory} />
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button onClick={fetchInventoryValuation} disabled={ivLoading} size="sm" className="gap-1.5">
                    {ivLoading ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
                    {t.show || 'عرض'}
                  </Button>
                  <Button onClick={handleExportInventoryValuation} disabled={!ivData || ivLoading} variant="outline" size="sm" className="gap-1.5">
                    <Download className="size-4" />
                    <span className="hidden sm:inline">{t.exportExcel || 'تصدير Excel'}</span>
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Error */}
          {ivError && (
            <Card className="border-destructive/50">
              <CardContent className="p-4">
                <div className="flex items-center gap-3 text-destructive">
                  <AlertTriangle className="size-5" />
                  <p className="text-sm font-medium">{ivError}</p>
                </div>
                <Button onClick={fetchInventoryValuation} variant="outline" className="mt-3" size="sm">
                  {t.retry || 'إعادة المحاولة'}
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Loading */}
          {ivLoading && (
            <div className="space-y-4">
              <div className="grid gap-4 grid-cols-2 sm:grid-cols-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Card key={i}><CardContent className="p-4"><Skeleton className="h-16 w-full" /></CardContent></Card>
                ))}
              </div>
              <Card><CardContent className="p-4"><Skeleton className="h-64 w-full" /></CardContent></Card>
            </div>
          )}

          {/* Data */}
          {ivData && !ivLoading && !ivError && (
            <>
              {/* Summary Cards */}
              <div className="grid gap-4 grid-cols-2 sm:grid-cols-4">
                <SummaryCard
                  icon={<Package className="size-5" />}
                  label={t.totalProducts || 'إجمالي المنتجات'}
                  value={ivData.summary.totalProducts}
                  isCurrency={false}
                  accent="teal"
                />
                <SummaryCard
                  icon={<TrendingUp className="size-5" />}
                  label={t.totalStockValue || 'إجمالي قيمة المخزون'}
                  value={ivData.summary.totalStockValue}
                  accent="emerald"
                />
                <SummaryCard
                  icon={<TrendingUp className="size-5" />}
                  label={t.potentialRevenue || 'الإيرادات المتوقعة'}
                  value={ivData.summary.potentialRevenue}
                  accent="amber"
                />
                <SummaryCard
                  icon={<BarChart3 className="size-5" />}
                  label={t.avgMargin || 'متوسط الهامش'}
                  value={`${formatNumber(ivData.summary.avgMargin, 1)}%`}
                  isCurrency={false}
                  accent="teal"
                />
              </div>

              {/* Table */}
              {ivData.items.length === 0 ? (
                <EmptyState
                  icon={<Package className="size-8 text-muted-foreground" />}
                  title={t.noReportData || 'لا توجد بيانات للتقرير'}
                  description={t.noReportDataDesc || 'قم بتعديل الفلاتر أو تأكد من وجود بيانات'}
                />
              ) : (
                <Card>
                  <CardContent className="p-0">
                    <div className="max-h-[60vh] overflow-y-auto">
                      <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-muted/95 backdrop-blur z-10">
                          <tr className="border-b">
                            <th className="text-right py-3 px-3 font-medium text-muted-foreground">{t.productName || 'المنتج'}</th>
                            <th className="text-right py-3 px-3 font-medium text-muted-foreground">{t.categoryName || 'القسم'}</th>
                            <th className="text-center py-3 px-3 font-medium text-muted-foreground">{t.stockQty || 'كمية المخزون'}</th>
                            <th className="text-left py-3 px-3 font-medium text-muted-foreground">{t.costPrice || 'سعر التكلفة'}</th>
                            <th className="text-left py-3 px-3 font-medium text-muted-foreground">{t.stockValue || 'قيمة المخزون'}</th>
                            <th className="text-left py-3 px-3 font-medium text-muted-foreground">{t.sellingPrice || 'سعر البيع'}</th>
                            <th className="text-left py-3 px-3 font-medium text-muted-foreground">{t.potentialRevenue || 'الإيرادات المتوقعة'}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {ivData.items.map((item) => (
                            <tr key={item.productId} className="border-b border-border/50 hover:bg-muted/30">
                              <td className="py-2.5 px-3 font-medium">{item.productName}</td>
                              <td className="py-2.5 px-3 text-muted-foreground">{item.category}</td>
                              <td className="py-2.5 px-3 text-center font-mono" dir="ltr">{formatNumber(item.stockQty, 0)}</td>
                              <td className="py-2.5 px-3 text-left font-mono" dir="ltr"><CurrencyAmount amount={item.costPrice} symbolClassName="w-3 h-3" /></td>
                              <td className="py-2.5 px-3 text-left font-mono font-semibold" dir="ltr"><CurrencyAmount amount={item.stockValue} symbolClassName="w-3 h-3" /></td>
                              <td className="py-2.5 px-3 text-left font-mono" dir="ltr"><CurrencyAmount amount={item.sellingPrice} symbolClassName="w-3 h-3" /></td>
                              <td className="py-2.5 px-3 text-left font-mono text-emerald-600 dark:text-emerald-400" dir="ltr"><CurrencyAmount amount={item.potentialRevenue} symbolClassName="w-3 h-3" /></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Category Breakdown */}
              {ivData.categoryBreakdown && ivData.categoryBreakdown.length > 0 && (
                <Card className="border-emerald-200 dark:border-emerald-800">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm text-emerald-700 dark:text-emerald-400 flex items-center gap-2">
                      <BarChart3 className="size-4" />
                      {t.categoryBreakdown || 'تفصيل حسب القسم'}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {ivData.categoryBreakdown.map((cat) => (
                        <div key={cat.category} className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
                          <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-full bg-emerald-500" />
                            <span className="text-sm font-medium">{cat.category}</span>
                            <Badge variant="outline" className="text-xs">{cat.productCount} {t.products || 'منتج'}</Badge>
                          </div>
                          <div className="flex items-center gap-4">
                            <div className="text-right">
                              <p className="text-xs text-muted-foreground">{t.stockValue || 'قيمة المخزون'}</p>
                              <p className="text-sm font-mono font-semibold"><CurrencyAmount amount={cat.totalStockValue} symbolClassName="w-3 h-3" /></p>
                            </div>
                            <div className="text-right">
                              <p className="text-xs text-muted-foreground">{t.potentialRevenue || 'الإيرادات المتوقعة'}</p>
                              <p className="text-sm font-mono text-emerald-600 dark:text-emerald-400"><CurrencyAmount amount={cat.potentialRevenue} symbolClassName="w-3 h-3" /></p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </TabsContent>

        {/* ======================================================================
            TAB 3: Customer Statement
        ====================================================================== */}
        <TabsContent value="customer-statement" className="space-y-4">
          {/* Filters */}
          <Card>
            <CardContent className="p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="flex-1 grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <div className="space-y-1.5 col-span-2 sm:col-span-1">
                    <label className="text-xs font-medium text-muted-foreground">{t.selectCustomer || 'اختر العميل'}</label>
                    <Select value={csCustomerId} onValueChange={setCsCustomerId}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder={t.selectCustomer || 'اختر العميل'} />
                      </SelectTrigger>
                      <SelectContent>
                        {customers.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <DateRangeFilter dateFrom={csDateFrom} setDateFrom={setCsDateFrom} dateTo={csDateTo} setDateTo={setCsDateTo} />
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button onClick={fetchCustomerStatement} disabled={csLoading || !csCustomerId} size="sm" className="gap-1.5">
                    {csLoading ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
                    {t.show || 'عرض'}
                  </Button>
                  <Button onClick={handleExportCustomerStatement} disabled={!csData || csLoading} variant="outline" size="sm" className="gap-1.5">
                    <Download className="size-4" />
                    <span className="hidden sm:inline">{t.exportExcel || 'تصدير Excel'}</span>
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Error */}
          {csError && (
            <Card className="border-destructive/50">
              <CardContent className="p-4">
                <div className="flex items-center gap-3 text-destructive">
                  <AlertTriangle className="size-5" />
                  <p className="text-sm font-medium">{csError}</p>
                </div>
                <Button onClick={fetchCustomerStatement} variant="outline" className="mt-3" size="sm">
                  {t.retry || 'إعادة المحاولة'}
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Loading */}
          {csLoading && (
            <div className="space-y-4">
              <Card><CardContent className="p-4"><Skeleton className="h-24 w-full" /></CardContent></Card>
              <Card><CardContent className="p-4"><Skeleton className="h-64 w-full" /></CardContent></Card>
            </div>
          )}

          {/* No customer selected */}
          {!csCustomerId && !csLoading && !csError && (
            <EmptyState
              icon={<Users className="size-8 text-muted-foreground" />}
              title={t.selectCustomerStatement || 'اختر العميل لعرض كشف الحساب'}
              description={t.noReportDataDesc || 'قم بتعديل الفلاتر أو تأكد من وجود بيانات'}
            />
          )}

          {/* Data */}
          {csData && !csLoading && !csError && (
            <>
              {/* Customer Info Card */}
              <Card className="border-emerald-200 dark:border-emerald-800 bg-gradient-to-bl from-emerald-50 to-transparent dark:from-emerald-950/30">
                <CardContent className="p-4">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 rounded-xl bg-emerald-100 dark:bg-emerald-900/40">
                        <Users className="size-5 text-emerald-600 dark:text-emerald-400" />
                      </div>
                      <div>
                        <p className="font-semibold text-emerald-700 dark:text-emerald-400">{csData.customer.name}</p>
                        <p className="text-xs text-muted-foreground">{csData.customer.type}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-center">
                        <p className="text-xs text-muted-foreground">{t.customerBalance || 'الرصيد'}</p>
                        <p className="text-lg font-bold font-mono text-emerald-700 dark:text-emerald-400">
                          <CurrencyAmount amount={csData.customer.balance} symbolClassName="w-3.5 h-3.5" />
                        </p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Opening/Closing Balance */}
              <div className="grid gap-4 grid-cols-2">
                <Card className="border-amber-200 dark:border-amber-800">
                  <CardContent className="p-4 text-center">
                    <p className="text-xs text-muted-foreground">{t.openingBalanceLabel || 'الرصيد الافتتاحي'}</p>
                    <p className="text-lg font-bold font-mono text-amber-700 dark:text-amber-400">
                      <CurrencyAmount amount={csData.openingBalance} symbolClassName="w-3.5 h-3.5" />
                    </p>
                  </CardContent>
                </Card>
                <Card className="border-emerald-200 dark:border-emerald-800">
                  <CardContent className="p-4 text-center">
                    <p className="text-xs text-muted-foreground">{t.closingBalanceLabel || 'الرصيد الختامي'}</p>
                    <p className="text-lg font-bold font-mono text-emerald-700 dark:text-emerald-400">
                      <CurrencyAmount amount={csData.closingBalance} symbolClassName="w-3.5 h-3.5" />
                    </p>
                  </CardContent>
                </Card>
              </div>

              {/* Transaction Table */}
              {csData.transactions.length === 0 ? (
                <EmptyState
                  icon={<Users className="size-8 text-muted-foreground" />}
                  title={t.noReportData || 'لا توجد بيانات للتقرير'}
                  description={t.noReportDataDesc || 'قم بتعديل الفلاتر أو تأكد من وجود بيانات'}
                />
              ) : (
                <Card>
                  <CardContent className="p-0">
                    <div className="max-h-[60vh] overflow-y-auto">
                      <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-muted/95 backdrop-blur z-10">
                          <tr className="border-b">
                            <th className="text-right py-3 px-3 font-medium text-muted-foreground">{t.date || 'التاريخ'}</th>
                            <th className="text-center py-3 px-3 font-medium text-muted-foreground">{t.type || 'النوع'}</th>
                            <th className="text-right py-3 px-3 font-medium text-muted-foreground">{t.reference || 'المرجع'}</th>
                            <th className="text-left py-3 px-3 font-medium text-muted-foreground">{t.debitLabel || 'مدين'}</th>
                            <th className="text-left py-3 px-3 font-medium text-muted-foreground">{t.creditLabel || 'دائن'}</th>
                            <th className="text-left py-3 px-3 font-medium text-muted-foreground">{t.balance || 'الرصيد'}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {csData.transactions.map((tx) => {
                            const typeLabel = tx.type === 'SALE'
                              ? (t.transactionTypeSale || 'بيع')
                              : tx.type === 'RETURN'
                              ? (t.transactionTypeReturn || 'مرتجع')
                              : (t.transactionTypeCollection || 'تحصيل');
                            const typeColor = tx.type === 'SALE'
                              ? 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-900/40 dark:text-emerald-300 dark:border-emerald-700'
                              : tx.type === 'RETURN'
                              ? 'bg-red-100 text-red-800 border-red-300 dark:bg-red-900/40 dark:text-red-300 dark:border-red-700'
                              : 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-700';
                            return (
                              <tr key={tx.reference || `${tx.date}-${tx.type}`} className="border-b border-border/50 hover:bg-muted/30">
                                <td className="py-2.5 px-3" dir="ltr">{tx.date}</td>
                                <td className="py-2.5 px-3 text-center">
                                  <Badge variant="outline" className={`text-xs ${typeColor}`}>{typeLabel}</Badge>
                                </td>
                                <td className="py-2.5 px-3 font-mono text-xs">{tx.reference}</td>
                                <td className="py-2.5 px-3 text-left font-mono" dir="ltr">
                                  {tx.debit > 0 ? <CurrencyAmount amount={tx.debit} symbolClassName="w-3 h-3" /> : <span className="text-muted-foreground">—</span>}
                                </td>
                                <td className="py-2.5 px-3 text-left font-mono" dir="ltr">
                                  {tx.credit > 0 ? <CurrencyAmount amount={tx.credit} symbolClassName="w-3 h-3" /> : <span className="text-muted-foreground">—</span>}
                                </td>
                                <td className="py-2.5 px-3 text-left font-mono font-semibold" dir="ltr">
                                  <CurrencyAmount amount={tx.balance} symbolClassName="w-3 h-3" />
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </TabsContent>

        {/* ======================================================================
            TAB 4: Purchase Report
        ====================================================================== */}
        <TabsContent value="purchase-report" className="space-y-4">
          {/* Filters */}
          <Card>
            <CardContent className="p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <DateRangeFilter dateFrom={prDateFrom} setDateFrom={setPrDateFrom} dateTo={prDateTo} setDateTo={setPrDateTo} />
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">{t.selectSupplier || 'اختر المورد'}</label>
                    <Select value={prSupplier} onValueChange={setPrSupplier}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ALL">{t.all || 'الكل'}</SelectItem>
                        {suppliers.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <BranchFilter value={prBranch} onChange={setPrBranch} />
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button onClick={fetchPurchaseReport} disabled={prLoading} size="sm" className="gap-1.5">
                    {prLoading ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
                    {t.show || 'عرض'}
                  </Button>
                  <Button onClick={handleExportPurchaseReport} disabled={!prData || prLoading} variant="outline" size="sm" className="gap-1.5">
                    <Download className="size-4" />
                    <span className="hidden sm:inline">{t.exportExcel || 'تصدير Excel'}</span>
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Error */}
          {prError && (
            <Card className="border-destructive/50">
              <CardContent className="p-4">
                <div className="flex items-center gap-3 text-destructive">
                  <AlertTriangle className="size-5" />
                  <p className="text-sm font-medium">{prError}</p>
                </div>
                <Button onClick={fetchPurchaseReport} variant="outline" className="mt-3" size="sm">
                  {t.retry || 'إعادة المحاولة'}
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Loading */}
          {prLoading && (
            <div className="space-y-4">
              <div className="grid gap-4 grid-cols-2 sm:grid-cols-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Card key={i}><CardContent className="p-4"><Skeleton className="h-16 w-full" /></CardContent></Card>
                ))}
              </div>
              <Card><CardContent className="p-4"><Skeleton className="h-64 w-full" /></CardContent></Card>
            </div>
          )}

          {/* Data */}
          {prData && !prLoading && !prError && (
            <>
              {/* Summary Cards */}
              <div className="grid gap-4 grid-cols-2 sm:grid-cols-4">
                <SummaryCard
                  icon={<Truck className="size-5" />}
                  label={t.totalPurchases || 'إجمالي المشتريات'}
                  value={prData.summary.totalPurchases}
                  accent="emerald"
                />
                <SummaryCard
                  icon={<BarChart3 className="size-5" />}
                  label={t.totalTax || 'إجمالي الضريبة'}
                  value={prData.summary.totalTax}
                  accent="amber"
                />
                <SummaryCard
                  icon={<TrendingUp className="size-5" />}
                  label={t.netAmount || 'الصافي'}
                  value={prData.summary.netAmount}
                  accent="teal"
                />
                <SummaryCard
                  icon={<Users className="size-5" />}
                  label={t.supplierCount || 'عدد الموردين'}
                  value={prData.summary.supplierCount}
                  isCurrency={false}
                  accent="amber"
                />
              </div>

              {/* Table */}
              {prData.items.length === 0 ? (
                <EmptyState
                  icon={<Truck className="size-8 text-muted-foreground" />}
                  title={t.noReportData || 'لا توجد بيانات للتقرير'}
                  description={t.noReportDataDesc || 'قم بتعديل الفلاتر أو تأكد من وجود بيانات'}
                />
              ) : (
                <Card>
                  <CardContent className="p-0">
                    <div className="max-h-[60vh] overflow-y-auto">
                      <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-muted/95 backdrop-blur z-10">
                          <tr className="border-b">
                            <th className="text-right py-3 px-3 font-medium text-muted-foreground">{t.supplierName || 'المورد'}</th>
                            <th className="text-center py-3 px-3 font-medium text-muted-foreground">{t.purchaseCount || 'عدد المشتريات'}</th>
                            <th className="text-left py-3 px-3 font-medium text-muted-foreground">{t.totalAmount || 'المبلغ'}</th>
                            <th className="text-left py-3 px-3 font-medium text-muted-foreground">{t.tax || 'الضريبة'}</th>
                            <th className="text-left py-3 px-3 font-medium text-muted-foreground">{t.netAmount || 'الصافي'}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {prData.items.map((item) => (
                            <tr key={item.supplierId || item.supplierName} className="border-b border-border/50 hover:bg-muted/30">
                              <td className="py-2.5 px-3 font-medium">{item.supplierName}</td>
                              <td className="py-2.5 px-3 text-center font-mono" dir="ltr">{item.purchaseCount}</td>
                              <td className="py-2.5 px-3 text-left font-mono" dir="ltr"><CurrencyAmount amount={item.totalAmount} symbolClassName="w-3 h-3" /></td>
                              <td className="py-2.5 px-3 text-left font-mono" dir="ltr"><CurrencyAmount amount={item.tax} symbolClassName="w-3 h-3" /></td>
                              <td className="py-2.5 px-3 text-left font-mono font-semibold" dir="ltr"><CurrencyAmount amount={item.net} symbolClassName="w-3 h-3" /></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </TabsContent>

        {/* ======================================================================
            TAB 5: Supplier Statement (كشف حساب المورد)
        ====================================================================== */}
        <TabsContent value="supplier-statement" className="space-y-4">
          {/* Filters */}
          <Card>
            <CardContent className="p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="flex-1 grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">{t.supplierName || 'المورد'}</label>
                    <Select value={ssSupplierId} onValueChange={setSsSupplierId}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder={t.selectSupplier || 'اختر المورد'} />
                      </SelectTrigger>
                      <SelectContent>
                        {suppliers.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <DateRangeFilter dateFrom={ssDateFrom} setDateFrom={setSsDateFrom} dateTo={ssDateTo} setDateTo={setSsDateTo} />
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button onClick={fetchSupplierStatement} disabled={ssLoading || !ssSupplierId} size="sm" className="gap-1.5">
                    {ssLoading ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
                    {t.show || 'عرض'}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {ssError && (
            <Card className="border-destructive/50">
              <CardContent className="p-4">
                <div className="flex items-center gap-3 text-destructive">
                  <AlertTriangle className="size-5" />
                  <p className="text-sm font-medium">{ssError}</p>
                </div>
              </CardContent>
            </Card>
          )}

          {ssLoading && (
            <div className="space-y-4">
              <div className="grid gap-4 grid-cols-2 sm:grid-cols-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Card key={i}><CardContent className="p-4"><Skeleton className="h-16 w-full" /></CardContent></Card>
                ))}
              </div>
              <Card><CardContent className="p-4"><Skeleton className="h-64 w-full" /></CardContent></Card>
            </div>
          )}

          {ssData && !ssLoading && !ssError && (
            <>
              {/* Supplier Info */}
              <Card>
                <CardContent className="p-4">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div>
                      <p className="font-semibold text-emerald-700 dark:text-emerald-400">{ssData.customer.name}</p>
                      <p className="text-xs text-muted-foreground">{t.supplier || 'مورد'}</p>
                    </div>
                    <div className="flex gap-6 text-sm">
                      <div className="text-center">
                        <p className="text-xs text-muted-foreground">{t.currentBalance || 'الرصيد الحالي'}</p>
                        <p className="font-semibold"><CurrencyAmount amount={ssData.customer.balance} symbolClassName="w-3.5 h-3.5" /></p>
                      </div>
                      <div className="text-center">
                        <p className="text-xs text-muted-foreground">{t.openingBalance || 'رصيد افتتاحي'}</p>
                        <p className="font-semibold"><CurrencyAmount amount={ssData.openingBalance} symbolClassName="w-3.5 h-3.5" /></p>
                      </div>
                      <div className="text-center">
                        <p className="text-xs text-muted-foreground">{t.closingBalance || 'رصيد إغلاق'}</p>
                        <p className="font-semibold"><CurrencyAmount amount={ssData.closingBalance} symbolClassName="w-3.5 h-3.5" /></p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Transactions Table */}
              {ssData.transactions.length === 0 ? (
                <EmptyState
                  icon={<Wallet className="size-8 text-muted-foreground" />}
                  title={t.noReportData || 'لا توجد بيانات للتقرير'}
                  description={t.noReportDataDesc || 'قم بتعديل الفلاتر أو تأكد من وجود بيانات'}
                />
              ) : (
                <Card>
                  <CardContent className="p-0">
                    <div className="max-h-[60vh] overflow-y-auto">
                      <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-muted/95 backdrop-blur z-10">
                          <tr className="border-b">
                            <th className="text-right py-3 px-3 font-medium text-muted-foreground">{t.date || 'التاريخ'}</th>
                            <th className="text-right py-3 px-3 font-medium text-muted-foreground">{t.type || 'النوع'}</th>
                            <th className="text-right py-3 px-3 font-medium text-muted-foreground">{t.reference || 'المرجع'}</th>
                            <th className="text-left py-3 px-3 font-medium text-muted-foreground">{t.debitLabel || 'مدين'}</th>
                            <th className="text-left py-3 px-3 font-medium text-muted-foreground">{t.creditLabel || 'دائن'}</th>
                            <th className="text-left py-3 px-3 font-medium text-muted-foreground">{t.balance || 'الرصيد'}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {ssData.transactions.map((tx) => {
                            const typeLabel = tx.type === 'PURCHASE' ? (t.purchase || 'مشتريات') : tx.type === 'PURCHASE_RETURN' ? (t.purchaseReturn || 'مرتجع مشتريات') : (t.payment || 'سداد');
                            return (
                              <tr key={tx.reference || `${tx.date}-${tx.type}`} className="border-b border-border/50 hover:bg-muted/30">
                                <td className="py-2.5 px-3 text-xs">{new Date(tx.date).toLocaleDateString('ar-SA-u-nu-latn')}</td>
                                <td className="py-2.5 px-3"><Badge variant="outline" className="text-xs">{typeLabel}</Badge></td>
                                <td className="py-2.5 px-3 text-xs font-mono">{tx.reference}</td>
                                <td className="py-2.5 px-3 text-left font-mono" dir="ltr">{tx.debit > 0 ? <CurrencyAmount amount={tx.debit} symbolClassName="w-3 h-3" /> : '-'}</td>
                                <td className="py-2.5 px-3 text-left font-mono" dir="ltr">{tx.credit > 0 ? <CurrencyAmount amount={tx.credit} symbolClassName="w-3 h-3" /> : '-'}</td>
                                <td className={`py-2.5 px-3 text-left font-mono font-semibold ${tx.balance >= 0 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`} dir="ltr"><CurrencyAmount amount={tx.balance} symbolClassName="w-3 h-3" /></td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </TabsContent>

        {/* ======================================================================
            TAB 6: Salary Statement (كشف الرواتب)
        ====================================================================== */}
        <TabsContent value="salary-statement" className="space-y-4">
          {/* Filters */}
          <Card>
            <CardContent className="p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="flex-1 grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <DateRangeFilter dateFrom={salDateFrom} setDateFrom={setSalDateFrom} dateTo={salDateTo} setDateTo={setSalDateTo} />
                  <BranchFilter value={salBranch} onChange={setSalBranch} />
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button onClick={fetchSalaryStatement} disabled={salLoading} size="sm" className="gap-1.5">
                    {salLoading ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
                    {t.show || 'عرض'}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {salError && (
            <Card className="border-destructive/50">
              <CardContent className="p-4">
                <div className="flex items-center gap-3 text-destructive">
                  <AlertTriangle className="size-5" />
                  <p className="text-sm font-medium">{salError}</p>
                </div>
              </CardContent>
            </Card>
          )}

          {salLoading && (
            <div className="space-y-4">
              <div className="grid gap-4 grid-cols-2 sm:grid-cols-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Card key={i}><CardContent className="p-4"><Skeleton className="h-16 w-full" /></CardContent></Card>
                ))}
              </div>
              <Card><CardContent className="p-4"><Skeleton className="h-64 w-full" /></CardContent></Card>
            </div>
          )}

          {salData && !salLoading && !salError && (
            <>
              {/* Summary Cards */}
              <div className="grid gap-4 grid-cols-2 sm:grid-cols-4">
                <SummaryCard
                  icon={<Receipt className="size-5" />}
                  label={t.totalSalaries || 'إجمالي الرواتب'}
                  value={salData.summary?.totalSalaries ?? 0}
                  accent="teal"
                />
                <SummaryCard
                  icon={<TrendingUp className="size-5" />}
                  label={t.totalTax || 'إجمالي الضريبة'}
                  value={salData.summary?.totalTax ?? 0}
                  accent="amber"
                />
                <SummaryCard
                  icon={<TrendingDown className="size-5" />}
                  label={t.totalDeductions || 'إجمالي الخصومات'}
                  value={salData.summary?.totalDeductions ?? 0}
                  accent="amber"
                />
                <SummaryCard
                  icon={<Receipt className="size-5" />}
                  label={t.netSalaries || 'صافي الرواتب'}
                  value={salData.summary?.netSalaries ?? 0}
                  accent="emerald"
                />
              </div>

              {/* Transactions Table */}
              {(!salData.transactions || salData.transactions.length === 0) ? (
                <EmptyState
                  icon={<Receipt className="size-8 text-muted-foreground" />}
                  title={t.noReportData || 'لا توجد بيانات للتقرير'}
                  description={t.noReportDataDesc || 'قم بتعديل الفلاتر أو تأكد من وجود بيانات'}
                />
              ) : (
                <Card>
                  <CardContent className="p-0">
                    <div className="max-h-[60vh] overflow-y-auto">
                      <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-muted/95 backdrop-blur z-10">
                          <tr className="border-b">
                            <th className="text-right py-3 px-3 font-medium text-muted-foreground">{t.date || 'التاريخ'}</th>
                            <th className="text-right py-3 px-3 font-medium text-muted-foreground">{t.reference || 'المرجع'}</th>
                            <th className="text-right py-3 px-3 font-medium text-muted-foreground">{t.description || 'البيان'}</th>
                            <th className="text-left py-3 px-3 font-medium text-muted-foreground">{t.amount || 'المبلغ'}</th>
                            <th className="text-left py-3 px-3 font-medium text-muted-foreground">{t.tax || 'الضريبة'}</th>
                            <th className="text-left py-3 px-3 font-medium text-muted-foreground">{t.net || 'الصافي'}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {salData.transactions.map((tx: any, idx: number) => (
                            <tr key={idx} className="border-b border-border/50 hover:bg-muted/30">
                              <td className="py-2.5 px-3 text-xs">{new Date(tx.date).toLocaleDateString('ar-SA-u-nu-latn')}</td>
                              <td className="py-2.5 px-3 text-xs font-mono">{tx.entryNumber}</td>
                              <td className="py-2.5 px-3">{tx.description}</td>
                              <td className="py-2.5 px-3 text-left font-mono" dir="ltr"><CurrencyAmount amount={tx.amount} symbolClassName="w-3 h-3" /></td>
                              <td className="py-2.5 px-3 text-left font-mono" dir="ltr"><CurrencyAmount amount={tx.tax} symbolClassName="w-3 h-3" /></td>
                              <td className="py-2.5 px-3 text-left font-mono font-semibold" dir="ltr"><CurrencyAmount amount={tx.net} symbolClassName="w-3 h-3" /></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
