'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import {
  Store,
  UtensilsCrossed,
  ArrowRight,
  Plus,
  Trash2,
  Printer,
  XCircle,
  Loader2,
  Receipt,
  Banknote,
  CreditCard,
  User,
  Search,
  Minus,
  ChevronLeft,
  Grid3X3,
  Calculator,
  Check,
  ArrowLeft,
  FileText,
  RotateCcw,
  ClipboardList,
  FileBarChart,
  AlertTriangle,
  Shield,
  Wallet,
  ChevronDown,
  ChevronUp,
  Users,
  Percent,
  ReceiptText,
} from 'lucide-react';
import QRCode from 'qrcode';
import { generateZatcaQR } from '@/lib/zatca-qr';

import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
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
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from '@/components/ui/command';
import { formatNumber, formatCurrency, formatCurrencyWithSymbol, TAX_RATE, PAYMENT_METHOD_LABELS } from '@/lib/types';
import { round2 } from '@/lib/decimal';
import type { PaymentMethod } from '@/lib/types';
import { CurrencyAmount, CurrencySymbol, formatReceiptCurrency } from '@/components/ui/currency-symbol';
import { useAppStore } from '@/lib/store';
import { useTranslation } from '@/lib/i18n';
import ShiftManagement from '@/components/accounting/shift-management';

// ─── Local Type Definitions ───────────────────────────────────────

interface POSInvoice {
  id: string;
  invoiceNumber: string;
  tableId: string | null;
  branchId: string;
  /** @deprecated backward-compat alias — some legacy callers still send `branch`. Always prefer `branchId`. */
  branch?: string;
  status: 'DRAFT' | 'FINALIZED' | 'CANCELLED' | 'RETURNED';
  customerId: string | null;
  customerName: string | null;
  subtotal: number;
  discountAmount: number;
  discountPercentage: number;
  taxAmount: number;
  totalAmount: number;
  paidAmount: number;
  changeAmount: number;
  paymentMethod: string | null;
  transactionId: string | null;
  isReturn?: boolean;
  originalInvoiceId?: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  items: POSInvoiceItem[];
  payments?: POSInvoicePayment[];
  table?: { id: string; name: string };
}

interface POSInvoiceItem {
  id: string;
  invoiceId: string;
  productId: string | null;
  name: string;
  nameEn?: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  notes: string | null;
  sortOrder: number;
}

interface POSInvoicePayment {
  id: string;
  invoiceId: string;
  method: string;
  amount: number;
}

interface RestaurantTable {
  id: string;
  name: string;
  branch: string;
  isActive: boolean;
  sortOrder: number;
}

interface Customer {
  id: string;
  name: string;
  nameEn?: string;
  type: string;
  discountPercentage: number;
  phone?: string | null;
}

interface BranchInfo {
  id: string;       // UUID — primary identifier used for all API calls
  key: string;      // branch code (e.g. CHINA_TOWN) — kept for backward compat / translations
  name: string;     // display name (English preferred: nameEn || name)
  enabled: boolean;
  // ─── Per-branch independent settings (null = fall back to global companyInfo) ───
  nameAr: string;            // Arabic name (Branch.name)
  nameEn: string | null;     // English name (Branch.nameEn)
  phone: string | null;
  address: string | null;
  addressEn: string | null;
  vatNumber: string | null;  // overrides global taxNumber on receipts + QR code
  taxRate: number | null;    // override percentage (e.g. 15 means 15%); null = use global/default
  receiptHeader: string | null;
  receiptFooter: string | null;
  logo: string | null;       // base64 data URL — overrides global logo
}

interface ProductCategory {
  id: string;
  name: string;
  nameEn?: string;
  branch: string;
  icon?: string;
  color?: string;
  isActive: boolean;
  sortOrder: number;
  products?: Product[];
  _count?: { products: number };
}

interface Product {
  id: string;
  name: string;
  nameEn?: string;
  sku?: string;
  categoryId: string;
  branch: string;
  costPrice: number;
  price: number;
  unit: string;
  currentStock: number;
  minStock: number;
  isActive: boolean;
  sortOrder: number;
  category?: { id: string; name: string };
}

interface PaymentRow {
  method: string;
  amount: number;
}

// ─── Constants ────────────────────────────────────────────────────

const BRANCH_ENGLISH_NAMES: Record<string, string> = {
  CHINA_TOWN: 'CHINA TOWN',
  PALACE_INDIA: 'PALACE INDIA',
};

const POS_PAYMENT_METHODS: PaymentMethod[] = ['CASH', 'CREDIT', 'MADA', 'VISA', 'MASTERCARD', 'OTHER_CARD'];
const HALL_PAYMENT_METHODS: PaymentMethod[] = ['CASH', 'MADA', 'VISA', 'MASTERCARD', 'OTHER_CARD'];

const PAYMENT_METHOD_BILINGUAL: Record<string, string> = {
  CASH: 'نقدي / Cash',
  CREDIT: 'آجل / Credit',
  MADA: 'مدى / Mada',
  VISA: 'فيزا / Visa',
  MASTERCARD: 'ماستركارد / Mastercard',
  OTHER_CARD: 'بطاقة أخرى / Other Card',
};

const CATEGORY_COLORS = [
  { bg: 'bg-emerald-500', light: 'bg-emerald-50 dark:bg-emerald-950/30', border: 'border-emerald-300 dark:border-emerald-700', text: 'text-emerald-700 dark:text-emerald-300' },
  { bg: 'bg-teal-500', light: 'bg-teal-50 dark:bg-teal-950/30', border: 'border-teal-300 dark:border-teal-700', text: 'text-teal-700 dark:text-teal-300' },
  { bg: 'bg-amber-500', light: 'bg-amber-50 dark:bg-amber-950/30', border: 'border-amber-300 dark:border-amber-700', text: 'text-amber-700 dark:text-amber-300' },
  { bg: 'bg-orange-500', light: 'bg-orange-50 dark:bg-orange-950/30', border: 'border-orange-300 dark:border-orange-700', text: 'text-orange-700 dark:text-orange-300' },
  { bg: 'bg-rose-500', light: 'bg-rose-50 dark:bg-rose-950/30', border: 'border-rose-300 dark:border-rose-700', text: 'text-rose-700 dark:text-rose-300' },
  { bg: 'bg-violet-500', light: 'bg-violet-50 dark:bg-violet-950/30', border: 'border-violet-300 dark:border-violet-700', text: 'text-violet-700 dark:text-violet-300' },
  { bg: 'bg-cyan-500', light: 'bg-cyan-50 dark:bg-cyan-950/30', border: 'border-cyan-300 dark:border-cyan-700', text: 'text-cyan-700 dark:text-cyan-300' },
  { bg: 'bg-pink-500', light: 'bg-pink-50 dark:bg-pink-950/30', border: 'border-pink-300 dark:border-pink-700', text: 'text-pink-700 dark:text-pink-300' },
  { bg: 'bg-lime-500', light: 'bg-lime-50 dark:bg-lime-950/30', border: 'border-lime-300 dark:border-lime-700', text: 'text-lime-700 dark:text-lime-300' },
  { bg: 'bg-sky-500', light: 'bg-sky-50 dark:bg-sky-950/30', border: 'border-sky-300 dark:border-sky-700', text: 'text-sky-700 dark:text-sky-300' },
];

const CATEGORY_ICONS = ['🍔', '🍕', '🥤', '🍰', '🍗', '🥗', '☕', '🌮', '🍣', '🥘'];

// ─── Component ────────────────────────────────────────────────────

export default function POSScreen() {
  // Get currency symbol and auth from global store
  const currencySymbolUrl = useAppStore((s) => s.currencySymbolUrl);
  const setCurrencySymbolUrl = useAppStore((s) => s.setCurrencySymbolUrl);
  const authToken = useAppStore((s) => s.authToken);
  const { t, isRTL, locale } = useTranslation();

  // View state
  // Shift management dialog
  const [shiftDialogOpen, setShiftDialogOpen] = useState(false);
  const [activeShift, setActiveShift] = useState<any>(null);

  // Fetch active shift
  const fetchActiveShift = useCallback(async () => {
    try {
      const res = await fetch('/api/pos/shifts/active', {
        headers: { 'Authorization': `Bearer ${authToken}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      setActiveShift(data.active ? data.shift : null);
    } catch {
      // Silently fail
    }
  }, [authToken]);

  useEffect(() => {
    if (authToken) fetchActiveShift();
  }, [authToken, fetchActiveShift]);

  const [posView, setPosView] = useState<'branches' | 'tables' | 'invoice' | 'invoices' | 'returns' | 'daily-report'>('branches');
  const [selectedBranch, setSelectedBranch] = useState<string>('');
  const [selectedInvoice, setSelectedInvoice] = useState<POSInvoice | null>(null);
  const [pendingTable, setPendingTable] = useState<RestaurantTable | null>(null);

  // Branches
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [branchesLoading, setBranchesLoading] = useState(true);

  // Tables
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [draftInvoices, setDraftInvoices] = useState<POSInvoice[]>([]);
  const [tablesLoading, setTablesLoading] = useState(false);

  // Products & Categories
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [productsLoading, setProductsLoading] = useState(false);
  const [productSearch, setProductSearch] = useState('');

  // Manual add
  const [manualAddOpen, setManualAddOpen] = useState(false);
  const [newItemName, setNewItemName] = useState('');
  const [newItemPrice, setNewItemPrice] = useState('');
  const [newItemQty, setNewItemQty] = useState('1');
  const [addingItem, setAddingItem] = useState(false);

  // Invoice details
  const [discountPercentage, setDiscountPercentage] = useState<number>(0);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('cash_unregistered');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerSearchOpen, setCustomerSearchOpen] = useState(false);
  const [customerSearchValue, setCustomerSearchValue] = useState('');

  // Inline customer creation
  const [newCustomerDialogOpen, setNewCustomerDialogOpen] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState('');
  const [newCustomerDiscount, setNewCustomerDiscount] = useState('');
  const [newCustomerPhone, setNewCustomerPhone] = useState('');
  const [newCustomerType, setNewCustomerType] = useState<'CASH' | 'PLATFORM'>('CASH');
  const [creatingCustomer, setCreatingCustomer] = useState(false);

  // Max discount percentage from settings (0 = no limit)
  const [maxDiscountPercentage, setMaxDiscountPercentage] = useState<number>(0);

  // Sales channel
  const [salesChannel, setSalesChannel] = useState<'HALL' | 'PLATFORM'>('HALL');

  // Multi-payment
  const [paymentRows, setPaymentRows] = useState<PaymentRow[]>([
    { method: 'CASH', amount: 0 },
  ]);

  // Actions
  const [creatingInvoice, setCreatingInvoice] = useState(false);
  const [updatingItem, setUpdatingItem] = useState<string | null>(null);
  const [finalizing, setFinalizing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [deletingInvoice, setDeletingInvoice] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deletingInvoiceData, setDeletingInvoiceData] = useState<POSInvoice | null>(null);

  // Supervisor password dialog
  const [supervisorPasswordOpen, setSupervisorPasswordOpen] = useState(false);
  const [supervisorPasswordInput, setSupervisorPasswordInput] = useState('');
  const [supervisorPasswordError, setSupervisorPasswordError] = useState('');

  // Invoices list view
  const [pastInvoices, setPastInvoices] = useState<POSInvoice[]>([]);
  const [pastInvoicesLoading, setPastInvoicesLoading] = useState(false);
  const [invoiceSearchQuery, setInvoiceSearchQuery] = useState('');

  // Returns view
  const [returningInvoice, setReturningInvoice] = useState<POSInvoice | null>(null);
  const [returning, setReturning] = useState(false);
  const [returnConfirmOpen, setReturnConfirmOpen] = useState(false);

  // Daily report view
  const [dailyReport, setDailyReport] = useState<any>(null);
  const [dailyReportLoading, setDailyReportLoading] = useState(false);
  const [expandedInvoiceId, setExpandedInvoiceId] = useState<string | null>(null);

  // Receipt dialog
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [receiptData, setReceiptData] = useState<POSInvoice | null>(null);
  const [receiptPayments, setReceiptPayments] = useState<POSInvoicePayment[]>([]);
  const [companyInfo, setCompanyInfo] = useState<{
    companyName: string;
    companyNameEn: string;
    taxNumber: string;
    address: string;
    addressEn: string;
    phone: string;
    // Global default tax rate as a percentage (e.g. 15 = 15%).
    // null = no global override → fall back to the hardcoded 0.15 Saudi default.
    // A per-branch Branch.taxRate override takes precedence over this value.
    taxRate: number | null;
  }>({
    companyName: '',
    companyNameEn: '',
    taxNumber: '',
    address: '',
    addressEn: '',
    phone: '',
    taxRate: null,
  });
  const [logoDataUrl, setLogoDataUrl] = useState<string>('');
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string>('');
  const [finalized, setFinalized] = useState(false);
  const [printSettings, setPrintSettings] = useState({
    receiptWidth: 80,
    fontSize: 11,
    logoWidth: 40,
    logoHeight: 20,
  });

  // Refs
  const discountTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const receiptRef = useRef<HTMLDivElement>(null);

  // ─── Computed: Is discount locked for current customer? ────────────
  // Cash customers: discount is pulled from their profile and NOT editable in POS
  // Platform customers: discount is variable and entered each time
  const isCashCustomerDiscountLocked = (() => {
    if (selectedCustomerId === 'cash_unregistered' || selectedCustomerId === 'cash') return false;
    const customerObj = customers.find(c => c.id === selectedCustomerId);
    return customerObj && (customerObj.type === 'CASH' || customerObj.type === 'WALK_IN' || customerObj.type === 'INDIVIDUAL') && customerObj.discountPercentage > 0;
  })();

  // ─── Fetch Branches ─────────────────────────────────────────────

  const fetchBranches = useCallback(async () => {
    try {
      setBranchesLoading(true);

      // Fetch branches from DB (source of truth) and settings in parallel
      const [branchesRes, settingsRes] = await Promise.all([
        fetch('/api/branches'),
        fetch('/api/settings'),
      ]);

      // Parse branches from DB
      let branchList: BranchInfo[] = [];
      if (branchesRes.ok) {
        const dbBranches = await branchesRes.json();
        // Convert DB branch records to BranchInfo format
        // `id` (UUID) is the primary identifier — selectedBranch stores this value
        branchList = dbBranches
          .filter((b: any) => b.isActive)
          .map((b: any) => ({
            id: b.id,
            key: b.code,
            name: b.nameEn || b.name, // English name for POS display
            enabled: true,
            // Per-branch independent settings (null = fall back to global companyInfo)
            nameAr: (b.name as string) ?? '',
            nameEn: (b.nameEn as string | null) ?? null,
            phone: (b.phone as string | null) ?? null,
            address: (b.address as string | null) ?? null,
            addressEn: (b.addressEn as string | null) ?? null,
            vatNumber: (b.vatNumber as string | null) ?? null,
            taxRate: b.taxRate != null ? Number(b.taxRate) : null,
            receiptHeader: (b.receiptHeader as string | null) ?? null,
            receiptFooter: (b.receiptFooter as string | null) ?? null,
            logo: (b.logo as string | null) ?? null,
          }));
      }

      // Fallback to default branches if DB returns nothing.
      // (id falls back to the code since no UUID is available offline.)
      // Per-branch fields are nulled out so the receipt falls back to global settings.
      if (branchList.length === 0) {
        branchList = [
          { id: 'CHINA_TOWN', key: 'CHINA_TOWN', name: 'China Town', enabled: true, nameAr: 'تشينا تاون', nameEn: 'China Town', phone: null, address: null, addressEn: null, vatNumber: null, taxRate: null, receiptHeader: null, receiptFooter: null, logo: null },
          { id: 'PALACE_INDIA', key: 'PALACE_INDIA', name: 'Palace India', enabled: true, nameAr: 'بالاس إنديا', nameEn: 'Palace India', phone: null, address: null, addressEn: null, vatNumber: null, taxRate: null, receiptHeader: null, receiptFooter: null, logo: null },
        ];
      }

      // ─── Filter branches by user's allowedBranches ───
      // Server-side also enforces this, but we filter client-side for better UX
      const { canAccessBranch } = useAppStore.getState();
      branchList = branchList.filter((b) => canAccessBranch(b.key));

      setBranches(branchList);

      // Load settings (discount, print settings, etc.)
      if (settingsRes.ok) {
        const data: Record<string, string> = await settingsRes.json();

        // Load max discount percentage
        if (data.maxDiscountPercentage) {
          setMaxDiscountPercentage(parseFloat(data.maxDiscountPercentage) || 0);
        }

        // Load print settings
        if (data.receiptWidth) setPrintSettings(prev => ({ ...prev, receiptWidth: parseFloat(data.receiptWidth) || 80 }));
        if (data.receiptFontSize) setPrintSettings(prev => ({ ...prev, fontSize: parseFloat(data.receiptFontSize) || 11 }));
        if (data.logoWidth) setPrintSettings(prev => ({ ...prev, logoWidth: parseFloat(data.logoWidth) || 40 }));
        if (data.logoHeight) setPrintSettings(prev => ({ ...prev, logoHeight: parseFloat(data.logoHeight) || 20 }));
      }
    } catch {
      toast.error(t.failedToFetchBranches);
      // Filter fallback branches by user's allowedBranches
      const { canAccessBranch } = useAppStore.getState();
      const fallback: BranchInfo[] = [
        { id: 'CHINA_TOWN', key: 'CHINA_TOWN', name: 'China Town', enabled: true, nameAr: 'تشينا تاون', nameEn: 'China Town', phone: null, address: null, addressEn: null, vatNumber: null, taxRate: null, receiptHeader: null, receiptFooter: null, logo: null },
        { id: 'PALACE_INDIA', key: 'PALACE_INDIA', name: 'Palace India', enabled: true, nameAr: 'بالاس إنديا', nameEn: 'Palace India', phone: null, address: null, addressEn: null, vatNumber: null, taxRate: null, receiptHeader: null, receiptFooter: null, logo: null },
      ];
      setBranches(fallback.filter((b) => canAccessBranch(b.key)));
    } finally {
      setBranchesLoading(false);
    }
  }, []);

  // ─── Fetch Tables & Draft Invoices ──────────────────────────────

  const fetchTables = useCallback(async (branch: string) => {
    try {
      setTablesLoading(true);
      const [tablesRes, invoicesRes] = await Promise.all([
        fetch(`/api/pos/tables?branchId=${branch}`),
        fetch(`/api/pos/invoices?branchId=${branch}&status=DRAFT`),
      ]);

      if (!tablesRes.ok) throw new Error(t.failedToFetchTables);
      const tablesData: RestaurantTable[] = await tablesRes.json();
      setTables(tablesData);

      if (invoicesRes.ok) {
        const invoicesData = await invoicesRes.json();
        const invoices: POSInvoice[] = Array.isArray(invoicesData) ? invoicesData : (invoicesData.invoices || []);
        setDraftInvoices(invoices);
      } else {
        setDraftInvoices([]);
      }
    } catch {
      toast.error(t.failedToFetchTables);
      setTables([]);
      setDraftInvoices([]);
    } finally {
      setTablesLoading(false);
    }
  }, []);

  // ─── Fetch Customers ────────────────────────────────────────────

  const fetchCustomers = useCallback(async () => {
    try {
      const res = await fetch('/api/customers');
      if (res.ok) {
        const data = await res.json();
        // API returns { customers: [...], total, limit, offset }
        const customersList: Customer[] = Array.isArray(data) ? data : (data.customers || []);
        setCustomers(customersList);
      }
    } catch {
      // Silently fail
    }
  }, []);

  // ─── Ensure currency symbol is loaded (fallback if store is empty) ──

  const ensureCurrencySymbol = useCallback(async () => {
    // Only fetch if the store doesn't already have it
    const currentUrl = useAppStore.getState().currencySymbolUrl;
    if (currentUrl) return currentUrl;
    try {
      const res = await fetch('/api/settings/currency-symbol');
      if (res.ok) {
        const data = await res.json();
        if (data.imageData) {
          setCurrencySymbolUrl(data.imageData);
          return data.imageData;
        }
      }
    } catch {
      // Silently fail
    }
    return '';
  }, [setCurrencySymbolUrl]);

  // ─── Fetch Company Info ─────────────────────────────────────────

  const fetchCompanyInfo = useCallback(async (branch?: string) => {
    try {
      const res = await fetch('/api/settings');
      if (res.ok) {
        const data: Record<string, string> = await res.json();
        // Global tax rate (percentage string like "15") — parsed to a number.
        // NaN/missing → null (signals "fall back to hardcoded 0.15").
        const globalTaxRateRaw = data.taxRate ? parseFloat(data.taxRate) : NaN;
        setCompanyInfo({
          companyName: data.companyName || '',
          companyNameEn: data.companyNameEn || '',
          taxNumber: data.taxNumber || '',
          address: data.address || '',
          addressEn: data.addressEn || '',
          phone: data.phone || '',
          taxRate: Number.isFinite(globalTaxRateRaw) ? globalTaxRateRaw : null,
        });
        setPrintSettings({
          receiptWidth: parseFloat(data.receiptWidth) || 80,
          fontSize: parseFloat(data.receiptFontSize) || 11,
          logoWidth: parseFloat(data.logoWidth) || 40,
          logoHeight: parseFloat(data.logoHeight) || 20,
        });
      }
      // Fetch logo as data URL for use in both dialog and print window
      if (branch) {
        try {
          const logoRes = await fetch(`/api/settings/logo?branchId=${branch}`);
          if (logoRes.ok) {
            const logoJson = await logoRes.json();
            if (logoJson.logoData) {
              setLogoDataUrl(logoJson.logoData);
            } else {
              setLogoDataUrl('');
            }
          }
        } catch {
          setLogoDataUrl('');
        }
      }
    } catch {
      // Silently fail
    }
  }, []);

  // ─── Fetch Categories ──────────────────────────────────────────

  const fetchCategories = useCallback(async (branch: string) => {
    try {
      const res = await fetch(`/api/pos/categories?branchId=${branch}&activeOnly=true`);
      if (res.ok) {
        const data = await res.json();
        setCategories(Array.isArray(data) ? data : (data.categories || []));
      }
    } catch {
      // Silently fail
    }
  }, []);

  // ─── Fetch Products ────────────────────────────────────────────

  const fetchProducts = useCallback(async (branch: string) => {
    try {
      setProductsLoading(true);
      const res = await fetch(`/api/pos/products?branchId=${branch}&activeOnly=true`);
      if (res.ok) {
        const data = await res.json();
        setProducts(Array.isArray(data) ? data : (data.products || []));
      }
    } catch {
      // Silently fail
    } finally {
      setProductsLoading(false);
    }
  }, []);

  // ─── Effects ────────────────────────────────────────────────────

  useEffect(() => {
    fetchBranches();
    fetchCustomers();
  }, [fetchBranches, fetchCustomers]);

  useEffect(() => {
    if (selectedBranch && posView === 'tables') {
      fetchTables(selectedBranch);
    }
  }, [selectedBranch, posView, fetchTables]);

  useEffect(() => {
    if (selectedBranch && posView === 'invoice') {
      fetchCategories(selectedBranch);
      fetchProducts(selectedBranch);
    }
  }, [selectedBranch, posView, fetchCategories, fetchProducts]);

  // ─── Fetch past invoices (all statuses) for branch ──────────────────

  const fetchPastInvoices = useCallback(async (branch: string) => {
    try {
      setPastInvoicesLoading(true);
      const res = await fetch(`/api/pos/invoices?branchId=${branch}`);
      if (res.ok) {
        const data = await res.json();
        const invoices: POSInvoice[] = Array.isArray(data) ? data : (data.invoices || []);
        setPastInvoices(invoices);
      }
    } catch {
      setPastInvoices([]);
    } finally {
      setPastInvoicesLoading(false);
    }
  }, []);

  // ─── Handle Return Invoice ────────────────────────────────────────

  const handleDeleteInvoice = async (invoiceId: string) => {
    try {
      setDeletingInvoice(true);
      const res = await fetch(`/api/pos/invoices/${invoiceId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || t.failedToDeleteInvoice);
      }
      toast.success(t.invoiceDeleted);
      setDeleteConfirmOpen(false);
      setDeletingInvoiceData(null);
      // Refresh the invoices list and tables
      if (selectedBranch) {
        fetchPastInvoices(selectedBranch);
        fetchTables(selectedBranch);
      }
    } catch (error: any) {
      toast.error(error.message || t.failedToDeleteInvoice);
    } finally {
      setDeletingInvoice(false);
    }
  };

  const handleCreateReturn = async (invoiceId: string) => {
    try {
      setReturning(true);
      const res = await fetch('/api/pos/returns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ originalInvoiceId: invoiceId }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || t.failedToCreateReturn);
      }
      toast.success(t.returnCreated);
      setReturnConfirmOpen(false);
      setReturningInvoice(null);
      // Refresh the invoices list
      if (selectedBranch) {
        fetchPastInvoices(selectedBranch);
      }
    } catch (error: any) {
      toast.error(error.message || t.failedToCreateReturn);
    } finally {
      setReturning(false);
    }
  };

  // ─── Generate Daily Report ────────────────────────────────────────

  const handleDailyReport = async (branch: string) => {
    try {
      setDailyReportLoading(true);
      const res = await fetch('/api/pos/daily-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branchId: branch }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || t.failedToCreateReport);
      }
      const data = await res.json();
      setDailyReport(data);
      setPosView('daily-report');
    } catch (error: any) {
      toast.error(error.message || t.failedToCreateReport);
    } finally {
      setDailyReportLoading(false);
    }
  };

  // ─── Reprint a finalized invoice ──────────────────────────────────

  const handleReprint = async (invoice: POSInvoice) => {
    // Fetch full invoice details with payments and receiptHtml
    try {
      const res = await fetch(`/api/pos/invoices/${invoice.id}`);
      if (!res.ok) throw new Error(t.failedToFetchInvoice);
      const fullInvoice = await res.json();

      // If the invoice has saved receipt HTML, use it directly (exact replica)
      if (fullInvoice.receiptHtml) {
        const printWindow = window.open('', '_blank', 'width=320,height=600');
        if (!printWindow) {
          toast.error(t.allowPopups);
          return;
        }
        printWindow.document.write(fullInvoice.receiptHtml);
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
        return;
      }

      // Fallback: show receipt dialog (for old invoices without saved HTML)
      setReceiptData(fullInvoice);
      setReceiptPayments(fullInvoice.payments || []);
      setFinalized(true); // Already finalized
      await fetchCompanyInfo(fullInvoice.branchId || fullInvoice.branch || selectedBranch);
      // Ensure currency symbol is loaded in store before receipt rendering
      await ensureCurrencySymbol();
      setReceiptOpen(true);
    } catch (error: any) {
      toast.error(error.message || t.failedToFetchInvoice);
    }
  };

  // ─── Print daily report ───────────────────────────────────────────

  const handlePrintDailyReport = () => {
    if (!dailyReport) return;
    const rw = printSettings.receiptWidth;
    const fs = printSettings.fontSize;
    // dailyReport.branchId is a UUID — use the helper to resolve the display name
    const branchName = dailyReport.branchName || getBranchName(dailyReport.branchId);
    const branchNameEn = getBranchNameEn(dailyReport.branchId);
    const dayStart = new Date(dailyReport.dayStart).toLocaleString('en-GB', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' });
    const dayEnd = new Date(dailyReport.dayEnd).toLocaleString('en-GB', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' });

    const paymentLines = Object.entries(dailyReport.paymentBreakdown || {}).map(([method, data]: [string, any]) => {
      const label = PAYMENT_METHOD_BILINGUAL[method] || method;
      return `<div class="info-row"><span>${label}</span><span>${formatNumber(data.amount)}</span></div>`;
    }).join('');

    const itemLines = (dailyReport.topItems || []).slice(0, 15).map((item: any) =>
      `<div class="item-line"><span>${item.name}</span><span>${item.quantity} × ${formatNumber(item.total / item.quantity)} = ${formatNumber(item.total)}</span></div>`
    ).join('');

    // Detailed invoice lines with items, discount, tax, payments
    const invoiceDetailLines = (dailyReport.invoiceList || []).slice(0, 50).map((inv: any) => {
      const invDate = new Date(inv.createdAt);
      const dateStr = invDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      const prefix = inv.isReturn ? '⟲ ' : '';
      const statusLabel = inv.isReturn ? ' (مرتجع/Return)' : '';
      const colorStyle = inv.isReturn ? ' style="color:#c00;"' : '';

      // Items breakdown
      const invItemLines = (inv.items || []).map((item: any) =>
        `<div class="item-line" style="padding-right:8px;"><span>  ${item.name}${item.nameEn ? ' / ' + item.nameEn : ''}</span><span>${formatNumber(item.quantity)} × ${formatNumber(item.unitPrice)} = ${formatNumber(item.totalPrice)}</span></div>`
      ).join('');

      // Payment methods for this invoice
      const invPayLines = (inv.payments || []).map((p: any) => {
        const pLabel = PAYMENT_METHOD_BILINGUAL[p.method] || p.method;
        return `<div class="item-line" style="padding-right:8px;"><span>  ${pLabel}</span><span>${formatNumber(p.amount)}</span></div>`;
      }).join('');

      // Financial details
      const discountLine = inv.discountPercentage > 0
        ? `<div class="item-line" style="padding-right:8px; color:#b45309;"><span>  خصم ${inv.discountPercentage}% / Disc</span><span>-${formatNumber(inv.discountAmount)}</span></div>`
        : '';
      const taxLine = `<div class="item-line" style="padding-right:8px; color:#0369a1;"><span>  ضريبة / VAT</span><span>${formatNumber(inv.taxAmount)}</span></div>`;

      return `
        <div${colorStyle}>
          <div class="item-line bold"><span>${prefix}${inv.invoiceNumber}${statusLabel}</span><span>${formatNumber(inv.totalAmount)}</span></div>
          <div class="item-line" style="font-size:8px; color:#666;"><span>  ${inv.customerName || 'نقدي/Cash'} | ${inv.customerType === 'PLATFORM' ? 'منصة' : 'نقدي'} | ${dateStr}</span><span></span></div>
          ${invItemLines}
          ${discountLine}
          ${taxLine}
          ${invPayLines}
          <div class="separator-light"></div>
        </div>
      `;
    }).join('');

    // Customer balances section
    const customerBalances: any[] = dailyReport.customerBalances || [];
    const customerBalanceLines = customerBalances.map((cb: any) =>
      `<div class="item-line"><span>${cb.customerName} (${cb.type === 'PLATFORM' ? 'منصة' : 'نقدي'})</span><span>${formatNumber(cb.creditTotal)} | ${formatNumber(cb.currentBalance)}</span></div>`
    ).join('');

    const printContent = `
      <div class="receipt">
        <div class="center bold" style="font-size:16px;">تقرير يومي / Daily Report</div>
        <div class="center" style="font-size:12px;">${branchName} / ${branchNameEn}</div>
        <div class="separator"></div>
        <div class="info-row"><span>من / From:</span><span>${dayStart}</span></div>
        <div class="info-row"><span>إلى / To:</span><span>${dayEnd}</span></div>
        <div class="double-separator"></div>

        <div class="center bold" style="font-size:12px; margin:4px 0;">المبيعات / Sales</div>
        <div class="info-row"><span>عدد الفواتير / Invoices:</span><span>${dailyReport.sales.count}</span></div>
        <div class="info-row"><span>المجموع الفرعي / Subtotal:</span><span>${formatNumber(dailyReport.sales.subtotal)}</span></div>
        <div class="info-row"><span>الخصم / Discount:</span><span>${formatNumber(dailyReport.sales.discount)}</span></div>
        <div class="info-row"><span>الضريبة / VAT:</span><span>${formatNumber(dailyReport.sales.tax)}</span></div>
        <div class="info-row bold" style="font-size:12px;"><span>إجمالي المبيعات / Total Sales:</span><span>${formatNumber(dailyReport.sales.total)}</span></div>
        <div class="info-row"><span>متوسط الفاتورة / Avg Invoice:</span><span>${formatNumber(dailyReport.avgInvoiceValue || 0)}</span></div>
        <div class="separator"></div>

        ${dailyReport.returns.count > 0 ? `
          <div class="center bold" style="font-size:12px; color:#c00; margin:4px 0;">المرتجعات / Returns</div>
          <div class="info-row" style="color:#c00;"><span>عدد المرتجعات / Returns:</span><span>${dailyReport.returns.count}</span></div>
          <div class="info-row" style="color:#c00;"><span>إجمالي المرتجعات / Total Returns:</span><span>${formatNumber(dailyReport.returns.total)}</span></div>
          <div class="separator"></div>
        ` : ''}

        <div class="center bold" style="font-size:13px; margin:4px 0;">الصافي / Net</div>
        <div class="info-row bold" style="font-size:14px;"><span>صافي المبيعات / Net Sales:</span><span>${formatNumber(dailyReport.net.total)}</span></div>
        <div class="info-row"><span>صافي الضريبة / Net VAT:</span><span>${formatNumber(dailyReport.net.tax)}</span></div>
        <div class="double-separator"></div>

        <div class="center bold" style="font-size:11px; margin:4px 0;">طرق الدفع / Payment Methods</div>
        ${paymentLines}
        <div class="separator"></div>

        <div class="center bold" style="font-size:11px; margin:4px 0;">أكثر الأصناف مبيعاً / Top Items</div>
        ${itemLines || '<div class="center" style="color:#888;">' + t.noItems + '</div>'}
        <div class="separator"></div>

        ${customerBalances.length > 0 ? `
          <div class="center bold" style="font-size:11px; margin:4px 0;">أرصدة العملاء / Customer Balances</div>
          <div class="item-line" style="font-size:8px; color:#666;"><span>العميل / Customer</span><span>آجل/Credit | رصيد/Balance</span></div>
          ${customerBalanceLines}
          <div class="separator"></div>
        ` : ''}

        <div class="center bold" style="font-size:11px; margin:4px 0;">تفاصيل الفواتير / Invoice Details</div>
        ${invoiceDetailLines || '<div class="center" style="color:#888;">' + t.noInvoices + '</div>'}

        <div class="double-separator"></div>
        <div class="center" style="font-size:9px; color:#888;">${t.reportGeneratedAutomatically}</div>
        <div class="center" style="font-size:8px; color:#aaa;">Report generated automatically</div>
      </div>
    `;

    const printWindow = window.open('', '_blank', 'width=320,height=800');
    if (!printWindow) { toast.error(t.allowPopups); return; }

    printWindow.document.write(`
      <!DOCTYPE html>
      <html dir="rtl" lang="ar">
      <head>
        <meta charset="UTF-8">
        <title>${t.dailyReport}</title>
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;900&family=Roboto+Mono:wght@400;500;700&display=swap">
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: 'Cairo', sans-serif; width: ${rw}mm; margin: 0 auto; padding: 4mm; font-size: ${fs}px; line-height: 1.5; color: #000; font-weight: 700; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .num { font-family: 'Roboto Mono', 'Courier New', monospace; direction: ltr; font-variant-numeric: tabular-nums; font-feature-settings: 'tnum'; }
          .receipt { width: 100%; color: #000; font-weight: 700; }
          .center { text-align: center; }
          .bold { font-weight: 900; }
          .separator { border-top: 1px dashed #000; margin: 3px 0; }
          .separator-light { border-top: 1px dotted #000; margin: 2px 0; }
          .double-separator { border-top: 3px solid #000; margin: 3px 0; }
          .info-row { display: flex; justify-content: space-between; gap: 8px; padding: 1px 0; font-size: 11px; font-weight: 700; color: #000; }
          .item-line { display: flex; justify-content: space-between; gap: 8px; font-size: 10px; padding: 1px 0; font-weight: 700; color: #000; }
          @media print { body { width: ${rw}mm; margin: 0; padding: 2mm; } @page { margin: 0; size: ${rw}mm auto; } }
        </style>
      </head>
      <body>${printContent}</body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => { printWindow.print(); setTimeout(() => printWindow.close(), 1000); }, 500);
  };

  // ─── Computed: Draft invoice map per table ──────────────────────

  const draftByTable = new Map<string, POSInvoice>();
  draftInvoices.forEach((inv) => {
    if (inv.tableId) {
      draftByTable.set(inv.tableId, inv);
    }
  });

  // ─── Computed: Invoice summary ─────────────────────────────────

  const invoiceSubtotal = round2((selectedInvoice?.items ?? []).reduce(
    (sum, item) => sum + item.totalPrice,
    0
  ));
  const discountAmount = round2(invoiceSubtotal * (discountPercentage / 100));
  const invoiceDiscount = discountAmount;
  const taxableAmount = Math.max(0, round2(invoiceSubtotal - invoiceDiscount));

  // ─── Computed: Effective tax rate (branch override → global → 0.15) ────
  // The POS operates against the currently selected branch, so we resolve the
  // tax rate from that branch's record. Branch.taxRate (a percentage like 15)
  // takes precedence over the global `taxRate` Setting, which in turn takes
  // precedence over the hardcoded 0.15 Saudi default.
  const currentBranchRecord = branches.find((b) => b.id === selectedBranch) ?? null;
  const effectiveTaxRateFraction: number =
    currentBranchRecord?.taxRate != null && Number.isFinite(currentBranchRecord.taxRate)
      ? currentBranchRecord.taxRate / 100
      : companyInfo.taxRate != null && Number.isFinite(companyInfo.taxRate)
        ? companyInfo.taxRate / 100
        : TAX_RATE;
  // Percentage formatted for display (e.g. "15" or "12.5")
  const effectiveTaxRatePct = effectiveTaxRateFraction * 100;
  const effectiveTaxRateDisplay = Number.isInteger(effectiveTaxRatePct)
    ? String(effectiveTaxRatePct)
    : effectiveTaxRatePct.toFixed(2).replace(/\.?0+$/, '');

  const invoiceTax = round2(taxableAmount * effectiveTaxRateFraction);
  const invoiceTotal = round2(taxableAmount + invoiceTax);

  // ─── Computed: Customers by channel ────────────────────────────────

  const hallCustomers = customers.filter(c => c.type === 'CASH' || c.type === 'WALK_IN' || c.type === 'INDIVIDUAL');
  const platformCustomers = customers.filter(c => c.type === 'PLATFORM');

  // ─── Computed: Available payment methods based on channel ───────────

  const availablePaymentMethods = salesChannel === 'HALL' ? HALL_PAYMENT_METHODS : ['CREDIT'];

  // ─── Computed: Products by selected category ─────────────────────

  const selectedCategory = categories.find(c => c.id === selectedCategoryId);
  const filteredProducts = selectedCategoryId
    ? products.filter(p => p.categoryId === selectedCategoryId)
    : [];

  const searchFilteredProducts = productSearch
    ? products.filter(p => p.name.includes(productSearch) || (p.nameEn && p.nameEn.toLowerCase().includes(productSearch.toLowerCase())))
    : [];

  // ─── Computed: Payment totals ───────────────────────────────────

  // Auto-calculate CREDIT amount: invoiceTotal - all non-CREDIT payments
  const nonCreditPayments = paymentRows.filter(p => p.method !== 'CREDIT');
  const creditPayments = paymentRows.filter(p => p.method === 'CREDIT');
  const nonCreditTotal = nonCreditPayments.reduce((sum, p) => sum + p.amount, 0);
  const autoCreditAmount = Math.max(0, invoiceTotal - nonCreditTotal);

  // Total paid includes auto-calculated credit amount
  const totalPaid = nonCreditTotal + (creditPayments.length > 0 ? autoCreditAmount : 0);
  const remaining = round2(invoiceTotal - totalPaid);
  const changeDue = creditPayments.length > 0 ? 0 : Math.max(0, totalPaid - invoiceTotal);

  // Auto-adjust CASH payment when remaining is within floating-point tolerance (-0.01 to 0.01)
  // This handles the case where the user enters the exact amount but floating point
  // causes a tiny discrepancy (e.g., 0.0049999 remaining)
  useEffect(() => {
    if (Math.abs(remaining) > 0 && Math.abs(remaining) <= 0.01 && totalPaid > 0) {
      const cashRowIndex = paymentRows.findIndex(r => r.method === 'CASH');
      if (cashRowIndex >= 0) {
        const adjustedCashAmount = round2(paymentRows[cashRowIndex].amount + remaining);
        if (adjustedCashAmount >= 0 && adjustedCashAmount !== paymentRows[cashRowIndex].amount) {
          const updated = [...paymentRows];
          updated[cashRowIndex] = { ...updated[cashRowIndex], amount: adjustedCashAmount };
          setPaymentRows(updated);
        }
      }
    }
  }, [remaining, totalPaid, paymentRows]);

  // ─── Handlers ───────────────────────────────────────────────────

  // Store the branch UUID (id) as the selectedBranch — all API calls use this UUID
  const handleSelectBranch = (branchId: string) => {
    setSelectedBranch(branchId);
    setPosView('tables');
  };

  const handleBackToBranches = () => {
    setSelectedBranch('');
    setTables([]);
    setDraftInvoices([]);
    setPosView('branches');
  };

  const handleBackToTables = async (options?: { skipDraftSave?: boolean }) => {
    const skipDraftSave = options?.skipDraftSave ?? false;

    // Clear pending table state if no invoice was created
    if (pendingTable) {
      setPendingTable(null);
    }

    // If the draft invoice has NO items, delete it entirely to avoid clutter
    // If it has items, auto-save before leaving so the user can resume later
    // Skip draft save if invoice was just finalized
    if (!skipDraftSave && selectedInvoice && selectedInvoice.status === 'DRAFT') {
      const hasItems = (selectedInvoice.items ?? []).length > 0;
      if (!hasItems) {
        // Delete empty draft — no point retaining it
        try {
          await fetch(`/api/pos/invoices/${selectedInvoice.id}`, {
            method: 'DELETE',
          });
        } catch {
          // Silently fail - best effort cleanup
        }
      } else {
        // Auto-save the draft with current customer/discount info
        try {
          await fetch(`/api/pos/invoices/${selectedInvoice.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              discountPercentage,
              customerId: (selectedCustomerId === 'cash' || selectedCustomerId === 'cash_unregistered') ? null : selectedCustomerId,
              customerName: (selectedCustomerId === 'cash' || selectedCustomerId === 'cash_unregistered') ? null : customers.find(c => c.id === selectedCustomerId)?.name || null,
            }),
          });
        } catch {
          // Silently fail - draft auto-save is best-effort
        }
      }
    }
    setSelectedInvoice(null);
    setDiscountPercentage(0);
    setFinalized(false);
    setSalesChannel('HALL');
    setSelectedCustomerId('cash_unregistered');
    setPaymentRows([{ method: 'CASH', amount: 0 }]);
    setNewItemName('');
    setNewItemPrice('');
    setNewItemQty('1');
    setProductSearch('');
    setSelectedCategoryId(null);
    setPosView('tables');
    if (selectedBranch) {
      fetchTables(selectedBranch);
    }
  };

  // ─── Select free table (defer draft creation until first item) ──

  const handleSelectFreeTable = async (table: RestaurantTable) => {
    // Don't create a draft invoice yet — just select the table and navigate
    // The draft will be created lazily when the first item is added
    setPendingTable(table);
    setSelectedInvoice(null);
    setDiscountPercentage(0);
    setFinalized(false);
    setSalesChannel('HALL');
    setSelectedCustomerId('cash_unregistered');
    setPaymentRows([{ method: 'CASH', amount: 0 }]);
    setPosView('invoice');
  };

  // ─── Open existing draft invoice ────────────────────────────────

  const handleSelectOccupiedTable = (invoice: POSInvoice) => {
    setPendingTable(null);
    setSelectedInvoice(invoice);
    setDiscountPercentage(invoice.discountPercentage || 0);
    setFinalized(false);
    if (invoice.customerId) {
      setSelectedCustomerId(invoice.customerId);
      // Auto-detect channel from customer type
      const customerObj = customers.find(c => c.id === invoice.customerId);
      if (customerObj?.type === 'PLATFORM') {
        setSalesChannel('PLATFORM');
        setPaymentRows([{ method: 'CREDIT', amount: 0 }]);
      } else {
        setSalesChannel('HALL');
        setPaymentRows([{ method: 'CASH', amount: 0 }]);
      }
    } else {
      setSelectedCustomerId('cash_unregistered');
      setSalesChannel('HALL');
      setPaymentRows([{ method: 'CASH', amount: 0 }]);
    }
    setPosView('invoice');
  };

  // ─── Add product to invoice ─────────────────────────────────────

  const handleAddProduct = async (product: Product) => {
    try {
      setAddingItem(true);

      // If no invoice exists yet, create one first (lazy draft creation)
      let currentInvoice = selectedInvoice;
      if (!currentInvoice && pendingTable) {
        const createRes = await fetch('/api/pos/invoices', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tableId: pendingTable.id,
            branchId: selectedBranch,
          }),
        });
        if (!createRes.ok) {
          const err = await createRes.json();
          throw new Error(err.error || t.failedToCreateInvoice);
        }
        currentInvoice = await createRes.json();
        if (!currentInvoice) throw new Error('Failed to create invoice');
        setSelectedInvoice(currentInvoice);
        setPendingTable(null);

        // Apply pending customer/discount to the newly created invoice
        const custId = (selectedCustomerId === 'cash' || selectedCustomerId === 'cash_unregistered') ? null : selectedCustomerId;
        const custName = custId ? customers.find(c => c.id === custId)?.name || null : null;
        if (custId || discountPercentage > 0) {
          try {
            const updateRes = await fetch(`/api/pos/invoices/${currentInvoice.id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ customerId: custId, customerName: custName, discountPercentage }),
            });
            if (updateRes.ok) {
              currentInvoice = await updateRes.json();
              setSelectedInvoice(currentInvoice);
            }
          } catch {
            // Silently fail — customer/discount can be set later
          }
        }
      }

      if (!currentInvoice) return;

      // Add the item to the existing invoice
      const res = await fetch(`/api/pos/invoices/${currentInvoice.id}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: product.name, nameEn: product.nameEn || '', unitPrice: product.price, quantity: 1, productId: product.id }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || t.failedToAddItem);
      }

      const updatedInvoice: POSInvoice = await res.json();
      setSelectedInvoice(updatedInvoice);
      toast.success(`${t.itemAdded} ${product.name}`);
    } catch (error: any) {
      toast.error(error.message || t.failedToAddItem);
    } finally {
      setAddingItem(false);
    }
  };

  // ─── Add manual item ────────────────────────────────────────────

  const handleAddManualItem = async () => {
    const name = newItemName.trim();
    const price = parseFloat(newItemPrice);
    const qty = parseInt(newItemQty);

    if (!name) { toast.error(t.pleaseEnterItemName); return; }
    if (isNaN(price) || price <= 0) { toast.error(t.pleaseEnterValidPrice); return; }
    if (isNaN(qty) || qty <= 0) { toast.error(t.pleaseEnterValidQuantity); return; }

    try {
      setAddingItem(true);

      // If no invoice exists yet, create one first (lazy draft creation)
      let currentInvoice = selectedInvoice;
      if (!currentInvoice && pendingTable) {
        const createRes = await fetch('/api/pos/invoices', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tableId: pendingTable.id,
            branchId: selectedBranch,
          }),
        });
        if (!createRes.ok) {
          const err = await createRes.json();
          throw new Error(err.error || t.failedToCreateInvoice);
        }
        currentInvoice = await createRes.json();
        if (!currentInvoice) throw new Error('Failed to create invoice');
        setSelectedInvoice(currentInvoice);
        setPendingTable(null);

        // Apply pending customer/discount to the newly created invoice
        const custId = (selectedCustomerId === 'cash' || selectedCustomerId === 'cash_unregistered') ? null : selectedCustomerId;
        const custName = custId ? customers.find(c => c.id === custId)?.name || null : null;
        if (custId || discountPercentage > 0) {
          try {
            const updateRes = await fetch(`/api/pos/invoices/${currentInvoice.id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ customerId: custId, customerName: custName, discountPercentage }),
            });
            if (updateRes.ok) {
              currentInvoice = await updateRes.json();
              setSelectedInvoice(currentInvoice);
            }
          } catch {
            // Silently fail — customer/discount can be set later
          }
        }
      }

      if (!currentInvoice) return;

      // Add the item to the existing invoice
      const res = await fetch(`/api/pos/invoices/${currentInvoice.id}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, unitPrice: price, quantity: qty }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || t.failedToAddItem);
      }

      const updatedInvoice: POSInvoice = await res.json();
      setSelectedInvoice(updatedInvoice);
      setNewItemName('');
      setNewItemPrice('');
      setNewItemQty('1');
      setManualAddOpen(false);
      toast.success(`${t.itemAdded} ${name}`);
    } catch (error: any) {
      toast.error(error.message || t.failedToAddItem);
    } finally {
      setAddingItem(false);
    }
  };

  // ─── Update item qty/price ──────────────────────────────────────

  const handleUpdateItem = async (itemId: string, field: 'quantity' | 'unitPrice', value: number) => {
    if (!selectedInvoice) return;
    const item = selectedInvoice.items.find((i) => i.id === itemId);
    if (!item) return;

    const updatedItem = { ...item, [field]: value };
    if (field === 'quantity' || field === 'unitPrice') {
      updatedItem.totalPrice = updatedItem.quantity * updatedItem.unitPrice;
    }

    try {
      setUpdatingItem(itemId);
      const res = await fetch(`/api/pos/invoices/${selectedInvoice.id}/items/${itemId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedItem),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || t.failedToUpdateItem);
      }

      const updatedInvoice: POSInvoice = await res.json();
      setSelectedInvoice(updatedInvoice);
    } catch (error: any) {
      toast.error(error.message || t.failedToUpdateItem);
    } finally {
      setUpdatingItem(null);
    }
  };

  // ─── Delete item ────────────────────────────────────────────────

  const handleDeleteItem = async (itemId: string) => {
    if (!selectedInvoice) return;

    try {
      const res = await fetch(`/api/pos/invoices/${selectedInvoice.id}/items/${itemId}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || t.failedToDeleteItem);
      }

      const updatedInvoice: POSInvoice = await res.json();

      // If all items were deleted, delete the empty draft and revert to pending table state
      if ((updatedInvoice.items ?? []).length === 0 && updatedInvoice.status === 'DRAFT') {
        try {
          await fetch(`/api/pos/invoices/${updatedInvoice.id}`, {
            method: 'DELETE',
          });
        } catch {
          // Silently fail - best effort cleanup
        }
        // Restore pending table state so the user can still add items
        if (updatedInvoice.tableId) {
          const table = tables.find(tbl => tbl.id === updatedInvoice.tableId);
          if (table) setPendingTable(table);
        }
        setSelectedInvoice(null);
        setDiscountPercentage(0);
      } else {
        setSelectedInvoice(updatedInvoice);
      }
      toast.success(t.itemDeleted);
    } catch (error: any) {
      toast.error(error.message || t.failedToDeleteItem);
    }
  };

  // ─── Update discount ────────────────────────────────────────────

  const handleUpdateDiscount = async (percentage: number) => {
    // Check max discount limit from settings
    if (maxDiscountPercentage > 0 && percentage > maxDiscountPercentage) {
      toast.error(`الحد الأعلى لنسبة الخصم هو ${maxDiscountPercentage}% / Maximum discount limit is ${maxDiscountPercentage}%`);
      return;
    }

    setDiscountPercentage(percentage);

    // In pending state (no invoice yet), discount is stored locally
    // and will be applied when the draft is lazily created on first item add
    if (!selectedInvoice) return;

    if (discountTimeoutRef.current) {
      clearTimeout(discountTimeoutRef.current);
    }

    discountTimeoutRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/pos/invoices/${selectedInvoice.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ discountPercentage: percentage }),
        });

        if (res.ok) {
          const updatedInvoice: POSInvoice = await res.json();
          setSelectedInvoice(updatedInvoice);
        }
      } catch {
        // Silently fail
      }
    }, 500);
  };

  // ─── Update customer ────────────────────────────────────────────

  const handleUpdateCustomer = async (customerId: string) => {
    setSelectedCustomerId(customerId);
    if (!selectedInvoice) return;

    const isUnregisteredCash = customerId === 'cash_unregistered' || customerId === 'cash';
    const customerObj = isUnregisteredCash ? null : customers.find((c) => c.id === customerId);
    const isCashType = customerObj && (customerObj.type === 'CASH' || customerObj.type === 'WALK_IN' || customerObj.type === 'INDIVIDUAL');
    const isPlatformType = customerObj && customerObj.type === 'PLATFORM';

    // CASH customers: auto-apply discount from their profile (NOT editable in POS)
    // PLATFORM customers: discount is variable and entered each time
    if (customerObj && isCashType && customerObj.discountPercentage > 0) {
      // Cash customer with discount - auto-apply and lock
      const discPct = maxDiscountPercentage > 0 ? Math.min(customerObj.discountPercentage, maxDiscountPercentage) : customerObj.discountPercentage;
      setDiscountPercentage(discPct);
      try {
        const res = await fetch(`/api/pos/invoices/${selectedInvoice.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customerId: customerObj.id,
            customerName: customerObj.name,
            discountPercentage: discPct,
          }),
        });
        if (res.ok) {
          const updatedInvoice: POSInvoice = await res.json();
          setSelectedInvoice(updatedInvoice);
        }
      } catch {
        // Optimistic
      }
      setPaymentRows([{ method: 'CASH', amount: 0 }]);
    } else if (customerObj && isPlatformType) {
      // Platform customer - reset discount to 0, let user enter variable discount
      setDiscountPercentage(0);
      try {
        const res = await fetch(`/api/pos/invoices/${selectedInvoice.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customerId: customerObj.id,
            customerName: customerObj.name,
            discountPercentage: 0,
          }),
        });
        if (res.ok) {
          const updatedInvoice: POSInvoice = await res.json();
          setSelectedInvoice(updatedInvoice);
        }
      } catch {
        // Optimistic
      }
      setPaymentRows([{ method: 'CREDIT', amount: 0 }]);
    } else {
      // No discount — reset discount to 0 and update customer
      setDiscountPercentage(0);
      try {
        const res = await fetch(`/api/pos/invoices/${selectedInvoice.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customerId: isUnregisteredCash ? null : customerId,
            customerName: customerObj?.name || null,
            discountPercentage: 0,
          }),
        });
        if (res.ok) {
          const updatedInvoice: POSInvoice = await res.json();
          setSelectedInvoice(updatedInvoice);
        }
      } catch {
        // Optimistic
      }

      // Auto-set payment method based on customer type
      if (customerObj?.type === 'PLATFORM') {
        setPaymentRows([{ method: 'CREDIT', amount: 0 }]);
      } else {
        setPaymentRows([{ method: 'CASH', amount: 0 }]);
      }
    }
  };

  // ─── Handle Create Customer Inline ──────────────────────────────

  const handleCreateCustomerInline = async () => {
    const trimmedName = newCustomerName.trim();
    if (!trimmedName) {
      toast.error('اسم العميل مطلوب / Customer name is required');
      return;
    }
    const discVal = parseFloat(newCustomerDiscount) || 0;
    if (discVal < 0 || discVal > 100) {
      toast.error('نسبة الخصم غير صحيحة / Invalid discount percentage');
      return;
    }
    try {
      setCreatingCustomer(true);
      const customerType = newCustomerType;
      const res = await fetch('/api/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: trimmedName,
          type: customerType,
          discountPercentage: discVal,
          phone: newCustomerPhone.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'فشل في إنشاء العميل / Failed to create customer');
      }
      const created: Customer = await res.json();
      // Refresh customers list
      await fetchCustomers();
      // Close dialog and reset form
      setNewCustomerDialogOpen(false);
      setNewCustomerName('');
      setNewCustomerDiscount('');
      setNewCustomerPhone('');
      setNewCustomerType('CASH');
      // Auto-select the new customer
      handleUpdateCustomer(created.id);
      setCustomerSearchOpen(false);
      setCustomerSearchValue('');
      toast.success(`تم إنشاء العميل: ${created.name} / Customer created: ${created.name}`);
    } catch (error: any) {
      toast.error(error.message || 'فشل في إنشاء العميل / Failed to create customer');
    } finally {
      setCreatingCustomer(false);
    }
  };

  // ─── Payment row handlers ──────────────────────────────────────

  const handleAddPaymentRow = () => {
    if (salesChannel === 'PLATFORM') return; // No payment rows for platform
    const usedMethods = paymentRows.map((p) => p.method);
    const availableMethod = HALL_PAYMENT_METHODS.find((m) => !usedMethods.includes(m)) || 'CASH';
    setPaymentRows([...paymentRows, { method: availableMethod, amount: 0 }]);
  };

  const handleRemovePaymentRow = (index: number) => {
    if (paymentRows.length <= 1) return;
    setPaymentRows(paymentRows.filter((_, i) => i !== index));
  };

  const handleUpdatePaymentRow = (index: number, field: 'method' | 'amount', value: string | number) => {
    const updated = [...paymentRows];
    if (field === 'method') {
      updated[index] = { ...updated[index], method: value as string };
    } else {
      updated[index] = { ...updated[index], amount: Number(value) || 0 };
    }
    setPaymentRows(updated);
  };

  // ─── Auto-fill cash payment ─────────────────────────────────────

  const handleAutoFillCash = () => {
    const totalOtherPayments = paymentRows
      .filter(r => r.method !== 'CASH' && r.method !== 'CREDIT')
      .reduce((sum, p) => sum + p.amount, 0);
    const cashNeeded = Math.max(0, invoiceTotal - totalOtherPayments);
    const roundedCashNeeded = round2(cashNeeded);
    setPaymentRows(prev => {
      // Remove any CREDIT row since we're paying with cash only
      const withoutCredit = prev.filter(r => r.method !== 'CREDIT');
      const cashIndex = withoutCredit.findIndex(r => r.method === 'CASH');
      if (cashIndex >= 0) {
        const updated = [...withoutCredit];
        updated[cashIndex] = { ...updated[cashIndex], amount: roundedCashNeeded };
        return updated;
      }
      return [{ method: 'CASH', amount: roundedCashNeeded }, ...withoutCredit];
    });
  };

  // ─── Call Finalize API ─────────────────────────────────────────

  const callFinalizeApi = async (): Promise<boolean> => {
    if (!selectedInvoice || finalized) return true;

    try {
      setFinalizing(true);
      // Auto-calculate CREDIT amount for the API: invoiceTotal - non-CREDIT payments
      // Non-CREDIT rows keep their entered amounts; CREDIT rows get auto-filled
      const paymentsForApi = paymentRows.map(p => {
        if (p.method === 'CREDIT') {
          const otherTotal = paymentRows
            .filter(r => r.method !== 'CREDIT')
            .reduce((sum, r) => sum + r.amount, 0);
          return { method: p.method, amount: Math.max(0, invoiceTotal - otherTotal) };
        }
        return { method: p.method, amount: p.amount };
      }).filter(p => p.amount > 0.005);
      const res = await fetch('/api/pos/finalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoiceId: selectedInvoice.id,
          payments: paymentsForApi,
          // Send customerId as fallback in case the invoice doesn't have it saved yet
          customerId: (selectedCustomerId === 'cash' || selectedCustomerId === 'cash_unregistered') ? null : selectedCustomerId,
          customerName: (selectedCustomerId === 'cash' || selectedCustomerId === 'cash_unregistered') ? null : customers.find(c => c.id === selectedCustomerId)?.name || null,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || t.failedToFinalize);
      }

      const finalizedResult: POSInvoice & { payments?: POSInvoicePayment[] } = await res.json();
      setFinalized(true);
      if (receiptData) {
        setReceiptData(finalizedResult);
        setReceiptPayments(finalizedResult.payments || receiptPayments);
      }
      // NOTE: Do NOT show toast here — callers handle success toasts
      // to avoid contradictory duplicate toasts
      return true;
    } catch (error: any) {
      toast.error(error.message || t.failedToFinalize);
      return false;
    } finally {
      setFinalizing(false);
    }
  };

  // ─── Preview Receipt (Finalize = Preview only) ──────────────────

  const handleFinalize = async () => {
    if (!selectedInvoice) return;

    if ((selectedInvoice.items ?? []).length === 0) {
      toast.error(t.noItems);
      return;
    }

    // PLATFORM channel: require customer selection
    if (salesChannel === 'PLATFORM' && !selectedCustomerId) {
      toast.error('يجب اختيار عميل منصة / Platform customer required');
      return;
    }

    const hasCreditPayment = paymentRows.some((p) => p.method === 'CREDIT');
    // For credit payments, auto-fill credit amount = invoiceTotal - nonCreditPayments
    let adjustedPaymentRows = [...paymentRows];
    if (hasCreditPayment) {
      const nonCreditTotalCalc = adjustedPaymentRows
        .filter(p => p.method !== 'CREDIT')
        .reduce((sum, p) => sum + p.amount, 0);
      const creditNeeded = Math.max(0, invoiceTotal - nonCreditTotalCalc);
      adjustedPaymentRows = adjustedPaymentRows.map(r =>
        r.method === 'CREDIT' ? { ...r, amount: creditNeeded } : r
      );
    }
    const adjustedNonCreditTotal = adjustedPaymentRows
      .filter(p => p.method !== 'CREDIT')
      .reduce((sum, p) => sum + p.amount, 0);
    const adjustedCreditTotal = adjustedPaymentRows
      .filter(p => p.method === 'CREDIT')
      .reduce((sum, p) => sum + p.amount, 0);
    const adjustedTotalPaid = adjustedNonCreditTotal + adjustedCreditTotal;
    if (!hasCreditPayment && adjustedTotalPaid < invoiceTotal - 0.01) {
      toast.error(`${t.paid} < ${t.total}. ${t.remaining}: ${formatCurrencyWithSymbol(round2(invoiceTotal - adjustedTotalPaid))}`);
      return;
    }

    // Prepare receipt preview without finalizing
    const previewChangeDue = hasCreditPayment ? 0 : Math.max(0, adjustedTotalPaid - invoiceTotal);
    // Resolve customer name for receipt: use invoice's customerName, or look up from customers array
    const resolvedCustomerName = selectedInvoice?.customerName
      || ((selectedCustomerId !== 'cash' && selectedCustomerId !== 'cash_unregistered') ? customers.find(c => c.id === selectedCustomerId)?.name || null : null);
    const previewInvoice: POSInvoice = {
      ...selectedInvoice,
      customerName: resolvedCustomerName,
      subtotal: invoiceSubtotal,
      discountAmount,
      discountPercentage,
      taxAmount: invoiceTax,
      totalAmount: invoiceTotal,
      paidAmount: adjustedTotalPaid,
      changeAmount: previewChangeDue,
    };
    setReceiptData(previewInvoice);
    setReceiptPayments(adjustedPaymentRows.map((p, i) => ({ id: String(i), invoiceId: selectedInvoice.id, ...p })));
    setPaymentRows(adjustedPaymentRows);
    await fetchCompanyInfo(selectedBranch);
    // Ensure currency symbol is loaded in store before receipt rendering
    await ensureCurrencySymbol();
    setReceiptOpen(true);
    // NOTE: Do NOT show a success toast here — the invoice is NOT finalized yet.
    // Success toasts should only appear after actual finalization in handlePrint/handleCompleteAndClose.
    // Showing one here causes contradictory toasts if finalization later fails.
  };

  // ─── Cancel Invoice ─────────────────────────────────────────────

  const handleCancelInvoice = () => {
    // If in pending state (no invoice created yet), just go back to tables
    if (!selectedInvoice && pendingTable) {
      setPendingTable(null);
      setPosView('tables');
      if (selectedBranch) fetchTables(selectedBranch);
      return;
    }
    if (!selectedInvoice) return;
    // Show supervisor password dialog
    setSupervisorPasswordInput('');
    setSupervisorPasswordError('');
    setSupervisorPasswordOpen(true);
  };

  const handleSupervisorPasswordConfirm = async () => {
    // Verify supervisor password via secure server-side endpoint (password is hashed)
    try {
      const verifyRes = await fetch('/api/settings/verify-supervisor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: supervisorPasswordInput }),
      });
      const verifyData = await verifyRes.json();
      if (!verifyData.valid) {
        setSupervisorPasswordError(t.incorrectPassword);
        return;
      }
    } catch {
      setSupervisorPasswordError(t.incorrectPassword);
      return;
    }

    try {
      setCancelling(true);
      setSupervisorPasswordOpen(false);

      // IMPORTANT: Instead of marking as CANCELLED, DELETE the invoice entirely.
      // Retaining cancelled invoices causes system inconsistencies.
      const invoiceId = selectedInvoice?.id;
      if (!invoiceId) return;

      const res = await fetch(`/api/pos/invoices/${invoiceId}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || t.failedToCancel);
      }

      toast.success(t.invoiceCancelled);
      // Clear invoice state and return to tables
      setSelectedInvoice(null);
      setDiscountPercentage(0);
      setFinalized(false);
      setSalesChannel('HALL');
      setSelectedCustomerId('cash_unregistered');
      setPaymentRows([{ method: 'CASH', amount: 0 }]);
      setNewItemName('');
      setNewItemPrice('');
      setNewItemQty('1');
      setProductSearch('');
      setSelectedCategoryId(null);
      setReceiptOpen(false);
      setReceiptData(null);
      setQrCodeDataUrl('');
      setLogoDataUrl('');
      setPosView('tables');
      if (selectedBranch) {
        fetchTables(selectedBranch);
      }
    } catch (error: any) {
      toast.error(error.message || t.failedToCancel);
    } finally {
      setCancelling(false);
    }
  };

  // ─── Build saved receipt HTML (shared by Print & Complete-and-Close) ─

  const buildSavedReceiptHtml = (): string | null => {
    const printContent = receiptRef.current;
    if (!printContent) return null;

    const rw = printSettings.receiptWidth;
    const fs = printSettings.fontSize;
    const lw = printSettings.logoWidth;
    const lh = printSettings.logoHeight;

    const receiptHtml = printContent.innerHTML;
    const cssStyles = `
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body {
        font-family: 'Cairo', 'Segoe UI', Tahoma, Arial, sans-serif;
        width: ${rw}mm;
        margin: 0 auto;
        padding: 4mm;
        font-size: ${fs}px;
        line-height: 1.5;
        color: #000;
        font-weight: 700;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      .receipt { width: 100%; color: #000; font-weight: 700; font-family: 'Cairo', 'Segoe UI', Tahoma, Arial, sans-serif; }
      .center { text-align: center; }
      .bold { font-weight: 900; }
      .separator { border-top: 1px dashed #000; margin: 3px 0; }
      .single-separator { border-top: 1px solid #000; margin: 3px 0; }
      .double-separator { border-top: 3px solid #000; margin: 3px 0; }
      .logo { width: ${lw}mm; height: ${lh}mm; margin: 0 auto 4px; display: block; object-fit: contain; }
      .company-name { font-size: 16px; font-weight: 900; color: #000; line-height: 1.4; }
      .company-name-en { font-size: 11px; font-weight: 700; color: #000; line-height: 1.3; }
      .company-address { font-size: 10px; font-weight: 700; color: #000; line-height: 1.3; }
      .company-address-en { font-size: 10px; font-weight: 700; color: #000; line-height: 1.3; }
      .company-info { font-size: 10px; font-weight: 700; color: #000; line-height: 1.3; }
      .info-row { display: flex; justify-content: space-between; padding: 1px 0; font-size: 11px; font-weight: 700; color: #000; }
      .info-label { font-weight: 700; }
      .items-header { font-size: 11px; font-weight: 900; margin-bottom: 2px; text-align: center; color: #000; }
      .items-table { width: 100%; border-collapse: collapse; font-size: 11px; }
      .items-table th { font-weight: 900; font-size: 11px; padding: 2px 1px; text-align: right; border-bottom: 2px solid #000; color: #000; }
      .items-table th:nth-child(2) { text-align: center; }
      .items-table th:nth-child(3) { text-align: left; direction: ltr; }
      .items-table td { padding: 2px 1px; vertical-align: top; line-height: 1.3; font-weight: 700; color: #000; }
      .items-table td:nth-child(1) { text-align: right; }
      .items-table td:nth-child(2) { text-align: center; direction: ltr; white-space: nowrap; font-family: 'Roboto Mono', monospace; font-weight: 700; }
      .items-table td:nth-child(3) { text-align: left; direction: ltr; white-space: nowrap; font-family: 'Roboto Mono', monospace; font-weight: 700; }
      .items-table .item-name-ar { font-weight: 700; color: #000; }
      .items-table .item-name-en { display: block; font-size: 8px; color: #111; direction: ltr; font-weight: 700; }
      .totals-row { display: flex; justify-content: space-between; padding: 1px 0; font-size: 11px; font-weight: 700; color: #000; }
      .totals-row.bold { font-weight: 900; font-size: 14px; padding: 2px 0; color: #000; }
      .totals-row.discount { color: #000; font-weight: 900; }
      .tax-sub-label { font-size: 8px; color: #111; font-weight: 700; }
      .payment-header { font-size: 11px; font-weight: 900; margin-bottom: 2px; color: #000; }
      .payment-line { display: flex; justify-content: space-between; padding: 1px 0; font-size: 11px; font-weight: 700; color: #000; }
      .status-line { display: flex; justify-content: space-between; padding: 2px 4px; font-size: 11px; font-weight: 900; border: 2px solid #000; margin: 2px 0; color: #000; }
      .status-paid { background-color: #000; color: #fff; border-color: #000; font-weight: 900; }
      .status-unpaid { background-color: #fff; color: #000; border-color: #000; font-weight: 900; }
      .change-line { font-weight: 900; font-size: 13px; text-align: center; padding: 3px 0; border: 2px solid #000; margin: 2px 0; color: #000; }
      .qr-code { text-align: center; margin: 4px auto; }
      .qr-code img { width: 28mm; height: 28mm; }
      .footer { text-align: center; font-size: 11px; color: #000; margin-top: 4px; line-height: 1.4; font-weight: 700; }
      .footer .en { font-size: 9px; font-weight: 700; }
      .footer-thanks { font-size: 13px; font-weight: 900; color: #000; }
      .footer-en { font-size: 9px; color: #111; font-weight: 700; }
      .footer-wish { font-size: 13px; font-weight: 900; color: #000; }
      .vat-label { font-size: 9px; color: #111; text-align: center; margin-top: 2px; font-weight: 700; }
      .not-posted { text-align:center; font-size:10px; color:#c00; margin-top:4px; border:2px dashed #c00; padding:2px; font-weight:900; }
      .preview-badge { background: #fff3cd; border: 2px solid #ffc107; padding: 2px 4px; font-size: 9px; text-align: center; margin-bottom: 4px; color: #000; font-weight: 900; }
      .bilingual-label { display: flex; flex-direction: column; line-height: 1.2; }
      .bilingual-label .ar { font-size: 11px; font-weight: 700; color: #000; }
      .bilingual-label .en { font-size: 9px; color: #111; font-weight: 700; direction: ltr; text-align: right; }
      @media print {
        body { width: ${rw}mm; margin: 0; padding: 2mm; }
        @page { margin: 0; size: ${rw}mm auto; }
      }
    `;

    // Complete HTML for saving (remove "not-posted" indicator since it's now finalized)
    return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=${rw}mm">
  <title>إيصال ${receiptData?.invoiceNumber || ''}</title>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;900&family=Roboto+Mono:wght@400;500;700&display=swap">
  <style>${cssStyles}</style>
</head>
<body>${receiptHtml.replace(/<div class="not-posted">[\s\S]*?<\/div>/g, '')}</body>
</html>`;
  };

  // ─── Save receipt HTML to invoice (shared helper) ──────────────────

  const saveReceiptHtmlToInvoice = async (invoiceId: string, savedHtml: string) => {
    try {
      await fetch(`/api/pos/invoices/${invoiceId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ receiptHtml: savedHtml }),
      });
    } catch {
      // Silently fail - the receipt operation was still successful
    }
  };

  // ─── Fetch canonical receipt HTML from the server endpoint ─────────
  // This is the SINGLE SOURCE OF TRUTH for receipt generation. The server
  // route (/api/pos/invoices/[id]/receipt) builds the receipt using the
  // shared `receipt-template.ts` with per-branch settings (logo, name,
  // phone, address, VAT, taxRate, header/footer) fetched from the Branch
  // row. By calling this endpoint we guarantee the POS printout matches
  // the Sales Invoices reprint exactly, and that any per-branch overrides
  // are honored. Returns null on any failure so callers can fall back to
  // the client-side `buildSavedReceiptHtml` snapshot.
  const fetchServerReceiptHtml = async (invoiceId: string): Promise<string | null> => {
    try {
      const res = await fetch(`/api/pos/invoices/${invoiceId}/receipt`, {
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
      });
      if (!res.ok) return null;
      const html = await res.text();
      // Basic sanity check — the server route always returns a full HTML doc.
      return html && html.includes('<html') ? html : null;
    } catch {
      return null;
    }
  };

  // ─── Print receipt ──────────────────────────────────────────────

  const handlePrint = async () => {
    // Finalize first if not already done
    // Use a local variable to track finalization state to avoid stale closure issues
    let isFinalized = finalized;
    if (!isFinalized) {
      const success = await callFinalizeApi();
      if (!success) {
        // callFinalizeApi already shows the error toast — don't duplicate
        return;
      }
      isFinalized = true;
      // Wait for React to re-render the receipt with finalized data
      // This ensures the receipt HTML we capture reflects the FINALIZED state
      await new Promise(r => setTimeout(r, 100));
    }

    // SAFETY: Only proceed if invoice was successfully finalized
    if (!isFinalized) {
      return;
    }

    const invoiceId = selectedInvoice?.id;
    if (!invoiceId) return;

    // ─── Fetch the CANONICAL receipt HTML from the server endpoint. ───
    // This guarantees the printout + saved snapshot use per-branch settings
    // (logo, name, phone, address, VAT, taxRate, header/footer) via the
    // shared `receipt-template.ts` — identical to the Sales Invoices reprint
    // path. Falls back to the client-side live preview if the server is
    // unreachable.
    let receiptHtml = await fetchServerReceiptHtml(invoiceId);
    if (!receiptHtml) {
      const fallback = buildSavedReceiptHtml();
      if (!fallback) return;
      receiptHtml = fallback;
    }

    const printWindow = window.open('', '_blank', 'width=320,height=600');
    if (!printWindow) {
      toast.error(t.allowPopups);
      return;
    }

    printWindow.document.write(receiptHtml);
    printWindow.document.close();
    printWindow.focus();

    // Wait for fonts and images to load before printing
    const waitForResources = async () => {
      try {
        await printWindow.document.fonts.ready;
      } catch {
        // Fallback
      }
      const images = printWindow.document.querySelectorAll('img');
      if (images.length > 0) {
        await Promise.all(
          Array.from(images).map(
            (img) =>
              new Promise<void>((resolve) => {
                if (img.complete) resolve();
                else {
                  img.onload = () => resolve();
                  img.onerror = () => resolve();
                }
              })
          )
        );
      }
      await new Promise((r) => setTimeout(r, 200));
      printWindow.print();
      setTimeout(() => { printWindow.close(); }, 1000);
    };

    waitForResources();

    // Save the canonical receipt HTML to the invoice for exact replica
    // reprinting. CRITICAL: This must only happen AFTER successful finalization.
    await saveReceiptHtmlToInvoice(invoiceId, receiptHtml);

    // After print is triggered, close dialog and return to tables with success message
    setReceiptOpen(false);
    setReceiptData(null);
    setQrCodeDataUrl('');
    setLogoDataUrl('');
    toast.success(t.invoiceFinalized);
    handleBackToTables({ skipDraftSave: true });
  };

  // ─── Close receipt dialog (DO NOT finalize - keep as DRAFT) ───────

  const handleCloseReceipt = () => {
    // Close without finalizing - invoice stays as DRAFT
    // NO receipt HTML is saved because finalization was not completed
    setReceiptOpen(false);
    setReceiptData(null);
    setQrCodeDataUrl('');
    setLogoDataUrl('');
    // Return to invoice view (NOT tables) so user can modify
    toast.info(t.noData);
  };

  // ─── Complete & Close (Finalize AND return to tables) ────────────

  const handleCompleteAndClose = async () => {
    // Finalize first if not already done, then close and go back to tables
    // Use a local variable to track finalization state to avoid stale closure issues
    let isFinalized = finalized;
    if (!isFinalized) {
      const success = await callFinalizeApi();
      if (!success) {
        // callFinalizeApi already shows the error toast — don't duplicate
        return;
      }
      isFinalized = true;
      // Wait for React to re-render the receipt with finalized data
      await new Promise(r => setTimeout(r, 100));
    }

    // SAFETY: Only save receipt HTML if invoice was successfully finalized
    if (!isFinalized) {
      return;
    }

    // Save the CANONICAL receipt HTML to the invoice for exact replica
    // reprinting. CRITICAL: This must only happen AFTER successful finalization.
    // We prefer the server-generated HTML (uses per-branch settings via the
    // shared receipt-template.ts) and fall back to the client-side live
    // preview snapshot if the server endpoint is unavailable.
    const invoiceId = selectedInvoice?.id;
    if (invoiceId) {
      let savedHtml = await fetchServerReceiptHtml(invoiceId);
      if (!savedHtml) {
        savedHtml = buildSavedReceiptHtml();
      }
      if (savedHtml) {
        await saveReceiptHtmlToInvoice(invoiceId, savedHtml);
      }
    }

    setReceiptOpen(false);
    setReceiptData(null);
    setQrCodeDataUrl('');
    setLogoDataUrl('');
    toast.success(t.invoiceFinalized);
    handleBackToTables({ skipDraftSave: true });
  };

  // ─── Generate QR code ───────────────────────────────────────────

  useEffect(() => {
    if (receiptOpen && receiptData) {
      // ZATCA QR uses the SELLER's name + VAT number. Both can be overridden
      // per-branch (Branch.name / Branch.vatNumber). Fall back to the global
      // companyInfo values when the branch record doesn't override them.
      const branchForReceipt = branches.find(
        (b) => b.id === (receiptData.branchId || receiptData.branch)
      );
      const effectiveSellerName =
        branchForReceipt?.nameAr ||
        branchForReceipt?.nameEn ||
        companyInfo.companyName ||
        'المطعم';
      const effectiveVatNumber =
        branchForReceipt?.vatNumber || companyInfo.taxNumber || '';
      const qrContent = generateZatcaQR({
        sellerName: effectiveSellerName,
        vatNumber: effectiveVatNumber,
        timestamp: new Date(receiptData.createdAt).toISOString(),
        totalAmount: formatNumber(receiptData.totalAmount),
        vatAmount: formatNumber(receiptData.taxAmount),
      });

      QRCode.toDataURL(qrContent, {
        width: 128,
        margin: 1,
        color: { dark: '#000000', light: '#ffffff' },
      })
        .then((url) => setQrCodeDataUrl(url))
        .catch(() => setQrCodeDataUrl(''));
    }
  }, [receiptOpen, receiptData, companyInfo, branches]);

  // ─── Format helpers ─────────────────────────────────────────────

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleDateString('en-GB', {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
      });
    } catch {
      return dateStr;
    }
  };

  const formatTime = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      });
    } catch {
      return '';
    }
  };

  // Look up branch display name by UUID (selectedBranch / receiptData.branchId hold UUIDs).
  // Resolution order: branch record's own name → localized label for the legacy
  // default branches → display name. Never returns the raw UUID.
  const getBranchName = (id: string | null | undefined): string => {
    if (!id) return '';
    const branch = branches.find((b) => b.id === id);
    if (!branch) return id;
    if (branch.nameAr) return branch.nameAr;
    if (branch.key === 'CHINA_TOWN') return t.branchChinaTown;
    if (branch.key === 'PALACE_INDIA') return t.branchPalaceIndia;
    return branch.name;
  };
  const getBranchNameEn = (id: string | null | undefined): string => {
    if (!id) return '';
    const branch = branches.find((b) => b.id === id);
    if (!branch) return id;
    // Prefer the branch record's own English name; fall back to the legacy
    // hardcoded map for the default branches; finally fall back to display name.
    return branch.nameEn || BRANCH_ENGLISH_NAMES[branch.key] || branch.name;
  };

  // Receipt-specific currency formatter - returns HTML string with embedded currency image
  const receiptCurrency = (amount: number) => {
    const formatted = formatNumber(amount);
    if (currencySymbolUrl) {
      return `${formatted} <img src="${currencySymbolUrl}" alt="ر.س" style="width:10px;height:10px;object-fit:contain;vertical-align:middle;display:inline;" />`;
    }
    return `${formatted} ر.س`;
  };

  // Payment status bilingual text based on payment method
  const getPaymentStatusText = (payments: POSInvoicePayment[]): { text: string; isPaid: boolean } => {
    if (payments.length === 0) return { text: 'مدفوع / Paid', isPaid: true };
    const hasCredit = payments.some(p => p.method === 'CREDIT');
    if (hasCredit) return { text: 'آجل / Unpaid', isPaid: false };
    return { text: 'مدفوع / Paid', isPaid: true };
  };

  const getCategoryColorSet = (index: number) => CATEGORY_COLORS[index % CATEGORY_COLORS.length];

  // ═══════════════════════════════════════════════════════════════
  // RENDER: Loading State
  // ═══════════════════════════════════════════════════════════════

  if (branchesLoading && posView === 'branches') {
    return (
      <div className="flex items-center justify-center min-h-[60vh]" dir="rtl">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="size-8 animate-spin text-emerald-600" />
          <span className="text-muted-foreground text-sm">{t.loading}</span>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════
  // RENDER: View 1 — Branch Selection
  // ═══════════════════════════════════════════════════════════════

  if (posView === 'branches') {
    return (
      <div className="space-y-6" dir="rtl">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
            <Store className="size-5" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-foreground">{t.pos}</h2>
            <p className="text-sm text-muted-foreground">{t.selectBranch}</p>
          </div>
        </div>

        <Separator />

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {branches.map((branch) => (
            <Card
              key={branch.id}
              className="cursor-pointer transition-all duration-200 hover:shadow-lg hover:scale-[1.02] hover:border-emerald-300 dark:hover:border-emerald-700 border-2 group"
              onClick={() => handleSelectBranch(branch.id)}
            >
              <CardContent className="p-6 flex flex-col items-center gap-4">
                <div className="flex size-20 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 group-hover:bg-emerald-200 dark:group-hover:bg-emerald-900/50 transition-colors">
                  <Store className="size-10" />
                </div>
                <div className="text-center">
                  <h3 className="text-xl font-bold text-foreground">
                    {getBranchName(branch.id)}
                  </h3>
                  <p className="text-sm text-muted-foreground mt-1">{branch.name}</p>
                </div>
                <Badge variant="secondary" className="bg-emerald-100 text-emerald-700 border-emerald-200 hover:bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-800">
                  <UtensilsCrossed className="size-3 ml-1" />
                  {t.tables}
                </Badge>
              </CardContent>
            </Card>
          ))}
        </div>

        {branches.length === 0 && !branchesLoading && (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Store className="size-16 mb-4 opacity-30" />
            <p className="text-lg">{t.noData}</p>
            <p className="text-sm mt-1">{t.noData}</p>
          </div>
        )}
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════
  // RENDER: View 2 — Tables
  // ═══════════════════════════════════════════════════════════════

  if (posView === 'tables') {
    return (
      <div className="space-y-6" dir="rtl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={handleBackToBranches} className="gap-1 text-muted-foreground hover:text-foreground">
              <ArrowRight className="size-4" />
              {t.branches}
            </Button>
            <Separator orientation="vertical" className="h-6" />
            <div className="flex size-9 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <UtensilsCrossed className="size-4" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-foreground">{getBranchName(selectedBranch)}</h2>
              <p className="text-xs text-muted-foreground">{t.tables}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => { fetchPastInvoices(selectedBranch); setPosView('invoices'); }}>
              <ClipboardList className="size-3.5" />
              {t.invoices}
            </Button>
            <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => { fetchPastInvoices(selectedBranch); setPosView('returns'); }}>
              <RotateCcw className="size-3.5" />
              {t.returns}
            </Button>
            <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => handleDailyReport(selectedBranch)} disabled={dailyReportLoading}>
              {dailyReportLoading ? <Loader2 className="size-3.5 animate-spin" /> : <FileBarChart className="size-3.5" />}
              {t.dailyReport}
            </Button>
            <Button
              variant={activeShift ? 'default' : 'destructive'}
              size="sm"
              className="gap-1.5 text-xs"
              onClick={() => setShiftDialogOpen(true)}
            >
              <Wallet className="size-3.5" />
              {activeShift ? t.shiftManagement : t.openShift}
            </Button>
            <Badge variant="outline" className="text-emerald-700 border-emerald-300 dark:text-emerald-400 dark:border-emerald-700">
              {tables.filter((tbl) => tbl.isActive).length} {t.tables}
            </Badge>
          </div>
        </div>

        <Separator />

        {tablesLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="size-8 animate-spin text-emerald-600" />
              <span className="text-muted-foreground text-sm">{t.loading}</span>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {tables
              .filter((t) => t.isActive)
              .sort((a, b) => a.sortOrder - b.sortOrder)
              .map((table) => {
                const draft = draftByTable.get(table.id);
                // Table is occupied only if it has a DRAFT invoice with items.
                // An empty DRAFT (no items) should NOT mark a table as occupied.
                // pendingTable is always null when tables view is rendered (cleared on navigation)
                const isOccupied = !!(draft && draft.items && draft.items.length > 0);

                return (
                  <Card
                    key={table.id}
                    className={`cursor-pointer transition-all duration-200 hover:shadow-lg hover:scale-[1.03] border-2 ${
                      isOccupied
                        ? 'border-orange-300 bg-orange-50 dark:border-orange-700 dark:bg-orange-950/20'
                        : 'border-emerald-300 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-950/20'
                    }`}
                    onClick={() => {
                      if (creatingInvoice) return;
                      if (draft) {
                        // Open existing draft (even if empty — reuse it instead of creating a new one)
                        handleSelectOccupiedTable(draft);
                      } else {
                        handleSelectFreeTable(table);
                      }
                    }}
                  >
                    <CardContent className="p-4 flex flex-col items-center gap-2">
                      <div className={`size-3 rounded-full ${isOccupied ? 'bg-orange-500' : 'bg-emerald-500'}`} />
                      <span className="text-lg font-bold text-foreground">{table.name}</span>
                      <span className={`text-xs font-medium ${isOccupied ? 'text-orange-600 dark:text-orange-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                        {isOccupied ? t.occupiedTable : t.freeTable}
                      </span>
                      {isOccupied && draft && (
                        <div className="text-center mt-1">
                          <p className="text-xs font-mono text-foreground"><CurrencyAmount amount={draft.totalAmount} symbolClassName="w-3 h-3" /></p>
                          <p className="text-xs text-muted-foreground">{(draft.items ?? []).length} {t.items}</p>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
          </div>
        )}

        {!tablesLoading && tables.filter((tbl) => tbl.isActive).length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <UtensilsCrossed className="size-16 mb-4 opacity-30" />
            <p className="text-lg">{t.noData}</p>
            <p className="text-sm mt-1">{t.noData}</p>
          </div>
        )}

        {creatingInvoice && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="size-8 animate-spin text-emerald-600" />
              <span className="text-foreground font-medium">{t.creatingInvoice}</span>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════
  // RENDER: View 2a — Past Invoices List (for reprinting)
  // ═══════════════════════════════════════════════════════════════

  if (posView === 'invoices') {
    const filteredPastInvoices = invoiceSearchQuery
      ? pastInvoices.filter(inv =>
          inv.invoiceNumber.toLowerCase().includes(invoiceSearchQuery.toLowerCase()) ||
          (inv.customerName && inv.customerName.includes(invoiceSearchQuery))
        )
      : pastInvoices;

    const statusBadge = (status: string) => {
      switch (status) {
        case 'DRAFT':
          return <Badge variant="secondary" className="text-xs bg-yellow-100 text-yellow-800 border-yellow-300 dark:bg-yellow-950/30 dark:text-yellow-400 dark:border-yellow-800">{t.draft}</Badge>;
        case 'FINALIZED':
          return <Badge variant="secondary" className="text-xs bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-800">{t.posted}</Badge>;
        case 'CANCELLED':
          return <Badge variant="secondary" className="text-xs bg-red-100 text-red-800 border-red-300 dark:bg-red-950/30 dark:text-red-400 dark:border-red-800">{t.cancelled}</Badge>;
        case 'RETURNED':
          return <Badge variant="secondary" className="text-xs bg-orange-100 text-orange-800 border-orange-300 dark:bg-orange-950/30 dark:text-orange-400 dark:border-orange-800">{t.returned}</Badge>;
        default:
          return <Badge variant="secondary" className="text-xs">{status}</Badge>;
      }
    };

    return (
      <div className="space-y-4" dir="rtl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => handleBackToTables()} className="gap-1 text-muted-foreground hover:text-foreground">
              <ArrowRight className="size-4" />
              {t.tables}
            </Button>
            <Separator orientation="vertical" className="h-6" />
            <div className="flex size-9 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <ClipboardList className="size-4" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-foreground">{t.invoices} {getBranchName(selectedBranch)}</h2>
              <p className="text-xs text-muted-foreground">{t.reprint}</p>
            </div>
          </div>
          <Badge variant="secondary">{pastInvoices.length} {t.invoice}</Badge>
        </div>

        <div className="relative">
          <Search className="absolute right-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            placeholder={t.searchInvoices}
            value={invoiceSearchQuery}
            onChange={(e) => setInvoiceSearchQuery(e.target.value)}
            className="pr-8"
          />
        </div>

        {pastInvoicesLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="size-8 animate-spin text-emerald-600" />
          </div>
        ) : filteredPastInvoices.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <FileText className="size-16 mb-4 opacity-30" />
            <p className="text-lg">{t.noInvoices}</p>
          </div>
        ) : (
          <ScrollArea className="h-[calc(100vh-16rem)]">
            <div className="space-y-2">
              {filteredPastInvoices.map((inv) => (
                <Card key={inv.id} className={`border ${inv.isReturn ? 'border-red-300 bg-red-50/50 dark:border-red-700 dark:bg-red-950/20' : inv.status === 'RETURNED' ? 'border-orange-300 bg-orange-50/50 dark:border-orange-700 dark:bg-orange-950/20' : inv.status === 'CANCELLED' ? 'border-red-200 bg-red-50/30 dark:border-red-800 dark:bg-red-950/10' : inv.status === 'DRAFT' ? 'border-yellow-300 bg-yellow-50/50 dark:border-yellow-700 dark:bg-yellow-950/20' : 'border-border'}`}>
                  <CardContent className="p-3 flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold font-mono">{inv.invoiceNumber}</span>
                        {statusBadge(inv.status)}
                        {inv.isReturn && (
                          <Badge variant="destructive" className="text-xs gap-1">
                            <RotateCcw className="size-3" />
                            {t.returnLabel}
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                        <span>{new Date(inv.createdAt).toLocaleDateString('en-GB')} {new Date(inv.createdAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</span>
                        {inv.customerName && <span>• {inv.customerName}</span>}
                        <span>• {(inv.items ?? []).length} {t.items}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-sm font-bold text-foreground">
                        <CurrencyAmount amount={inv.totalAmount} symbolClassName="w-3.5 h-3.5" />
                      </span>
                      {(inv.status === 'DRAFT' || inv.status === 'CANCELLED') && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="gap-1 text-xs text-red-600 hover:text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30"
                          onClick={() => { setDeletingInvoiceData(inv); setDeleteConfirmOpen(true); }}
                          disabled={deletingInvoice}
                        >
                          <Trash2 className="size-3.5" />
                          {t.delete}
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1 text-xs"
                        onClick={() => handleReprint(inv)}
                      >
                        <Printer className="size-3.5" />
                        {t.print}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </ScrollArea>
        )}

        {/* Delete confirmation dialog */}
        <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
          <AlertDialogContent dir="rtl">
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <AlertTriangle className="size-5 text-red-500" />
                {t.confirmDeleteInvoice}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t.confirmDeleteInvoiceMessage}
              </AlertDialogDescription>
            </AlertDialogHeader>
            {deletingInvoiceData && (
              <div className="p-3 rounded-lg border bg-red-50 dark:bg-red-950/30 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{t.invoiceNumber}</span>
                  <span className="font-mono font-bold">{deletingInvoiceData.invoiceNumber}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{t.invoiceStatus}</span>
                  <span>{statusBadge(deletingInvoiceData.status)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{t.invoiceTotal}</span>
                  <span className="font-bold"><CurrencyAmount amount={deletingInvoiceData.totalAmount} symbolClassName="w-3.5 h-3.5" /></span>
                </div>
              </div>
            )}
            <AlertDialogFooter className="gap-2">
              <AlertDialogCancel disabled={deletingInvoice}>{t.cancel}</AlertDialogCancel>
              <AlertDialogAction
                className="bg-red-600 hover:bg-red-700 text-white"
                onClick={() => deletingInvoiceData && handleDeleteInvoice(deletingInvoiceData.id)}
                disabled={deletingInvoice}
              >
                {deletingInvoice ? <Loader2 className="size-4 animate-spin ml-2" /> : <Trash2 className="size-4 ml-2" />}
                {t.delete}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════
  // RENDER: View 2b — Returns Section
  // ═══════════════════════════════════════════════════════════════

  if (posView === 'returns') {
    const returnableInvoices = pastInvoices.filter(inv => inv.status === 'FINALIZED' && !inv.isReturn);
    const returnedInvoices = pastInvoices.filter(inv => inv.isReturn || inv.status === 'RETURNED');
    const filteredReturnable = invoiceSearchQuery
      ? returnableInvoices.filter(inv =>
          inv.invoiceNumber.toLowerCase().includes(invoiceSearchQuery.toLowerCase()) ||
          (inv.customerName && inv.customerName.includes(invoiceSearchQuery))
        )
      : returnableInvoices;

    return (
      <div className="space-y-4" dir="rtl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => handleBackToTables()} className="gap-1 text-muted-foreground hover:text-foreground">
              <ArrowRight className="size-4" />
              {t.tables}
            </Button>
            <Separator orientation="vertical" className="h-6" />
            <div className="flex size-9 items-center justify-center rounded-lg bg-red-500/10 text-red-600 dark:text-red-400">
              <RotateCcw className="size-4" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-foreground">{t.returns} - {getBranchName(selectedBranch)}</h2>
              <p className="text-xs text-muted-foreground">{t.selectBranch}</p>
            </div>
          </div>
        </div>

        <div className="relative">
          <Search className="absolute right-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            placeholder={t.searchInvoices}
            value={invoiceSearchQuery}
            onChange={(e) => setInvoiceSearchQuery(e.target.value)}
            className="pr-8"
          />
        </div>

        {pastInvoicesLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="size-8 animate-spin text-red-600" />
          </div>
        ) : (
          <ScrollArea className="h-[calc(100vh-16rem)]">
            {/* Already returned invoices */}
            {returnedInvoices.length > 0 && (
              <div className="mb-4">
                <h3 className="text-sm font-bold text-muted-foreground mb-2">{t.returns}</h3>
                <div className="space-y-1">
                  {returnedInvoices.map((inv) => (
                    <Card key={inv.id} className="border-red-200 bg-red-50/30 dark:border-red-800 dark:bg-red-950/10">
                      <CardContent className="p-2.5 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <RotateCcw className="size-4 text-red-500" />
                          <span className="text-sm font-mono font-bold">{inv.invoiceNumber}</span>
                          {inv.isReturn && inv.originalInvoiceId && (
                            <span className="text-xs text-muted-foreground">{t.returnLabel}</span>
                          )}
                          {inv.status === 'RETURNED' && (
                            <Badge variant="outline" className="text-xs border-orange-300 text-orange-700">{t.returned}</Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-red-600">
                            -<CurrencyAmount amount={inv.totalAmount} symbolClassName="w-3.5 h-3.5" />
                          </span>
                          <Button variant="ghost" size="sm" className="gap-1 text-xs" onClick={() => handleReprint(inv)}>
                            <Printer className="size-3" />
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {/* Returnable invoices */}
            <h3 className="text-sm font-bold text-muted-foreground mb-2">{t.invoices}</h3>
            {filteredReturnable.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <AlertTriangle className="size-16 mb-4 opacity-30" />
                <p className="text-lg">{t.noInvoices}</p>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredReturnable.map((inv) => (
                  <Card key={inv.id} className="border hover:border-red-300 dark:hover:border-red-700 transition-colors">
                    <CardContent className="p-3 flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold font-mono">{inv.invoiceNumber}</span>
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                          <span>{new Date(inv.createdAt).toLocaleDateString('en-GB')} {new Date(inv.createdAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</span>
                          {inv.customerName && <span>• {inv.customerName}</span>}
                          <span>• {(inv.items ?? []).length} {t.items}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="text-sm font-bold text-foreground">
                          <CurrencyAmount amount={inv.totalAmount} symbolClassName="w-3.5 h-3.5" />
                        </span>
                        <Button
                          variant="destructive"
                          size="sm"
                          className="gap-1 text-xs"
                          onClick={() => { setReturningInvoice(inv); setReturnConfirmOpen(true); }}
                        >
                          <RotateCcw className="size-3.5" />
                          {t.confirmReturn}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="gap-1 text-xs"
                          onClick={() => handleReprint(inv)}
                        >
                          <Printer className="size-3.5" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </ScrollArea>
        )}

        {/* Return confirmation dialog */}
        <Dialog open={returnConfirmOpen} onOpenChange={setReturnConfirmOpen}>
          <DialogContent dir="rtl" className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <AlertTriangle className="size-5 text-red-500" />
                {t.confirmReturn}
              </DialogTitle>
              <DialogDescription className="sr-only">تأكيد مرتجع الفاتورة</DialogDescription>
            </DialogHeader>
            {returningInvoice && (
              <div className="space-y-4 pt-2">
                <div className="p-3 rounded-lg border bg-red-50 dark:bg-red-950/30 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{t.invoiceNumber}</span>
                    <span className="font-mono font-bold">{returningInvoice.invoiceNumber}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{t.customer}</span>
                    <span>{returningInvoice.customerName || t.cashCustomer}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{t.total}</span>
                    <span className="font-bold text-red-600">
                      <CurrencyAmount amount={returningInvoice.totalAmount} symbolClassName="w-3.5 h-3.5" />
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{t.items}</span>
                    <span>{(returningInvoice.items ?? []).length}</span>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">
                  {t.confirmReturnMessage}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="destructive"
                    className="flex-1 gap-2"
                    onClick={() => handleCreateReturn(returningInvoice.id)}
                    disabled={returning}
                  >
                    {returning ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}
                    {returning ? t.loading : t.confirmReturn}
                  </Button>
                  <Button variant="outline" onClick={() => { setReturnConfirmOpen(false); setReturningInvoice(null); }} disabled={returning}>
                    {t.cancel}
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════
  // RENDER: View 2c — Daily Report
  // ═══════════════════════════════════════════════════════════════

  if (posView === 'daily-report' && dailyReport) {
    const paymentEntries = Object.entries(dailyReport.paymentBreakdown || {});
    const invoiceList: any[] = dailyReport.invoiceList || [];
    const customerBalances: any[] = dailyReport.customerBalances || [];
    const avgInvoice = dailyReport.avgInvoiceValue || 0;

    return (
      <div className="space-y-4" dir="rtl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => handleBackToTables()} className="gap-1 text-muted-foreground hover:text-foreground">
              <ArrowRight className="size-4" />
              {t.tables}
            </Button>
            <Separator orientation="vertical" className="h-6" />
            <div className="flex size-9 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <FileBarChart className="size-4" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-foreground">{t.dailyReport} - {dailyReport.branchName || getBranchName(selectedBranch)}</h2>
              <p className="text-xs text-muted-foreground">
                {new Date(dailyReport.dayStart).toLocaleDateString('en-GB')} {new Date(dailyReport.dayStart).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                {' — '}
                {new Date(dailyReport.dayEnd).toLocaleDateString('en-GB')} {new Date(dailyReport.dayEnd).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={handlePrintDailyReport}>
            <Printer className="size-3.5" />
            {t.print}
          </Button>
        </div>

        <Separator />

        {/* Enhanced Summary Cards - Row 1 */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <Card className="border-emerald-200 dark:border-emerald-800">
            <CardContent className="p-3">
              <p className="text-[10px] text-muted-foreground mb-0.5">إجمالي المبيعات / Total Sales</p>
              <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400"><CurrencyAmount amount={dailyReport.sales.total} bold /></p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{dailyReport.sales.count} {t.invoice}</p>
            </CardContent>
          </Card>
          {dailyReport.returns.count > 0 && (
            <Card className="border-red-200 dark:border-red-800">
              <CardContent className="p-3">
                <p className="text-[10px] text-muted-foreground mb-0.5">إجمالي المرتجعات / Total Returns</p>
                <p className="text-lg font-bold text-red-600 dark:text-red-400"><CurrencyAmount amount={dailyReport.returns.total} bold /></p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{dailyReport.returns.count} {t.returnLabel}</p>
              </CardContent>
            </Card>
          )}
          <Card className={`border-2 ${dailyReport.returns.count > 0 ? 'border-primary' : 'border-emerald-200 dark:border-emerald-800'}`}>
            <CardContent className="p-3">
              <p className="text-[10px] text-muted-foreground mb-0.5">صافي المبيعات / Net Sales</p>
              <p className="text-xl font-bold text-primary"><CurrencyAmount amount={dailyReport.net.total} bold /></p>
              <p className="text-[10px] text-muted-foreground mt-0.5">ضريبة: <CurrencyAmount amount={dailyReport.net.tax} symbolClassName="w-2.5 h-2.5" /></p>
            </CardContent>
          </Card>
          <Card className="border-amber-200 dark:border-amber-800">
            <CardContent className="p-3">
              <div className="flex items-center gap-1 mb-0.5">
                <Percent className="size-3 text-amber-500" />
                <p className="text-[10px] text-muted-foreground">إجمالي الخصم / Discount Total</p>
              </div>
              <p className="text-lg font-bold text-amber-600 dark:text-amber-400"><CurrencyAmount amount={dailyReport.sales.discount} bold /></p>
            </CardContent>
          </Card>
          <Card className="border-sky-200 dark:border-sky-800">
            <CardContent className="p-3">
              <div className="flex items-center gap-1 mb-0.5">
                <ReceiptText className="size-3 text-sky-500" />
                <p className="text-[10px] text-muted-foreground">إجمالي الضريبة / Tax Total</p>
              </div>
              <p className="text-lg font-bold text-sky-600 dark:text-sky-400"><CurrencyAmount amount={dailyReport.sales.tax} bold /></p>
            </CardContent>
          </Card>
          <Card className="border-teal-200 dark:border-teal-800">
            <CardContent className="p-3">
              <div className="flex items-center gap-1 mb-0.5">
                <Calculator className="size-3 text-teal-500" />
                <p className="text-[10px] text-muted-foreground">متوسط الفاتورة / Avg Invoice</p>
              </div>
              <p className="text-lg font-bold text-teal-600 dark:text-teal-400"><CurrencyAmount amount={avgInvoice} bold /></p>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Payment Breakdown */}
          <Card>
            <CardContent className="p-4">
              <h3 className="text-sm font-bold mb-3">طرق الدفع / Payment Methods</h3>
              <div className="space-y-2">
                {paymentEntries.map(([method, data]: [string, any]) => (
                  <div key={method} className="flex items-center justify-between text-sm">
                    <span>{PAYMENT_METHOD_BILINGUAL[method] || method}</span>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="text-xs">{data.count}</Badge>
                      <span className="font-bold"><CurrencyAmount amount={data.amount} symbolClassName="w-3 h-3" /></span>
                    </div>
                  </div>
                ))}
                {paymentEntries.length === 0 && <p className="text-xs text-muted-foreground">{t.noData}</p>}
              </div>
            </CardContent>
          </Card>

          {/* Top Items */}
          <Card>
            <CardContent className="p-4">
              <h3 className="text-sm font-bold mb-3">أكثر الأصناف مبيعاً / Top Items</h3>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {(dailyReport.topItems || []).slice(0, 10).map((item: any) => (
                  <div key={item.name} className="flex items-center justify-between text-sm">
                    <span className="truncate flex-1">{item.name}</span>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant="secondary" className="text-xs">{item.quantity}</Badge>
                      <span className="font-bold text-xs"><CurrencyAmount amount={item.total} symbolClassName="w-2.5 h-2.5" /></span>
                    </div>
                  </div>
                ))}
                {(dailyReport.topItems || []).length === 0 && <p className="text-xs text-muted-foreground">{t.noItems}</p>}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Customer Balances Section */}
        {customerBalances.length > 0 && (
          <Card className="border-orange-200 dark:border-orange-800">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <Users className="size-4 text-orange-500" />
                <h3 className="text-sm font-bold">أرصدة العملاء / Customer Balances</h3>
              </div>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                <div className="grid grid-cols-4 gap-2 text-[10px] font-bold text-muted-foreground pb-1 border-b">
                  <span>العميل / Customer</span>
                  <span>النوع / Type</span>
                  <span className="text-center">آجل الفترة / Period Credit</span>
                  <span className="text-center">الرصيد الحالي / Current Balance</span>
                </div>
                {customerBalances.map((cb: any) => (
                  <div key={cb.customerId} className="grid grid-cols-4 gap-2 text-sm py-1.5 border-b border-dashed last:border-0">
                    <span className="font-medium truncate">{cb.customerName}</span>
                    <span>
                      <Badge variant={cb.type === 'PLATFORM' ? 'default' : 'secondary'} className="text-[10px]">
                        {cb.type === 'PLATFORM' ? 'منصة / Platform' : 'نقدي / Cash'}
                      </Badge>
                    </span>
                    <span className="text-center font-bold text-orange-600 dark:text-orange-400">
                      <CurrencyAmount amount={cb.creditTotal} symbolClassName="w-3 h-3" />
                    </span>
                    <span className="text-center font-bold">
                      <CurrencyAmount amount={cb.currentBalance} symbolClassName="w-3 h-3" />
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Enhanced Invoice List */}
        <Card>
          <CardContent className="p-4">
            <h3 className="text-sm font-bold mb-3">قائمة الفواتير / Invoices ({invoiceList.length})</h3>
            <div className="space-y-2 max-h-[60vh] overflow-y-auto">
              {invoiceList.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-4">{t.noInvoices}</p>
              )}
              {invoiceList.map((inv: any) => {
                const isExpanded = expandedInvoiceId === inv.id;
                const invoiceDate = new Date(inv.createdAt);
                const invItems: any[] = inv.items || [];
                const invPayments: any[] = inv.payments || [];
                return (
                  <div key={inv.id} className={`rounded-lg border transition-colors ${inv.isReturn ? 'border-red-300 dark:border-red-700 bg-red-50/50 dark:bg-red-950/20' : 'border-border hover:border-muted-foreground/30'}`}>
                    {/* Invoice Header Row */}
                    <button
                      type="button"
                      className="w-full flex items-center justify-between p-3 text-start cursor-pointer"
                      onClick={() => setExpandedInvoiceId(isExpanded ? null : inv.id)}
                    >
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        {inv.isReturn && <RotateCcw className="size-3.5 text-red-500 shrink-0" />}
                        <span className="font-mono text-xs font-bold shrink-0">{inv.invoiceNumber}</span>
                        <span className="text-[10px] text-muted-foreground shrink-0">
                          {invoiceDate.toLocaleDateString('en-GB')} {invoiceDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        {inv.customerName && <span className="text-xs text-muted-foreground truncate">• {inv.customerName}</span>}
                        {inv.tableName && <Badge variant="outline" className="text-[10px] h-4 shrink-0">{inv.tableName}</Badge>}
                        <Badge variant={inv.customerType === 'PLATFORM' ? 'default' : 'secondary'} className="text-[10px] h-4 shrink-0">
                          {inv.customerType === 'PLATFORM' ? 'منصة' : 'نقدي'}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`font-bold text-sm ${inv.isReturn ? 'text-red-600' : ''}`}>
                          {inv.isReturn ? '-' : ''}<CurrencyAmount amount={inv.totalAmount} symbolClassName="w-3 h-3" />
                        </span>
                        {isExpanded ? <ChevronUp className="size-4 text-muted-foreground" /> : <ChevronDown className="size-4 text-muted-foreground" />}
                      </div>
                    </button>

                    {/* Expanded Details */}
                    {isExpanded && (
                      <div className="px-3 pb-3 pt-0 space-y-3">
                        <Separator />

                        {/* Items Table */}
                        {invItems.length > 0 && (
                          <div>
                            <p className="text-[10px] font-bold text-muted-foreground mb-1.5">الأصناف / Items</p>
                            <div className="rounded border overflow-hidden">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="bg-muted/50">
                                    <th className="text-start p-1.5 font-medium">الصنف / Item</th>
                                    <th className="text-center p-1.5 font-medium w-16">الكمية / Qty</th>
                                    <th className="text-center p-1.5 font-medium w-20">السعر / Price</th>
                                    <th className="text-end p-1.5 font-medium w-20">المبلغ / Total</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {invItems.map((item: any, idx: number) => (
                                    <tr key={idx} className="border-t border-dashed">
                                      <td className="p-1.5">{item.name}{item.nameEn ? <span className="text-muted-foreground text-[10px]"> / {item.nameEn}</span> : ''}</td>
                                      <td className="text-center p-1.5">{formatNumber(item.quantity)}</td>
                                      <td className="text-center p-1.5"><CurrencyAmount amount={item.unitPrice} symbolClassName="w-2.5 h-2.5" /></td>
                                      <td className="text-end p-1.5 font-bold"><CurrencyAmount amount={item.totalPrice} symbolClassName="w-2.5 h-2.5" /></td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}

                        {/* Financial Summary Row */}
                        <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
                          <div>
                            <span className="text-muted-foreground">المجموع الفرعي / Subtotal: </span>
                            <span className="font-bold"><CurrencyAmount amount={inv.subtotal} symbolClassName="w-2.5 h-2.5" /></span>
                          </div>
                          {inv.discountPercentage > 0 && (
                            <div className="text-amber-600 dark:text-amber-400">
                              <span className="text-muted-foreground">خصم / Discount: </span>
                              <span className="font-bold">{inv.discountPercentage}% = <CurrencyAmount amount={inv.discountAmount} symbolClassName="w-2.5 h-2.5" /></span>
                            </div>
                          )}
                          <div className="text-sky-600 dark:text-sky-400">
                            <span className="text-muted-foreground">ضريبة / VAT: </span>
                            <span className="font-bold"><CurrencyAmount amount={inv.taxAmount} symbolClassName="w-2.5 h-2.5" /></span>
                          </div>
                          <div className={inv.isReturn ? 'text-red-600 font-bold' : 'font-bold'}>
                            <span className="text-muted-foreground">الإجمالي / Total: </span>
                            <span><CurrencyAmount amount={inv.totalAmount} symbolClassName="w-2.5 h-2.5" /></span>
                          </div>
                        </div>

                        {/* Payment Methods */}
                        {invPayments.length > 0 && (
                          <div className="flex flex-wrap gap-2">
                            <span className="text-[10px] text-muted-foreground">طرق الدفع:</span>
                            {invPayments.map((p: any, idx: number) => (
                              <Badge key={idx} variant="outline" className="text-[10px] h-5 gap-1">
                                {PAYMENT_METHOD_BILINGUAL[p.method] || p.method}
                                <span className="font-bold"><CurrencyAmount amount={p.amount} symbolClassName="w-2 h-2" /></span>
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════
  // RENDER: View 3 — Invoice (SPLIT SCREEN)
  // Left: Product categories → products grid
  // Right: Invoice data (items, totals, payment)
  // ═══════════════════════════════════════════════════════════════

  // ─── Computed: Effective per-branch receipt info ─────────────────
  // Used by the live receipt preview Dialog. Branch overrides take
  // precedence over the global companyInfo values; the global values
  // are the fallback when a branch hasn't configured its own field.
  // This mirrors the resolution logic in src/lib/receipt-template.ts
  // (generateReceiptContentHtml) so the live preview matches the
  // server-generated snapshot.
  const receiptBranchId = receiptData?.branchId || receiptData?.branch || selectedBranch;
  const receiptBranchRecord = receiptBranchId
    ? branches.find((b) => b.id === receiptBranchId)
    : undefined;
  const effectiveReceiptLogo = receiptBranchRecord?.logo || logoDataUrl || '';
  const effectiveReceiptCompanyName =
    receiptBranchRecord?.nameAr || companyInfo.companyName || 'المطعم';
  const effectiveReceiptCompanyNameEn =
    receiptBranchRecord?.nameEn || companyInfo.companyNameEn || 'Restaurant';
  const effectiveReceiptPhone = receiptBranchRecord?.phone || companyInfo.phone || '';
  const effectiveReceiptAddress = receiptBranchRecord?.address || companyInfo.address || '';
  const effectiveReceiptAddressEn = receiptBranchRecord?.addressEn || companyInfo.addressEn || '';
  const effectiveReceiptTaxNumber =
    receiptBranchRecord?.vatNumber || companyInfo.taxNumber || '';
  const effectiveReceiptHeader = receiptBranchRecord?.receiptHeader || '';
  const effectiveReceiptFooter = receiptBranchRecord?.receiptFooter || '';
  // Effective tax rate for the receipt's VAT label.
  // Branch override → global setting → 0.15 (Saudi default).
  const receiptTaxRateFraction: number =
    receiptBranchRecord?.taxRate != null && Number.isFinite(receiptBranchRecord.taxRate)
      ? receiptBranchRecord.taxRate / 100
      : companyInfo.taxRate != null && Number.isFinite(companyInfo.taxRate)
        ? companyInfo.taxRate / 100
        : TAX_RATE;
  const receiptTaxRatePct = receiptTaxRateFraction * 100;
  const receiptTaxRateDisplay = Number.isInteger(receiptTaxRatePct)
    ? String(receiptTaxRatePct)
    : receiptTaxRatePct.toFixed(2).replace(/\.?0+$/, '');

  return (
    <div className="h-[calc(100vh-8rem)] flex flex-col relative" dir="rtl">
      {/* Top Bar */}
      <div className="shrink-0 flex items-center justify-between px-4 py-2 border-b bg-background">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => handleBackToTables()} className="gap-1 text-muted-foreground hover:text-foreground">
            <ArrowRight className="size-4" />
            {t.tables}
          </Button>
          <Separator orientation="vertical" className="h-5" />
          {selectedInvoice?.invoiceNumber ? (
            <Badge variant="outline" className="text-xs font-mono">
              {selectedInvoice.invoiceNumber}
            </Badge>
          ) : pendingTable ? (
            <Badge variant="outline" className="text-xs font-mono text-amber-600 border-amber-300">
              جديد / New
            </Badge>
          ) : null}
          {(selectedInvoice?.table || pendingTable) && (
            <Badge variant="secondary" className="text-xs gap-1">
              <UtensilsCrossed className="size-3" />
              {t.tables} {selectedInvoice?.table?.name || pendingTable?.name}
            </Badge>
          )}
          <Badge variant="secondary" className="text-xs">
            {getBranchName(selectedBranch)}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="destructive" size="sm" onClick={handleCancelInvoice} disabled={cancelling} className="gap-1">
            {cancelling ? <Loader2 className="size-3.5 animate-spin" /> : <XCircle className="size-3.5" />}
            {t.cancel}
          </Button>
        </div>
      </div>

      {/* Main Content — Split Layout */}
      <div className="flex-1 flex overflow-hidden">

        {/* ═══════════════════════════════════════════════════════ */}
        {/* RIGHT SIDE (in RTL) — Products Grid 60%                */}
        {/* ═══════════════════════════════════════════════════════ */}
        <div className="w-[60%] flex flex-col border-l overflow-hidden bg-muted/20">
          {/* Search Bar */}
          <div className="p-3 border-b bg-background shrink-0">
            <div className="flex items-center gap-2">
              <div className="flex-1 relative">
                <Search className="absolute right-2.5 top-2.5 size-4 text-muted-foreground" />
                <Input
                  placeholder={t.searchProducts}
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                  className="h-9 pr-8"
                />
              </div>
              <Button variant="outline" size="sm" className="h-9 gap-1.5 shrink-0" onClick={() => setManualAddOpen(true)}>
                <Plus className="size-4" />
                {t.addManualItem}
              </Button>
            </div>
          </div>

          {/* Products Area */}
          <ScrollArea className="flex-1">
            <div className="p-3">
              {productSearch ? (
                /* ─── Search Results ─── */
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <Search className="size-4 text-muted-foreground" />
                    <span className="text-sm font-medium text-muted-foreground">
                      {t.search} ({searchFilteredProducts.length})
                    </span>
                  </div>
                  {searchFilteredProducts.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                      <Search className="size-10 mb-2 opacity-30" />
                      <p className="text-sm">{t.noData}</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                      {searchFilteredProducts.map((product) => (
                        <Card
                          key={product.id}
                          className="cursor-pointer transition-all hover:shadow-md hover:scale-[1.02] border hover:border-emerald-400"
                          onClick={() => handleAddProduct(product)}
                        >
                          <CardContent className="p-3 text-center">
                            <p className="text-sm font-medium text-foreground truncate">{product.name}</p>
                            <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400 mt-1">
                              <CurrencyAmount amount={product.price} symbolClassName="w-3 h-3" />
                            </p>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  )}
                </div>
              ) : selectedCategoryId ? (
                /* ─── Products inside selected category ─── */
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1 h-7 text-xs"
                      onClick={() => setSelectedCategoryId(null)}
                    >
                      <ChevronLeft className="size-3.5" />
                      {t.allCategories}
                    </Button>
                    <Separator orientation="vertical" className="h-5" />
                    <span className="text-sm font-bold text-foreground">
                      {selectedCategory?.icon && <span className="ml-1">{selectedCategory.icon}</span>}
                      {selectedCategory?.name}
                    </span>
                    <Badge variant="secondary" className="text-xs">
                      {filteredProducts.length} {t.items}
                    </Badge>
                  </div>

                  {filteredProducts.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                      <Grid3X3 className="size-10 mb-2 opacity-30" />
                      <p className="text-sm">{t.noItems}</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                      {filteredProducts.map((product) => (
                        <Card
                          key={product.id}
                          className="cursor-pointer transition-all hover:shadow-md hover:scale-[1.02] border hover:border-emerald-400"
                          onClick={() => handleAddProduct(product)}
                        >
                          <CardContent className="p-3 text-center">
                            <p className="text-sm font-medium text-foreground truncate">{product.name}</p>
                            <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400 mt-1">
                              <CurrencyAmount amount={product.price} symbolClassName="w-3 h-3" />
                            </p>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                /* ─── Main Categories Grid ─── */
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <Grid3X3 className="size-4 text-muted-foreground" />
                    <span className="text-sm font-medium text-muted-foreground">{t.allCategories}</span>
                  </div>

                  {categories.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                      <Grid3X3 className="size-10 mb-2 opacity-30" />
                      <p className="text-sm">{t.noData}</p>
                      <p className="text-xs mt-1">{t.noData}</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                      {categories
                        .sort((a, b) => a.sortOrder - b.sortOrder)
                        .map((category, index) => {
                          const colorSet = getCategoryColorSet(index);
                          const productCount = products.filter(p => p.categoryId === category.id).length;

                          return (
                            <Card
                              key={category.id}
                              className={`cursor-pointer transition-all hover:shadow-lg hover:scale-[1.03] border-2 ${colorSet.border} ${colorSet.light}`}
                              onClick={() => setSelectedCategoryId(category.id)}
                            >
                              <CardContent className="p-4 flex flex-col items-center gap-2">
                                <span className="text-3xl">
                                  {category.icon || CATEGORY_ICONS[index % CATEGORY_ICONS.length]}
                                </span>
                                <span className={`text-sm font-bold ${colorSet.text}`}>
                                  {category.name}
                                </span>
                                <Badge variant="secondary" className="text-xs bg-background/60">
                                  {productCount} {t.items}
                                </Badge>
                              </CardContent>
                            </Card>
                          );
                        })}
                    </div>
                  )}
                </div>
              )}
            </div>
          </ScrollArea>
        </div>

        {/* ═══════════════════════════════════════════════════════ */}
        {/* LEFT SIDE (in RTL) — Invoice Data 40%                  */}
        {/* ═══════════════════════════════════════════════════════ */}
        <div className="w-[40%] flex flex-col overflow-hidden bg-background">
          {/* Sales Channel Toggle */}
          <div className="shrink-0 p-3 border-b bg-muted/30">
            <div className="flex gap-1">
              <Button
                variant={salesChannel === 'HALL' ? 'default' : 'outline'}
                size="sm"
                className={`flex-1 h-9 text-sm font-bold gap-1.5 transition-all ${
                  salesChannel === 'HALL'
                    ? 'bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-600'
                    : 'border-emerald-300 text-emerald-700 dark:text-emerald-400 dark:border-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/30'
                }`}
                onClick={() => {
                  setSalesChannel('HALL');
                  setSelectedCustomerId('cash_unregistered');
                  setPaymentRows([{ method: 'CASH', amount: 0 }]);
                  // Reset customer on invoice
                  if (selectedInvoice) {
                    fetch(`/api/pos/invoices/${selectedInvoice.id}`, {
                      method: 'PUT',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ customerId: null, customerName: null }),
                    }).catch(() => {});
                  }
                }}
              >
                <Store className="size-4" />
                صالة (Hall)
              </Button>
              <Button
                variant={salesChannel === 'PLATFORM' ? 'default' : 'outline'}
                size="sm"
                className={`flex-1 h-9 text-sm font-bold gap-1.5 transition-all ${
                  salesChannel === 'PLATFORM'
                    ? 'bg-amber-600 hover:bg-amber-700 text-white border-amber-600'
                    : 'border-amber-300 text-amber-700 dark:text-amber-400 dark:border-amber-700 hover:bg-amber-50 dark:hover:bg-amber-950/30'
                }`}
                onClick={() => {
                  setSalesChannel('PLATFORM');
                  setSelectedCustomerId('');
                  setPaymentRows([{ method: 'CREDIT', amount: 0 }]);
                  // Reset customer on invoice
                  if (selectedInvoice) {
                    fetch(`/api/pos/invoices/${selectedInvoice.id}`, {
                      method: 'PUT',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ customerId: null, customerName: null }),
                    }).catch(() => {});
                  }
                }}
              >
                <CreditCard className="size-4" />
                منصات (Platforms)
              </Button>
            </div>
          </div>

          {/* Invoice Items */}
          <div className="flex-1 overflow-hidden flex flex-col">
            <div className="p-3 border-b shrink-0">
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-foreground">{t.items}</span>
                <Badge variant="secondary" className="text-xs">
                  {(selectedInvoice?.items ?? []).length} {t.items}
                </Badge>
              </div>
            </div>

            <ScrollArea className="flex-1">
              {(selectedInvoice?.items ?? []).length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
                  <Receipt className="size-10 mb-2 opacity-30" />
                  <p className="text-sm">{t.noItems}</p>
                  <p className="text-xs mt-1">{t.noData}</p>
                </div>
              ) : (
                <div className="p-2 space-y-1">
                  {(selectedInvoice?.items ?? []).map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center gap-2 p-2 rounded-lg border bg-muted/30 hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{item.name}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-xs text-muted-foreground">
                            <CurrencyAmount amount={item.unitPrice} symbolClassName="w-3 h-3" /> × {item.quantity}
                          </span>
                          <span className="text-xs font-bold text-foreground">
                            <CurrencyAmount amount={item.totalPrice} symbolClassName="w-3 h-3" />
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          variant="outline"
                          size="icon"
                          className="size-6"
                          disabled={updatingItem === item.id || item.quantity <= 1}
                          onClick={() => handleUpdateItem(item.id, 'quantity', item.quantity - 1)}
                        >
                          <Minus className="size-3" />
                        </Button>
                        <span className="w-6 text-center text-sm font-bold">{item.quantity}</span>
                        <Button
                          variant="outline"
                          size="icon"
                          className="size-6"
                          disabled={updatingItem === item.id}
                          onClick={() => handleUpdateItem(item.id, 'quantity', item.quantity + 1)}
                        >
                          <Plus className="size-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-6 text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30"
                          disabled={updatingItem === item.id}
                          onClick={() => handleDeleteItem(item.id)}
                        >
                          <Trash2 className="size-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>

          {/* Invoice Summary & Payment */}
          <div className="shrink-0 border-t bg-muted/30">
            {/* Totals */}
            <div className="p-3 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">{t.subtotal}</span>
                <span className="font-medium"><CurrencyAmount amount={invoiceSubtotal} symbolClassName="w-3.5 h-3.5" /></span>
              </div>

              {/* Discount */}
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-muted-foreground shrink-0">{t.discount}</span>
                <div className="flex items-center gap-1">
                  <Input
                    type="number"
                    min="0"
                    max={maxDiscountPercentage > 0 ? maxDiscountPercentage : 100}
                    step="0.1"
                    value={discountPercentage || ''}
                    onChange={(e) => handleUpdateDiscount(parseFloat(e.target.value) || 0)}
                    className="h-7 w-20 text-sm text-left"
                    placeholder="0"
                    readOnly={isCashCustomerDiscountLocked}
                    disabled={isCashCustomerDiscountLocked}
                  />
                  <span className="text-xs text-muted-foreground">%</span>
                  {isCashCustomerDiscountLocked && (
                    <span className="text-[10px] text-amber-600 dark:text-amber-400" title="خصم العميل النقدي - تلقائي من شاشة العملاء / Cash customer discount - auto from customer profile">🔒</span>
                  )}
                  {maxDiscountPercentage > 0 && (
                    <span className="text-[9px] text-amber-600 dark:text-amber-400 whitespace-nowrap">≤{maxDiscountPercentage}%</span>
                  )}
                  {discountAmount > 0 && (
                    <span className="text-xs text-muted-foreground">(<CurrencyAmount amount={discountAmount} symbolClassName="w-3 h-3" />)</span>
                  )}
                </div>
              </div>

              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">{t.tax} (15%)</span>
                <span className="font-medium"><CurrencyAmount amount={invoiceTax} symbolClassName="w-3.5 h-3.5" /></span>
              </div>

              <Separator />

              <div className="flex justify-between text-base font-bold">
                <span>{t.total}</span>
                <span className="text-emerald-600 dark:text-emerald-400"><CurrencyAmount amount={invoiceTotal} symbolClassName="w-4 h-4" bold /></span>
              </div>
            </div>

            <Separator />

            {/* Customer Selection - Searchable Combobox */}
            <div className="px-3 pt-2">
              <div className="flex items-center gap-2">
                <User className="size-4 text-muted-foreground shrink-0" />
                <Popover open={customerSearchOpen} onOpenChange={(open) => { setCustomerSearchOpen(open); if (!open) setCustomerSearchValue(''); }}>
                  <PopoverTrigger asChild>
                    <button
                      role="combobox"
                      aria-expanded={customerSearchOpen}
                      aria-controls="customer-search-list"
                      className="flex h-8 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1"
                    >
                      <span className="truncate">
                        {selectedCustomerId === 'cash_unregistered'
                          ? (salesChannel === 'HALL' ? 'عميل نقدي غير مسجل / Unregistered Cash' : t.customer)
                          : (() => {
                              const c = customers.find(c => c.id === selectedCustomerId);
                              return c ? `${c.name}${c.phone ? ` - ${c.phone}` : ''}${c.discountPercentage > 0 ? ` (${c.discountPercentage}% ${t.discount})` : ''}` : t.customer;
                            })()
                        }
                      </span>
                      <Search className="ml-1 size-3.5 shrink-0 opacity-50" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[280px] p-0" align="start" sideOffset={4}>
                    <Command shouldFilter={false}>
                      <CommandInput
                        placeholder={salesChannel === 'HALL' ? 'بحث بالاسم أو الهاتف... / Search by name or phone...' : 'بحث بالاسم أو الهاتف... / Search by name or phone...'}
                        value={customerSearchValue}
                        onValueChange={setCustomerSearchValue}
                      />
                      <CommandList id="customer-search-list">
                        <CommandEmpty>لا يوجد نتائج / No results found</CommandEmpty>
                        {salesChannel === 'HALL' && (
                          <CommandGroup>
                            <CommandItem
                              value="cash_unregistered"
                              onSelect={() => { handleUpdateCustomer('cash_unregistered'); setCustomerSearchOpen(false); setCustomerSearchValue(''); }}
                              className={selectedCustomerId === 'cash_unregistered' ? 'bg-accent' : ''}
                            >
                              <Check className={`mr-2 size-4 ${selectedCustomerId === 'cash_unregistered' ? 'opacity-100' : 'opacity-0'}`} />
                              <span>عميل نقدي غير مسجل / Unregistered Cash</span>
                            </CommandItem>
                          </CommandGroup>
                        )}
                        {salesChannel === 'HALL' && (() => {
                          const filtered = hallCustomers.filter(c => {
                            const q = customerSearchValue.toLowerCase();
                            if (!q) return true;
                            return c.name.toLowerCase().includes(q)
                              || (c.nameEn && c.nameEn.toLowerCase().includes(q))
                              || (c.phone && c.phone.includes(q));
                          });
                          return filtered.length > 0 ? (
                            <CommandGroup heading="عملاء نقديين مسجلين / Registered Cash Customers">
                              {filtered.map((c) => (
                                <CommandItem
                                  key={c.id}
                                  value={c.id}
                                  onSelect={() => { handleUpdateCustomer(c.id); setCustomerSearchOpen(false); setCustomerSearchValue(''); }}
                                  className={selectedCustomerId === c.id ? 'bg-accent' : ''}
                                >
                                  <Check className={`mr-2 size-4 shrink-0 ${selectedCustomerId === c.id ? 'opacity-100' : 'opacity-0'}`} />
                                  <div className="flex flex-col">
                                    <span className="text-sm">{c.name}{c.discountPercentage > 0 ? ` (${c.discountPercentage}% ${t.discount})` : ''}</span>
                                    {c.phone && <span className="text-xs text-muted-foreground">{c.phone}</span>}
                                  </div>
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          ) : customerSearchValue && hallCustomers.length > 0 ? (
                            <CommandGroup>
                              <CommandItem disabled>لا يوجد نتائج / No matching customers</CommandItem>
                            </CommandGroup>
                          ) : null;
                        })()}
                        {salesChannel === 'PLATFORM' && (() => {
                          const filtered = platformCustomers.filter(c => {
                            const q = customerSearchValue.toLowerCase();
                            if (!q) return true;
                            return c.name.toLowerCase().includes(q)
                              || (c.nameEn && c.nameEn.toLowerCase().includes(q))
                              || (c.phone && c.phone.includes(q));
                          });
                          return filtered.length > 0 ? (
                            <CommandGroup heading="عملاء المنصة / Platform Customers">
                              {filtered.map((c) => (
                                <CommandItem
                                  key={c.id}
                                  value={c.id}
                                  onSelect={() => { handleUpdateCustomer(c.id); setCustomerSearchOpen(false); setCustomerSearchValue(''); }}
                                  className={selectedCustomerId === c.id ? 'bg-accent' : ''}
                                >
                                  <Check className={`mr-2 size-4 shrink-0 ${selectedCustomerId === c.id ? 'opacity-100' : 'opacity-0'}`} />
                                  <div className="flex flex-col">
                                    <span className="text-sm">{c.name}{c.discountPercentage > 0 ? ` (${c.discountPercentage}% ${t.discount})` : ''}</span>
                                    {c.phone && <span className="text-xs text-muted-foreground">{c.phone}</span>}
                                  </div>
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          ) : (
                            <CommandGroup>
                              <CommandItem disabled>لا يوجد عملاء منصات / No platform customers</CommandItem>
                            </CommandGroup>
                          );
                        })()}
                        {/* Create New Customer option */}
                        <CommandGroup heading="إضافة عميل جديد / New Customer">
                          <CommandItem
                            value="__create_customer__"
                            onSelect={() => {
                              setNewCustomerType(salesChannel === 'PLATFORM' ? 'PLATFORM' : 'CASH');
                              setNewCustomerDialogOpen(true);
                              setCustomerSearchOpen(false);
                              setCustomerSearchValue('');
                            }}
                            className="text-emerald-700 dark:text-emerald-400"
                          >
                            <Plus className="mr-2 size-4" />
                            <span className="text-sm font-medium">إنشاء عميل جديد / Create New Customer</span>
                          </CommandItem>
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="size-8 shrink-0"
                  onClick={() => {
                    setNewCustomerType(salesChannel === 'PLATFORM' ? 'PLATFORM' : 'CASH');
                    setNewCustomerDialogOpen(true);
                  }}
                  title="إنشاء عميل جديد / Create New Customer"
                >
                  <Plus className="size-4" />
                </Button>
              </div>
              {salesChannel === 'PLATFORM' && !selectedCustomerId && (
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-1 mr-6">
                  ⚠ يجب اختيار عميل منصة / Platform customer required
                </p>
              )}
            </div>

            <Separator />

            {/* Multi-Payment Section */}
            {salesChannel === 'PLATFORM' ? (
              /* PLATFORM: Show credit info instead of payment section */
              <div className="p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold text-foreground">{t.paymentMethod}</span>
                </div>
                <div className="flex items-center justify-between px-2 py-1.5 rounded bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
                  <span className="text-sm font-bold text-amber-700 dark:text-amber-300">آجل / Credit</span>
                  <span className="text-sm font-bold text-amber-800 dark:text-amber-200">
                    <CurrencyAmount amount={invoiceTotal} symbolClassName="w-3.5 h-3.5" />
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">مبيعات المنصات آجل تلقائياً / Platform sales are automatically credit</p>
              </div>
            ) : (
              /* HALL: Show full payment section */
              <div className="p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-foreground">{t.paymentMethod}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs gap-1"
                  onClick={handleAddPaymentRow}
                  disabled={paymentRows.length >= HALL_PAYMENT_METHODS.length}
                >
                  <Plus className="size-3" />
                  {t.addPayment}
                </Button>
              </div>

              {paymentRows.map((row, index) => (
                <div key={row.method} className="flex items-center gap-1.5">
                  <Select
                    value={row.method}
                    onValueChange={(value) => handleUpdatePaymentRow(index, 'method', value)}
                  >
                    <SelectTrigger className="h-8 text-xs w-28">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {HALL_PAYMENT_METHODS.map((method) => (
                        <SelectItem key={method} value={method}>
                          {PAYMENT_METHOD_LABELS[method]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={row.amount || ''}
                    onChange={(e) => handleUpdatePaymentRow(index, 'amount', e.target.value)}
                    className="h-8 text-sm text-left flex-1"
                    placeholder="0.00"
                  />
                  <CurrencySymbol className="w-4 h-4 shrink-0" />
                  {paymentRows.length > 1 && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 shrink-0 text-red-500 hover:text-red-700"
                      onClick={() => handleRemovePaymentRow(index)}
                    >
                      <XCircle className="size-3.5" />
                    </Button>
                  )}
                </div>
              ))}

              {/* Auto-fill cash button */}
              <Button
                variant="outline"
                size="sm"
                className="w-full h-7 text-xs gap-1"
                onClick={handleAutoFillCash}
              >
                <Calculator className="size-3" />
                {t.cash}
              </Button>

              {/* Payment Summary */}
              <div className="space-y-1 pt-1">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{t.paid}</span>
                  <span className="font-medium"><CurrencyAmount amount={totalPaid} symbolClassName="w-3.5 h-3.5" /></span>
                </div>
                {remaining > 0.01 ? (
                  <div className="flex justify-between text-sm text-red-600 dark:text-red-400">
                    <span>{t.remaining}</span>
                    <span className="font-bold"><CurrencyAmount amount={remaining} symbolClassName="w-3.5 h-3.5" /></span>
                  </div>
                ) : totalPaid > 0.01 ? (
                  <div className="flex items-center justify-center text-sm font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 rounded px-2 py-1 gap-1">
                    <Check className="size-3.5" />
                    مدفوع بالكامل / PAID IN FULL
                  </div>
                ) : null}
                {changeDue > 0 && (
                  <div className="flex justify-between text-sm font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 rounded px-2 py-1">
                    <span>{t.changeDue}</span>
                    <span><CurrencyAmount amount={changeDue} symbolClassName="w-3.5 h-3.5" /></span>
                  </div>
                )}
              </div>
            </div>
            )}

            {/* Finalize Button */}
            <div className="p-3 pt-0">
              <Button
                className="w-full h-11 text-base font-bold gap-2"
                onClick={handleFinalize}
                disabled={finalizing || (selectedInvoice?.items ?? []).length === 0}
              >
                {finalizing ? (
                  <Loader2 className="size-5 animate-spin" />
                ) : (
                  <Receipt className="size-5" />
                )}
                {finalizing ? t.finalizingInvoice : t.printReceipt}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════ */}
      {/* Manual Add Dialog                                       */}
      {/* ═══════════════════════════════════════════════════════ */}
      <Dialog open={manualAddOpen} onOpenChange={setManualAddOpen}>
        <DialogContent dir="rtl" className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t.addManualItem}</DialogTitle>
            <DialogDescription className="sr-only">إضافة صنف يدوي</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label>{t.itemName}</Label>
              <Input
                value={newItemName}
                onChange={(e) => setNewItemName(e.target.value)}
                placeholder="مثال: بيتزا مارغريتا"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t.itemPrice}</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={newItemPrice}
                  onChange={(e) => setNewItemPrice(e.target.value)}
                  placeholder="0.00"
                />
              </div>
              <div className="space-y-2">
                <Label>{t.itemQuantity}</Label>
                <Input
                  type="number"
                  min="1"
                  value={newItemQty}
                  onChange={(e) => setNewItemQty(e.target.value)}
                  placeholder="1"
                />
              </div>
            </div>
            <Button
              className="w-full gap-2"
              onClick={handleAddManualItem}
              disabled={addingItem}
            >
              {addingItem ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              {t.add}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ═══════════════════════════════════════════════════════ */}
      {/* Create Customer Dialog (Inline from POS)                 */}
      {/* ═══════════════════════════════════════════════════════ */}
      <Dialog open={newCustomerDialogOpen} onOpenChange={(open) => {
        setNewCustomerDialogOpen(open);
        if (!open) {
          setNewCustomerName('');
          setNewCustomerDiscount('');
          setNewCustomerPhone('');
        }
      }}>
        <DialogContent dir="rtl" className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>إنشاء عميل جديد / Create New Customer</DialogTitle>
            <DialogDescription className="sr-only">Create a new customer with discount</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            {/* Customer Name */}
            <div className="space-y-2">
              <Label htmlFor="new-customer-name">اسم العميل / Customer Name *</Label>
              <Input
                id="new-customer-name"
                placeholder="أدخل اسم العميل / Enter customer name"
                value={newCustomerName}
                onChange={(e) => setNewCustomerName(e.target.value)}
                autoFocus
              />
            </div>

            {/* Discount Percentage */}
            <div className="space-y-2">
              <Label htmlFor="new-customer-discount">نسبة الخصم / Discount Percentage (%)</Label>
              <div className="relative">
                <Input
                  id="new-customer-discount"
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  placeholder="0"
                  value={newCustomerDiscount}
                  onChange={(e) => setNewCustomerDiscount(e.target.value)}
                  className="pr-8"
                />
                <Percent className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
              </div>
            </div>

            {/* Phone */}
            <div className="space-y-2">
              <Label htmlFor="new-customer-phone">رقم الهاتف / Phone</Label>
              <Input
                id="new-customer-phone"
                placeholder="05XXXXXXXX"
                value={newCustomerPhone}
                onChange={(e) => setNewCustomerPhone(e.target.value)}
                dir="ltr"
              />
            </div>

            {/* Customer Type */}
            <div className="space-y-2">
              <Label>نوع العميل / Customer Type</Label>
              <Select value={newCustomerType} onValueChange={(v) => setNewCustomerType(v as 'CASH' | 'PLATFORM')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CASH">نقدي / Cash</SelectItem>
                  <SelectItem value="PLATFORM">منصة / Platform</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Create Button */}
            <Button
              className="w-full"
              onClick={handleCreateCustomerInline}
              disabled={creatingCustomer || !newCustomerName.trim()}
            >
              {creatingCustomer ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  جاري الإنشاء... / Creating...
                </>
              ) : (
                <>
                  <Plus className="mr-2 size-4" />
                  إنشاء العميل / Create Customer
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ═══════════════════════════════════════════════════════ */}
      {/* Thermal Receipt Dialog (80mm format)                     */}
      {/* ═══════════════════════════════════════════════════════ */}
      <Dialog open={receiptOpen} onOpenChange={setReceiptOpen}>
        <DialogContent dir="rtl" className="sm:max-w-[420px] p-0 gap-0 overflow-hidden flex flex-col">
          <DialogHeader className="sr-only">
            <DialogTitle>{t.receipt}</DialogTitle>
            <DialogDescription className="sr-only">معاينة الإيصال الحراري</DialogDescription>
          </DialogHeader>

          {/* Receipt Content — thermal format (bilingual Arabic/English) */}
          <ScrollArea className="flex-1 overflow-auto">
          <div ref={receiptRef} className="receipt" style={{ padding: '4mm', fontSize: `${printSettings.fontSize}px`, lineHeight: '1.5', color: '#000', width: `${printSettings.receiptWidth}mm`, overflowX: 'hidden', boxSizing: 'border-box' }}>
            {/* Logo — prefer the branch's own logo, fall back to the global logo */}
            {effectiveReceiptLogo && (
              <div className="center" style={{ marginBottom: '4px' }}>
                <img src={effectiveReceiptLogo} alt="شعار / Logo" className="logo" style={{ width: `${printSettings.logoWidth}mm`, height: `${printSettings.logoHeight}mm`, objectFit: 'contain' }} />
              </div>
            )}

            {/* Company Name - Arabic then English (branch override → global) */}
            <div className="center">
              <div className="company-name">{effectiveReceiptCompanyName}</div>
              <div className="company-name-en">{effectiveReceiptCompanyNameEn}</div>
            </div>

            {/* Address - Arabic then English (branch override → global) */}
            {(effectiveReceiptAddress || effectiveReceiptAddressEn) && (
              <div className="center">
                {effectiveReceiptAddress && <div className="company-address">{effectiveReceiptAddress}</div>}
                {effectiveReceiptAddressEn && <div className="company-address-en">{effectiveReceiptAddressEn}</div>}
              </div>
            )}

            {effectiveReceiptPhone && (
              <div className="center">
                <div className="company-info">هاتف / {effectiveReceiptPhone} :Tel</div>
              </div>
            )}

            {effectiveReceiptTaxNumber && (
              <div className="center">
                <div className="company-info">الرقم الضريبي / {effectiveReceiptTaxNumber} .:VAT No</div>
              </div>
            )}

            {/* Info rows: Branch, Invoice, Date, Time, Table, Customer */}
            <div className="info-row">
              <span>الفرع / Branch</span>
              <span>{receiptData ? getBranchNameEn(receiptData.branchId || receiptData.branch) : ''}</span>
            </div>
            {effectiveReceiptPhone && (
              <div className="info-row">
                <span>هاتف / Phone</span>
                <span>{effectiveReceiptPhone}</span>
              </div>
            )}
            <div className="info-row">
              <span>فاتورة / Invoice</span>
              <span>{receiptData?.invoiceNumber}</span>
            </div>
            <div className="info-row">
              <span>التاريخ / Date</span>
              <span>{receiptData ? formatDate(receiptData.createdAt) : ''}</span>
            </div>
            <div className="info-row">
              <span>الوقت / Time</span>
              <span>{receiptData ? formatTime(receiptData.createdAt) : ''}</span>
            </div>
            {receiptData?.table && (
              <div className="info-row">
                <span>الطاولة / Table</span>
                <span>{receiptData.table.name}</span>
              </div>
            )}
            <div className="info-row">
              <span>العميل / Customer</span>
              <span>{receiptData?.customerName || ((selectedCustomerId !== 'cash' && selectedCustomerId !== 'cash_unregistered') ? customers.find(c => c.id === selectedCustomerId)?.name || t.cashCustomerLabel : t.cashCustomerLabel)}</span>
            </div>

            <div className="double-separator" />

            {/* Branch custom receipt header (optional — shown above the items table) */}
            {effectiveReceiptHeader && (
              <div className="center" style={{ fontSize: '12px', fontWeight: 700, padding: '4px 0' }}>{effectiveReceiptHeader}</div>
            )}

            {/* Items Table - organized columns */}
            <table className="items-table">
              <thead>
                <tr>
                  <th>الصنف / Item</th>
                  <th>الكمية / Qty</th>
                  <th>المبلغ / Amount</th>
                </tr>
              </thead>
              <tbody>
                {(receiptData?.items ?? []).map((item, idx) => {
                  const product = item.productId ? products.find(p => p.id === item.productId) : null;
                  const itemNameEn = item.nameEn || product?.nameEn;
                  return (
                    <tr key={item.id}>
                      <td>
                        <span className="item-name-ar">{item.name}</span>
                        {itemNameEn && <span className="item-name-en">{itemNameEn}</span>}
                      </td>
                      <td>{item.quantity}</td>
                      <td>
                        <span dangerouslySetInnerHTML={{ __html: receiptCurrency(item.totalPrice) }} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <div className="single-separator" />

            {/* Subtotal */}
            <div className="totals-row">
              <span>المجموع الفرعي / Subtotal</span>
              <span dangerouslySetInnerHTML={{ __html: receiptCurrency(receiptData?.subtotal || 0) }} />
            </div>

            {/* Discount - show both percentage and amount */}
            {(receiptData?.discountAmount ?? 0) > 0 && (
              <div className="totals-row discount">
                <span>خصم {receiptData?.discountPercentage ?? discountPercentage}% / Discount {receiptData?.discountPercentage ?? discountPercentage}%</span>
                <span dangerouslySetInnerHTML={{ __html: `-${receiptCurrency(receiptData?.discountAmount || 0)}` }} />
              </div>
            )}

            {/* Tax — uses the branch's effective tax rate (branch override → global → 0.15) */}
            <div className="totals-row">
              <span>ضريبة القيمة المضافة {receiptTaxRateDisplay}% / VAT {receiptTaxRateDisplay}%</span>
              <span dangerouslySetInnerHTML={{ __html: receiptCurrency(receiptData?.taxAmount || 0) }} />
            </div>

            <div className="double-separator" />

            {/* Total */}
            <div className="totals-row bold">
              <span>الإجمالي / TOTAL</span>
              <span dangerouslySetInnerHTML={{ __html: receiptCurrency(receiptData?.totalAmount || 0) }} />
            </div>

            <div className="double-separator" />

            {/* Payment Method Section */}
            <div className="payment-header">طريقة الدفع / Payment</div>
            {receiptPayments.map((payment) => (
              <div key={payment.id || payment.method} className="payment-line">
                <span>{PAYMENT_METHOD_BILINGUAL[payment.method] || PAYMENT_METHOD_LABELS[payment.method as PaymentMethod] || payment.method}</span>
                <span dangerouslySetInnerHTML={{ __html: receiptCurrency(payment.amount) }} />
              </div>
            ))}

            {/* Paid */}
            <div className="totals-row">
              <span>المدفوع / Paid</span>
              <span dangerouslySetInnerHTML={{ __html: receiptCurrency(receiptData?.paidAmount || 0) }} />
            </div>

            {/* Status with color coding */}
            {(() => {
              const ps = getPaymentStatusText(receiptPayments);
              return (
                <div className={`status-line ${ps.isPaid ? 'status-paid' : 'status-unpaid'}`}>
                  <span>حالة الدفع / Status</span>
                  <span>{ps.text}</span>
                </div>
              );
            })()}

            {/* Change Due */}
            {(receiptData?.changeAmount ?? 0) > 0 && (
              <div className="change-line">
                الباقي / Change: <span dangerouslySetInnerHTML={{ __html: receiptCurrency(receiptData?.changeAmount || 0) }} />
              </div>
            )}

            <div className="single-separator" />

            {/* QR Code */}
            {qrCodeDataUrl && (
              <div className="qr-code">
                <img src={qrCodeDataUrl} alt="رمز الاستجابة السريعة / QR Code" />
              </div>
            )}

            {effectiveReceiptTaxNumber && (
              <div className="vat-label">فاتورة ضريبية - الرقم الضريبي: {effectiveReceiptTaxNumber}<br/>Tax Invoice - VAT No.: {effectiveReceiptTaxNumber}</div>
            )}

            {/* Footer — shows the branch's custom receiptFooter if set, otherwise the default thank-you message */}
            <div className="footer">
              {effectiveReceiptFooter ? (
                <>
                  <div className="footer-thanks">شكراً لزيارتكم</div>
                  <div className="footer-thanks-en">Thank you for visiting</div>
                  <div style={{ fontSize: '11px', fontWeight: 700, marginTop: '4px', paddingTop: '4px', borderTop: '1px dashed #000' }}>{effectiveReceiptFooter}</div>
                </>
              ) : (
                <div className="footer-thanks">شكراً - Thank you for visiting</div>
              )}
            </div>

            {/* Not-posted indicator */}
            {!finalized && (
              <div className="not-posted">
                ⚠ معاينة - لم يتم الترحيل بعد / Preview - Not yet posted
              </div>
            )}
          </div>
          </ScrollArea>

          {/* Action Buttons - Complete, Print, and Close */}
          <div className="flex gap-2 p-3 border-t">
            {!finalized && (
              <Button className="flex-1 gap-2" onClick={handleCompleteAndClose} disabled={finalizing}>
                {finalizing ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                {finalizing ? t.finalizingInvoice : 'إتمام / Complete'}
              </Button>
            )}
            <Button className="flex-1 gap-2" onClick={handlePrint} disabled={finalizing}>
              {finalizing ? <Loader2 className="size-4 animate-spin" /> : <Printer className="size-4" />}
              {finalizing ? t.finalizingInvoice : t.printReceipt}
            </Button>
            <Button variant="outline" className="flex-1 gap-2" onClick={handleCloseReceipt} disabled={finalizing}>
              <XCircle className="size-4" />
              {t.close}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Supervisor Password Dialog */}
      <Dialog open={supervisorPasswordOpen} onOpenChange={setSupervisorPasswordOpen}>
        <DialogContent className="sm:max-w-sm" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-center justify-center">
              <Shield className="size-5 text-amber-500" />
              {t.confirmCancel}
            </DialogTitle>
            <DialogDescription className="sr-only">إدخال كلمة مرور المشرف</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center gap-4 py-4">
            <div className="flex size-16 items-center justify-center rounded-full bg-red-100 dark:bg-red-950/30">
              <AlertTriangle className="size-8 text-red-500" />
            </div>
            <p className="text-sm text-muted-foreground text-center">
              {t.confirmCancelMessage}
              <br />
              <span className="text-xs" dir="ltr">Supervisor password required to cancel invoice</span>
            </p>
            <div className="w-full max-w-xs space-y-2">
              <Input
                type="password"
                placeholder={t.enterSupervisorPassword}
                value={supervisorPasswordInput}
                onChange={(e) => {
                  setSupervisorPasswordInput(e.target.value);
                  setSupervisorPasswordError('');
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSupervisorPasswordConfirm();
                }}
                className="text-center text-lg tracking-widest"
                autoFocus
              />
              {supervisorPasswordError && (
                <p className="text-xs text-red-500 text-center">{supervisorPasswordError}</p>
              )}
            </div>
            <div className="flex gap-2 w-full max-w-xs">
              <Button
                variant="destructive"
                className="flex-1 gap-2"
                onClick={handleSupervisorPasswordConfirm}
                disabled={!supervisorPasswordInput}
              >
                <XCircle className="size-4" />
                {t.confirmCancel}
              </Button>
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setSupervisorPasswordOpen(false)}
              >
                {t.back}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Shift Management Dialog */}
      <ShiftManagement
        open={shiftDialogOpen}
        onOpenChange={setShiftDialogOpen}
        defaultBranch={selectedBranch}
        onShiftChange={fetchActiveShift}
        branches={branches.filter(b => b.enabled).map(b => ({ key: b.key, name: b.name, enabled: b.enabled }))}
      />
    </div>
  );
}
