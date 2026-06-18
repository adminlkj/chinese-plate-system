'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTheme } from 'next-themes';
import { toast } from 'sonner';
import { useTranslation } from '@/lib/i18n';
import { useAppStore } from '@/lib/store';
import {
  Building,
  Settings,
  Globe,
  Calendar,
  Database,
  Moon,
  Sun,
  Shield,
  Trash2,
  RefreshCw,
  Plus,
  Save,
  AlertTriangle,
  Lock,
  Unlock,
  Loader2,
  ShoppingCart,
  Upload,
  X,
  GripVertical,
  Minus,
  Pencil,
  Tag,
  Package,
  FolderOpen,
  Activity,
  ChevronDown,
  ChevronUp,
  CheckCircle,
  XCircle,
  Wrench,
  UserPlus,
} from 'lucide-react';

const ImageIcon = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
    <circle cx="9" cy="9" r="2" />
    <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
  </svg>
);

const DollarSignIcon = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <line x1="12" x2="12" y1="2" y2="22" />
    <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
  </svg>
);

import AutoBackupSection from '@/components/accounting/auto-backup-section';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CurrencyAmount } from '@/components/ui/currency-symbol';

// Types
interface CompanyInfo {
  companyName: string;
  companyNameEn: string;
  taxNumber: string;
  crNumber: string;
  address: string;
  addressEn: string;
  phone: string;
  email: string;
}

interface SystemSettings {
  defaultCurrency: string;
  taxRate: string;
  fiscalYearStart: string;
}

interface Branch {
  id: string;       // UUID from DB — primary identifier for API calls
  key: string;      // branch code (e.g. CHINA_TOWN) — kept for backward compat / translations
  name: string;
  enabled: boolean;
}

/**
 * Full per-branch independent settings.
 * Each branch holds its OWN logo, contact, financial, and receipt config —
 * completely independent from other branches.
 * `null` for taxRate / maxDiscountPercentage means "fall back to system default".
 */
interface BranchDetails {
  id: string;
  code: string;
  name: string;
  nameEn: string | null;
  address: string | null;
  addressEn: string | null;
  phone: string | null;
  email: string | null;
  manager: string | null;
  vatNumber: string | null;
  taxRate: number | null;
  maxDiscountPercentage: number | null;
  logo: string | null;
  receiptHeader: string | null;
  receiptFooter: string | null;
  isActive: boolean;
}

// Form state for editing per-branch settings (everything is a string for input binding;
// empty string represents "fall back to system default" for numeric overrides)
interface BranchFormState {
  name: string;
  nameEn: string;
  address: string;
  addressEn: string;
  phone: string;
  email: string;
  manager: string;
  vatNumber: string;
  taxRate: string;
  maxDiscountPercentage: string;
  receiptHeader: string;
  receiptFooter: string;
}

interface FiscalPeriod {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: string;
}

interface RestaurantTableItem {
  id: string;
  name: string;
  branch: string;
  isActive: boolean;
  sortOrder: number;
}

interface ProductCategoryItem {
  id: string;
  name: string;
  nameEn?: string;
  branch: string;
  icon?: string;
  color?: string;
  isActive: boolean;
  sortOrder: number;
  productsCount: number;
}

interface ProductItem {
  id: string;
  name: string;
  nameEn?: string;
  categoryId: string;
  branch: string;
  price: number;
  isActive: boolean;
  sortOrder: number;
  category?: {
    id: string;
    name: string;
    nameEn?: string;
    icon?: string;
    color?: string;
  };
}

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const { t, isRTL, locale, setLocale } = useTranslation();

  const MONTHS = [
    { value: '1', label: t.january },
    { value: '2', label: t.february },
    { value: '3', label: t.march },
    { value: '4', label: t.april },
    { value: '5', label: t.may },
    { value: '6', label: t.june },
    { value: '7', label: t.july },
    { value: '8', label: t.august },
    { value: '9', label: t.september },
    { value: '10', label: t.october },
    { value: '11', label: t.november },
    { value: '12', label: t.december },
  ];

  // Company Info
  const [companyInfo, setCompanyInfo] = useState<CompanyInfo>({
    companyName: '',
    companyNameEn: '',
    taxNumber: '',
    crNumber: '',
    address: '',
    addressEn: '',
    phone: '',
    email: '',
  });

  // System Settings
  const [systemSettings, setSystemSettings] = useState<SystemSettings>({
    defaultCurrency: 'SAR',
    taxRate: '15',
    fiscalYearStart: '1',
  });

  // Branches
  // `id` is the UUID from DB — selectedBranchForTables / selectedBranchForProducts hold this value
  const [branches, setBranches] = useState<Branch[]>([
    { id: 'CHINA_TOWN', key: 'CHINA_TOWN', name: 'CHINA TOWN', enabled: true },
    { id: 'PALACE_INDIA', key: 'PALACE_INDIA', name: 'PALACE INDIA', enabled: true },
  ]);

  // ===== Per-branch independent settings =====
  // Branch currently selected for editing in the Branches tab
  const [selectedBranchForEdit, setSelectedBranchForEdit] = useState<string>('');
  // Full details fetched from /api/branches for the selected branch
  const [branchDetails, setBranchDetails] = useState<BranchDetails | null>(null);
  // Editable form state mirroring branchDetails (stringified for input binding)
  const [branchForm, setBranchForm] = useState<BranchDetails | null>(null);
  const [isBranchDetailsLoading, setIsBranchDetailsLoading] = useState(false);
  const [isBranchSaving, setIsBranchSaving] = useState(false);

  // Fiscal Periods
  const [fiscalPeriods, setFiscalPeriods] = useState<FiscalPeriod[]>([]);
  const [currentPeriod, setCurrentPeriod] = useState<FiscalPeriod | null>(null);

  // Loading states
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isRecalculating, setIsRecalculating] = useState(false);
  const [isSeeding, setIsSeeding] = useState(false);
  const [isPurging, setIsPurging] = useState(false);
  const [isClosingPeriod, setIsClosingPeriod] = useState(false);
  const [isOpeningPeriod, setIsOpeningPeriod] = useState(false);

  // New branch
  const [showNewBranch, setShowNewBranch] = useState(false);
  const [newBranchName, setNewBranchName] = useState('');

  // Tables management
  const [tablesByBranch, setTablesByBranch] = useState<Record<string, RestaurantTableItem[]>>({});
  const [selectedBranchForTables, setSelectedBranchForTables] = useState<string>('');
  const [newTableName, setNewTableName] = useState('');
  const [isTablesLoading, setIsTablesLoading] = useState(false);
  const [isTableSaving, setIsTableSaving] = useState(false);

  // Branch logos
  const [branchLogos, setBranchLogos] = useState<Record<string, string>>({});
  const [isLogoUploading, setIsLogoUploading] = useState<string>('');

  // Print settings
  const [printSettings, setPrintSettings] = useState({
    receiptWidth: 80,    // mm
    fontSize: 11,        // px
    logoWidth: 40,       // mm
    logoHeight: 20,      // mm
  });

  // Currency symbol image
  const [currencySymbolImage, setCurrencySymbolImage] = useState<string>('');
  const [isCurrencySymbolUploading, setIsCurrencySymbolUploading] = useState(false);
  const setCurrencySymbolUrl = useAppStore((s) => s.setCurrencySymbolUrl);

  // Products management
  const [categories, setCategories] = useState<ProductCategoryItem[]>([]);
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [selectedBranchForProducts, setSelectedBranchForProducts] = useState<string>('');
  const [selectedCategoryForProducts, setSelectedCategoryForProducts] = useState<string>('all');
  const [productsTab, setProductsTab] = useState<string>('categories');
  const [isCategoriesLoading, setIsCategoriesLoading] = useState(false);
  const [isProductsLoading, setIsProductsLoading] = useState(false);
  const [isCategorySaving, setIsCategorySaving] = useState(false);
  const [isProductSaving, setIsProductSaving] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryIcon, setNewCategoryIcon] = useState('');
  const [newCategoryColor, setNewCategoryColor] = useState('');
  const [newProductName, setNewProductName] = useState('');
  const [newProductPrice, setNewProductPrice] = useState('');
  const [newProductCategory, setNewProductCategory] = useState('');
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [editingCategoryName, setEditingCategoryName] = useState('');
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [editingProductName, setEditingProductName] = useState('');
  const [editingProductPrice, setEditingProductPrice] = useState('');

  // Supervisor password — tracks whether a password is SET (not the actual value)
  // The actual password is never exposed to the client; verification is always server-side
  const [supervisorPasswordSet, setSupervisorPasswordSet] = useState(false);
  // Tracks if the user has changed the password in this session
  const [pendingPasswordChange, setPendingPasswordChange] = useState<string | null>(null);

  // Max discount percentage (0 = no limit)
  const [maxDiscountPercentage, setMaxDiscountPercentage] = useState('0');
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [currentPasswordInput, setCurrentPasswordInput] = useState('');
  const [newPasswordInput, setNewPasswordInput] = useState('');
  const [confirmPasswordInput, setConfirmPasswordInput] = useState('');

  // Diagnostics
  const [diagnostics, setDiagnostics] = useState<any>(null);
  const [isDiagnosticsLoading, setIsDiagnosticsLoading] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [dbConnectionStatus, setDbConnectionStatus] = useState<'idle' | 'ok' | 'fail'>('idle');

  // Recovery
  const [isRecovering, setIsRecovering] = useState(false);
  const [recoveryReport, setRecoveryReport] = useState<{ fixes: string[]; errors: string[] } | null>(null);
  const [backupAdminEmail, setBackupAdminEmail] = useState('');
  const [backupAdminName, setBackupAdminName] = useState('');
  const [backupAdminNameEn, setBackupAdminNameEn] = useState('');
  const [backupAdminPassword, setBackupAdminPassword] = useState('');
  const [isCreatingBackupAdmin, setIsCreatingBackupAdmin] = useState(false);

  // Fetch settings on mount
  const fetchSettings = useCallback(async () => {
    try {
      setIsLoading(true);
      const res = await fetch('/api/settings', { cache: 'no-store' });
      if (!res.ok) throw new Error(t.failedToFetchSettings);
      const data: Record<string, string> = await res.json();

      setCompanyInfo({
        companyName: data.companyName || '',
        companyNameEn: data.companyNameEn || '',
        taxNumber: data.taxNumber || '',
        crNumber: data.crNumber || '',
        address: data.address || '',
        addressEn: data.addressEn || '',
        phone: data.phone || '',
        email: data.email || '',
      });

      setSystemSettings({
        defaultCurrency: data.defaultCurrency || 'SAR',
        taxRate: data.taxRate || '15',
        fiscalYearStart: data.fiscalYearStart || '1',
      });

      // Load branches: prefer the DB (source of truth) and merge any extra
      // entries from the legacy `branches` settings JSON. The DB is the
      // canonical source — each Branch row now carries its own independent
      // settings (logo, contact, financial, receipt overrides).
      try {
        const branchesRes = await fetch('/api/branches');
        if (branchesRes.ok) {
          const dbBranches: any[] = await branchesRes.json();
          if (Array.isArray(dbBranches) && dbBranches.length > 0) {
            // Also load the legacy settings JSON (if any) so we can preserve
            // any local-only `enabled` flags the user may have toggled.
            let savedBranches: any[] = [];
            if (data.branches) {
              try {
                const parsed = JSON.parse(data.branches);
                if (Array.isArray(parsed)) savedBranches = parsed;
              } catch {}
            }
            setBranches(
              dbBranches.map((db) => {
                const sb = savedBranches.find((s: any) => s.key === db.code);
                return {
                  id: db.id,
                  key: db.code,
                  name: db.name,
                  // DB isActive is the source of truth; legacy setting only used as fallback
                  enabled: db.isActive !== undefined ? db.isActive : (sb?.enabled ?? true),
                };
              })
            );
          }
        }
      } catch {
        // Fall back to legacy settings JSON if /api/branches fails
        if (data.branches) {
          try {
            const savedBranches = JSON.parse(data.branches);
            if (Array.isArray(savedBranches) && savedBranches.length > 0) {
              setBranches(savedBranches.map((sb: any) => ({
                id: sb.key,
                key: sb.key,
                name: sb.name,
                enabled: sb.enabled,
              })));
            }
          } catch {
            // Keep default branches
          }
        }
      }

      // Load print settings
      setPrintSettings({
        receiptWidth: parseInt(data.receiptWidth) || 80,
        fontSize: parseInt(data.receiptFontSize) || 11,
        logoWidth: parseInt(data.logoWidth) || 40,
        logoHeight: parseInt(data.logoHeight) || 20,
      });

      // Track whether a supervisor password is set (value is masked as '••••')
      setSupervisorPasswordSet(!!data.supervisorPassword && data.supervisorPassword !== '');

      // Load max discount percentage
      if (data.maxDiscountPercentage) {
        setMaxDiscountPercentage(data.maxDiscountPercentage);
      }
    } catch (error) {
      toast.error(t.failedToFetchSettings);
    } finally {
      setIsLoading(false);
    }
  }, [t.failedToFetchSettings]);

  // Fetch currency symbol image
  const fetchCurrencySymbol = useCallback(async () => {
    try {
      const res = await fetch('/api/settings/currency-symbol');
      if (res.ok) {
        const data = await res.json();
        if (data.imageData) {
          setCurrencySymbolImage(data.imageData);
        }
      }
    } catch {
      // Silently fail
    }
  }, []);

  const fetchFiscalPeriods = useCallback(async () => {
    try {
      const res = await fetch('/api/fiscal-periods');
      if (!res.ok) throw new Error(t.failedToFetchPeriods);
      const data: FiscalPeriod[] = await res.json();
      setFiscalPeriods(data);
      const openPeriod = data.find((p) => p.status === 'OPEN');
      setCurrentPeriod(openPeriod || null);
    } catch {
      toast.error(t.failedToFetchPeriods);
    }
  }, [t.failedToFetchPeriods]);

  useEffect(() => {
    fetchSettings();
    fetchFiscalPeriods();
    fetchCurrencySymbol();
  }, [fetchSettings, fetchFiscalPeriods, fetchCurrencySymbol]);

  // Fetch tables for a specific branch
  const fetchTables = useCallback(async (branch: string) => {
    try {
      setIsTablesLoading(true);
      const res = await fetch(`/api/pos/tables?branchId=${branch}`);
      if (!res.ok) throw new Error(t.failedToFetchTables2);
      const data: RestaurantTableItem[] = await res.json();
      setTablesByBranch((prev) => ({ ...prev, [branch]: data }));
    } catch {
      toast.error(t.failedToFetchTables2);
    } finally {
      setIsTablesLoading(false);
    }
  }, [t.failedToFetchTables2]);

  // Fetch all branch logos
  // Accepts an array of branch UUIDs; results are keyed by UUID in branchLogos state.
  const fetchBranchLogos = useCallback(async (branchIds: string[]) => {
    for (const branch of branchIds) {
      try {
        const res = await fetch(`/api/settings/logo?branchId=${branch}`);
        if (res.ok) {
          const data = await res.json();
          if (data.logoData) {
            setBranchLogos((prev) => ({ ...prev, [branch]: data.logoData }));
          }
        }
      } catch {
        // Logo doesn't exist yet, that's fine
      }
    }
  }, []);

  // ===== Per-branch independent settings =====
  // Fetch the full Branch record (logo, contact, financial, receipt overrides)
  // for the selected branch from /api/branches (GET returns the full Branch row).
  const fetchBranchDetails = useCallback(async (branchId: string) => {
    if (!branchId) return;
    setIsBranchDetailsLoading(true);
    try {
      // /api/branches returns the list of all branches; pick the one we want.
      // (We deliberately re-use the existing endpoint to avoid adding a new route.)
      const res = await fetch('/api/branches');
      if (!res.ok) throw new Error('فشل في جلب بيانات الفرع');
      const all: any[] = await res.json();
      const found = all.find((b) => b.id === branchId) || null;
      if (found) {
        const details: BranchDetails = {
          id: found.id,
          code: found.code,
          name: found.name,
          nameEn: found.nameEn ?? null,
          address: found.address ?? null,
          addressEn: found.addressEn ?? null,
          phone: found.phone ?? null,
          email: found.email ?? null,
          manager: found.manager ?? null,
          vatNumber: found.vatNumber ?? null,
          taxRate: found.taxRate !== null && found.taxRate !== undefined ? Number(found.taxRate) : null,
          maxDiscountPercentage:
            found.maxDiscountPercentage !== null && found.maxDiscountPercentage !== undefined
              ? Number(found.maxDiscountPercentage)
              : null,
          logo: found.logo ?? null,
          receiptHeader: found.receiptHeader ?? null,
          receiptFooter: found.receiptFooter ?? null,
          isActive: found.isActive ?? true,
        };
        setBranchDetails(details);
        // Initialize form state (clone)
        setBranchForm({ ...details });
        // Also sync the branchLogos cache so the logo card shows the correct preview
        if (details.logo) {
          setBranchLogos((prev) => ({ ...prev, [details.id]: details.logo as string }));
        }
      } else {
        setBranchDetails(null);
        setBranchForm(null);
      }
    } catch {
      toast.error('فشل في جلب بيانات الفرع');
      setBranchDetails(null);
      setBranchForm(null);
    } finally {
      setIsBranchDetailsLoading(false);
    }
  }, []);

  // Save the per-branch independent settings (PUT /api/branches)
  const handleSaveBranchDetails = async () => {
    if (!branchForm) return;
    setIsBranchSaving(true);
    try {
      const res = await fetch('/api/branches', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: branchForm.id,
          name: branchForm.name,
          nameEn: branchForm.nameEn || '',
          address: branchForm.address || '',
          addressEn: branchForm.addressEn || '',
          phone: branchForm.phone || '',
          email: branchForm.email || '',
          manager: branchForm.manager || '',
          vatNumber: branchForm.vatNumber || '',
          // null = fall back to system default; otherwise send the numeric override
          taxRate: branchForm.taxRate,
          maxDiscountPercentage: branchForm.maxDiscountPercentage,
          receiptHeader: branchForm.receiptHeader || '',
          receiptFooter: branchForm.receiptFooter || '',
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || t.branchSaveFailed);
      }
      const updated: any = await res.json();
      // Refresh local branches state name (in case it changed)
      setBranches((prev) =>
        prev.map((b) =>
          b.id === updated.id
            ? { ...b, name: updated.name || b.name, key: updated.code || b.key }
            : b
        )
      );
      // Refresh details from the response (avoids a refetch)
      const details: BranchDetails = {
        id: updated.id,
        code: updated.code,
        name: updated.name,
        nameEn: updated.nameEn ?? null,
        address: updated.address ?? null,
        addressEn: updated.addressEn ?? null,
        phone: updated.phone ?? null,
        email: updated.email ?? null,
        manager: updated.manager ?? null,
        vatNumber: updated.vatNumber ?? null,
        taxRate: updated.taxRate !== null && updated.taxRate !== undefined ? Number(updated.taxRate) : null,
        maxDiscountPercentage:
          updated.maxDiscountPercentage !== null && updated.maxDiscountPercentage !== undefined
            ? Number(updated.maxDiscountPercentage)
            : null,
        logo: updated.logo ?? null,
        receiptHeader: updated.receiptHeader ?? null,
        receiptFooter: updated.receiptFooter ?? null,
        isActive: updated.isActive ?? true,
      };
      setBranchDetails(details);
      setBranchForm({ ...details });
      if (details.logo) {
        setBranchLogos((prev) => ({ ...prev, [details.id]: details.logo as string }));
      }
      toast.success(t.branchSaved);
    } catch (error: any) {
      toast.error(error.message || t.branchSaveFailed);
    } finally {
      setIsBranchSaving(false);
    }
  };

  // Update a single field in the branch form state
  const updateBranchForm = <K extends keyof BranchDetails>(field: K, value: BranchDetails[K]) => {
    setBranchForm((prev) => (prev ? { ...prev, [field]: value } : prev));
  };

  // Auto-select first branch for tables and load logos.
  // Also re-select if the currently-selected branch is no longer in the list
  // (defaults [CHINA_TOWN, PALACE_INDIA] are replaced by DB branches on load).
  useEffect(() => {
    const enabledBranches = branches.filter((b) => b.enabled);
    if (enabledBranches.length === 0) return;
    const stillExists = enabledBranches.some((b) => b.id === selectedBranchForTables);
    if (!selectedBranchForTables || !stillExists) {
      setSelectedBranchForTables(enabledBranches[0].id);
      fetchTables(enabledBranches[0].id);
    }
    fetchBranchLogos(enabledBranches.map((b) => b.id));
  }, [branches, selectedBranchForTables, fetchTables, fetchBranchLogos]);

  // Auto-select first branch for the per-branch independent-settings editor.
  // Also re-select if the currently-selected branch is no longer in the list
  // (e.g. after the initial defaults [CHINA_TOWN, PALACE_INDIA] are replaced
  // by the real DB branches fetched from /api/branches).
  useEffect(() => {
    const enabledBranches = branches.filter((b) => b.enabled);
    if (enabledBranches.length === 0) return;
    const stillExists = enabledBranches.some((b) => b.id === selectedBranchForEdit);
    if (!selectedBranchForEdit || !stillExists) {
      setSelectedBranchForEdit(enabledBranches[0].id);
    }
  }, [branches, selectedBranchForEdit]);

  // Fetch full per-branch details whenever the selected branch changes
  useEffect(() => {
    if (selectedBranchForEdit) {
      fetchBranchDetails(selectedBranchForEdit);
    } else {
      setBranchDetails(null);
      setBranchForm(null);
    }
  }, [selectedBranchForEdit, fetchBranchDetails]);

  // Fetch categories for a specific branch
  const fetchCategories = useCallback(async (branch: string) => {
    try {
      setIsCategoriesLoading(true);
      const res = await fetch(`/api/pos/categories?branchId=${branch}`);
      if (!res.ok) throw new Error(t.failedToFetchCategories);
      const data = await res.json();
      setCategories(data.categories || []);
    } catch {
      toast.error(t.failedToFetchCategories);
    } finally {
      setIsCategoriesLoading(false);
    }
  }, [t.failedToFetchCategories]);

  // Fetch products for a specific branch and/or category
  const fetchProducts = useCallback(async (branch: string, categoryId?: string) => {
    try {
      setIsProductsLoading(true);
      let url = `/api/pos/products?branchId=${branch}`;
      if (categoryId && categoryId !== 'all') {
        url += `&categoryId=${categoryId}`;
      }
      const res = await fetch(url);
      if (!res.ok) throw new Error(t.failedToFetchProducts);
      const data = await res.json();
      setProducts(data.products || []);
    } catch {
      toast.error(t.failedToFetchProducts);
    } finally {
      setIsProductsLoading(false);
    }
  }, [t.failedToFetchProducts]);

  // Auto-select first branch for products.
  // Also re-select if the currently-selected branch is no longer in the list.
  useEffect(() => {
    const enabledBranches = branches.filter((b) => b.enabled);
    if (enabledBranches.length === 0) return;
    const stillExists = enabledBranches.some((b) => b.id === selectedBranchForProducts);
    if (!selectedBranchForProducts || !stillExists) {
      setSelectedBranchForProducts(enabledBranches[0].id);
      fetchCategories(enabledBranches[0].id);
    }
  }, [branches, selectedBranchForProducts, fetchCategories]);

  // Add a new category
  const handleAddCategory = async () => {
    if (!newCategoryName.trim() || !selectedBranchForProducts) return;
    try {
      setIsCategorySaving(true);
      const res = await fetch('/api/pos/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newCategoryName.trim(),
          branchId: selectedBranchForProducts,
          icon: newCategoryIcon.trim() || undefined,
          color: newCategoryColor.trim() || undefined,
          sortOrder: categories.length,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || t.failedToAddCategory);
      }
      setNewCategoryName('');
      setNewCategoryIcon('');
      setNewCategoryColor('');
      await fetchCategories(selectedBranchForProducts);
      toast.success(t.categoryAdded);
    } catch (error: any) {
      toast.error(error.message || t.failedToAddCategory);
    } finally {
      setIsCategorySaving(false);
    }
  };

  // Update a category
  const handleUpdateCategory = async (categoryId: string, updates: { name?: string; icon?: string; color?: string }) => {
    try {
      const res = await fetch(`/api/pos/categories/${categoryId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || t.failedToUpdateCategory);
      }
      if (selectedBranchForProducts) {
        await fetchCategories(selectedBranchForProducts);
      }
      toast.success(t.categoryUpdated);
    } catch (error: any) {
      toast.error(error.message || t.failedToUpdateCategory);
    }
  };

  // Delete a category
  const handleDeleteCategory = async (categoryId: string) => {
    try {
      const res = await fetch(`/api/pos/categories/${categoryId}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || t.failedToDeleteCategory);
      }
      if (selectedBranchForProducts) {
        await fetchCategories(selectedBranchForProducts);
      }
      toast.success(t.categoryDeleted);
    } catch (error: any) {
      toast.error(error.message || t.failedToDeleteCategory);
    }
  };

  // Add a new product
  const handleAddProduct = async () => {
    if (!newProductName.trim() || !newProductPrice || !newProductCategory || !selectedBranchForProducts) return;
    try {
      setIsProductSaving(true);
      const res = await fetch('/api/pos/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newProductName.trim(),
          price: parseFloat(newProductPrice),
          categoryId: newProductCategory,
          branchId: selectedBranchForProducts,
          sortOrder: products.length,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || t.failedToAddProduct);
      }
      setNewProductName('');
      setNewProductPrice('');
      setNewProductCategory('');
      await fetchProducts(selectedBranchForProducts, selectedCategoryForProducts);
      await fetchCategories(selectedBranchForProducts);
      toast.success(t.productAdded);
    } catch (error: any) {
      toast.error(error.message || t.failedToAddProduct);
    } finally {
      setIsProductSaving(false);
    }
  };

  // Update a product
  const handleUpdateProduct = async (productId: string, updates: { name?: string; price?: number; categoryId?: string }) => {
    try {
      const res = await fetch(`/api/pos/products/${productId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || t.failedToUpdateProduct);
      }
      if (selectedBranchForProducts) {
        await fetchProducts(selectedBranchForProducts, selectedCategoryForProducts);
      }
      toast.success(t.productUpdated);
    } catch (error: any) {
      toast.error(error.message || t.failedToUpdateProduct);
    }
  };

  // Delete a product (soft delete)
  const handleDeleteProduct = async (productId: string) => {
    try {
      const res = await fetch(`/api/pos/products/${productId}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || t.failedToDeleteProduct);
      }
      if (selectedBranchForProducts) {
        await fetchProducts(selectedBranchForProducts, selectedCategoryForProducts);
        await fetchCategories(selectedBranchForProducts);
      }
      toast.success(t.productDeleted);
    } catch (error: any) {
      toast.error(error.message || t.failedToDeleteProduct);
    }
  };

  // Add a new table
  const handleAddTable = async () => {
    if (!newTableName.trim() || !selectedBranchForTables) return;
    try {
      setIsTableSaving(true);
      const existing = tablesByBranch[selectedBranchForTables] || [];
      const res = await fetch('/api/pos/tables', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newTableName.trim(),
          branchId: selectedBranchForTables,
          sortOrder: existing.length,
        }),
      });
      if (!res.ok) throw new Error(t.failedToAddTable);
      setNewTableName('');
      await fetchTables(selectedBranchForTables);
      toast.success(t.tableAdded);
    } catch {
      toast.error(t.failedToAddTable);
    } finally {
      setIsTableSaving(false);
    }
  };

  // Delete a table
  const handleDeleteTable = async (tableId: string) => {
    if (!selectedBranchForTables) return;
    try {
      const res = await fetch(`/api/pos/tables/${tableId}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || t.failedToDeleteTable);
      }
      await fetchTables(selectedBranchForTables);
      toast.success(t.tableDeleted);
    } catch (error: any) {
      toast.error(error.message || t.failedToDeleteTable);
    }
  };

  // Rename a table
  const handleRenameTable = async (tableId: string, newName: string) => {
    if (!selectedBranchForTables || !newName.trim()) return;
    try {
      const res = await fetch('/api/pos/tables', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: tableId, name: newName.trim() }),
      });
      if (!res.ok) throw new Error(t.failedToUpdateTable);
      await fetchTables(selectedBranchForTables);
      toast.success(t.tableUpdated);
    } catch {
      toast.error(t.failedToUpdateTable);
    }
  };

  // Add multiple tables at once
  const handleAddBulkTables = async (count: number) => {
    if (!selectedBranchForTables) return;
    try {
      setIsTableSaving(true);
      const existing = tablesByBranch[selectedBranchForTables] || [];
      for (let i = 0; i < count; i++) {
        await fetch('/api/pos/tables', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: String(existing.length + i + 1),
            branchId: selectedBranchForTables,
            sortOrder: existing.length + i,
          }),
        });
      }
      await fetchTables(selectedBranchForTables);
      toast.success(t.bulkTablesAdded);
    } catch {
      toast.error(t.failedToAddTable);
    } finally {
      setIsTableSaving(false);
    }
  };

  // Handle logo upload
  const handleLogoUpload = async (branch: string, file: File) => {
    if (!file) return;
    const validTypes = ['image/png', 'image/jpeg', 'image/jpg'];
    if (!validTypes.includes(file.type)) {
      toast.error(t.selectPngJpg);
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error(t.imageTooLarge);
      return;
    }
    try {
      setIsLogoUploading(branch);
      const reader = new FileReader();
      reader.onload = async (e) => {
        const base64 = e.target?.result as string;
        const res = await fetch('/api/settings/logo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ branchId: branch, logoData: base64 }),
        });
        if (!res.ok) throw new Error(t.failedToUploadLogo);
        setBranchLogos((prev) => ({ ...prev, [branch]: base64 }));
        toast.success(t.logoUploaded);
        setIsLogoUploading('');
      };
      reader.readAsDataURL(file);
    } catch {
      toast.error(t.failedToUploadLogo);
      setIsLogoUploading('');
    }
  };

  // Delete logo
  const handleDeleteLogo = async (branch: string) => {
    try {
      const res = await fetch(`/api/settings/logo?branchId=${branch}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(t.failedToDeleteLogo);
      setBranchLogos((prev) => {
        const next = { ...prev };
        delete next[branch];
        return next;
      });
      toast.success(t.logoDeleted);
    } catch {
      toast.error(t.failedToDeleteLogo);
    }
  };

  // Handle currency symbol image upload
  const handleCurrencySymbolUpload = async (file: File) => {
    if (!file) return;
    const validTypes = ['image/png', 'image/jpeg', 'image/jpg'];
    if (!validTypes.includes(file.type)) {
      toast.error(t.selectPngJpg);
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error(t.imageTooLarge);
      return;
    }
    try {
      setIsCurrencySymbolUploading(true);
      const reader = new FileReader();
      reader.onload = async (e) => {
        const base64 = e.target?.result as string;
        const res = await fetch('/api/settings/currency-symbol', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageData: base64 }),
        });
        if (!res.ok) throw new Error(t.failedToUploadCurrencySymbol);
        setCurrencySymbolImage(base64);
        setCurrencySymbolUrl(base64); // Sync to global store so POS/other screens see it immediately
        toast.success(t.currencySymbolUploaded);
        setIsCurrencySymbolUploading(false);
      };
      reader.readAsDataURL(file);
    } catch {
      toast.error(t.failedToUploadCurrencySymbol);
      setIsCurrencySymbolUploading(false);
    }
  };

  // Delete currency symbol image
  const handleDeleteCurrencySymbol = async () => {
    try {
      const res = await fetch('/api/settings/currency-symbol', { method: 'DELETE' });
      if (!res.ok) throw new Error(t.failedToDeleteCurrencySymbol);
      setCurrencySymbolImage('');
      setCurrencySymbolUrl(''); // Sync to global store so POS/other screens see the deletion immediately
      toast.success(t.currencySymbolDeleted);
    } catch {
      toast.error(t.failedToDeleteCurrencySymbol);
    }
  };

  // Save all settings
  const handleSave = async () => {
    try {
      setIsSaving(true);
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyName: companyInfo.companyName,
          companyNameEn: companyInfo.companyNameEn,
          taxNumber: companyInfo.taxNumber,
          crNumber: companyInfo.crNumber,
          address: companyInfo.address,
          addressEn: companyInfo.addressEn,
          phone: companyInfo.phone,
          email: companyInfo.email,
          defaultCurrency: systemSettings.defaultCurrency,
          taxRate: systemSettings.taxRate,
          fiscalYearStart: systemSettings.fiscalYearStart,
          branches: JSON.stringify(branches),
          receiptWidth: String(printSettings.receiptWidth),
          receiptFontSize: String(printSettings.fontSize),
          logoWidth: String(printSettings.logoWidth),
          logoHeight: String(printSettings.logoHeight),
          // Only send supervisorPassword if the user explicitly changed it
          // NEVER send the masked '••••' value back — it would overwrite the real password!
          ...(pendingPasswordChange ? { supervisorPassword: pendingPasswordChange } : {}),
          maxDiscountPercentage,
        }),
      });

      if (!res.ok) throw new Error(t.failedToSaveSettings);
      toast.success(t.settingsSaved);
      // Clear pending password change after successful save
      setPendingPasswordChange(null);
      // Re-fetch settings to ensure UI is in sync with DB (no stale cache)
      await fetchSettings();
    } catch {
      toast.error(t.failedToSaveSettings);
    } finally {
      setIsSaving(false);
    }
  };

  // Save individual print setting
  const handleSavePrintSetting = async (key: string, value: string) => {
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: value }),
      });
      if (!res.ok) throw new Error(t.failedToSavePrintSettings);
      toast.success(t.printSettingsSaved);
    } catch {
      toast.error(t.failedToSavePrintSettings);
    }
  };

  // Close period
  const handleClosePeriod = async () => {
    if (!currentPeriod) return;
    try {
      setIsClosingPeriod(true);
      const res = await fetch('/api/fiscal-periods', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'close', periodId: currentPeriod.id }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || t.failedToClosePeriod);
      }
      toast.success(t.periodClosed);
      await fetchFiscalPeriods();
    } catch (error: any) {
      toast.error(error.message || t.failedToClosePeriod);
    } finally {
      setIsClosingPeriod(false);
    }
  };

  // Open new period
  const handleOpenNewPeriod = async () => {
    try {
      setIsOpeningPeriod(true);
      const year = new Date().getFullYear();
      const startMonth = parseInt(systemSettings.fiscalYearStart) || 1;
      const startDate = new Date(year, startMonth - 1, 1);
      const endDate = new Date(year, startMonth - 1 + 12, 0);

      const res = await fetch('/api/fiscal-periods', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'open',
          name: `${t.fiscalPeriods} ${year}`,
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || t.failedToOpenPeriod);
      }
      toast.success(t.periodOpened);
      await fetchFiscalPeriods();
    } catch (error: any) {
      toast.error(error.message || t.failedToOpenPeriod);
    } finally {
      setIsOpeningPeriod(false);
    }
  };

  // Recalculate balances
  const handleRecalculate = async () => {
    try {
      setIsRecalculating(true);
      const res = await fetch('/api/data/recalculate', { method: 'POST' });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || t.failedToRecalculate);
      }
      toast.success(t.recalculateSuccess);
    } catch (error: any) {
      toast.error(error.message || t.failedToRecalculate);
    } finally {
      setIsRecalculating(false);
    }
  };

  // Seed default accounts
  const handleSeedAccounts = async () => {
    try {
      setIsSeeding(true);
      const res = await fetch('/api/accounts/seed', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || t.failedToSeed);
      }
      if (data.seeded) {
        toast.success(t.seedSuccess);
      } else {
        toast.warning(t.accountsExist);
      }
    } catch (error: any) {
      toast.error(error.message || t.failedToSeed);
    } finally {
      setIsSeeding(false);
    }
  };

  // Delete all data
  const handlePurgeData = async () => {
    try {
      setIsPurging(true);
      const res = await fetch('/api/data/purge', { method: 'POST' });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || t.failedToPurge);
      }
      toast.success(t.purgeSuccess);
      // Full page reload to ensure ALL screens refresh their data
      // (products, categories, tables, invoices, customers, accounts, etc.)
      setTimeout(() => {
        window.location.reload();
      }, 1000);
    } catch (error: any) {
      toast.error(error.message || t.failedToPurge);
      setIsPurging(false);
    }
  };

  // (Legacy toggleBranch / updateBranchName helpers were removed — branch
  // enable/disable is now toggled inline in the Branches-tab selector card,
  // and branch name editing happens via the per-branch "Save" button using
  // the handleSaveBranchDetails() flow.)

  const [isAddingBranch, setIsAddingBranch] = useState(false);

  const addBranch = async () => {
    if (!newBranchName.trim()) {
      toast.error(t.enterBranchNameError);
      return;
    }
    const key = newBranchName.trim().toUpperCase().replace(/\s+/g, '_').replace(/[^A-Z0-9_]/g, '');
    if (branches.some((b) => b.key === key)) {
      toast.error(t.branchExists);
      return;
    }

    try {
      setIsAddingBranch(true);
      // Create the branch in the database via API
      // This automatically: creates Branch record, creates revenue account, updates settings
      const res = await fetch('/api/branches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newBranchName.trim(),
          nameEn: newBranchName.trim(), // Use same name for English by default
          code: key,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || t.branchExists);
      }

      // Add to local state with the UUID returned by the API
      const createdBranch = await res.json();
      setBranches((prev) => [...prev, { id: createdBranch.id, key, name: newBranchName.trim(), enabled: true }]);
      setNewBranchName('');
      setShowNewBranch(false);
      toast.success(t.branchAdded);
    } catch (error: any) {
      toast.error(error.message || t.branchExists);
    } finally {
      setIsAddingBranch(false);
    }
  };

  // Fetch diagnostics data
  const fetchDiagnostics = useCallback(async () => {
    setIsDiagnosticsLoading(true);
    try {
      const res = await fetch('/api/admin/diagnostics');
      if (res.ok) {
        const data = await res.json();
        setDiagnostics(data);
        setDbConnectionStatus('ok');
      } else {
        setDbConnectionStatus('fail');
        toast.error(t.failedToLoadDiagnostics);
      }
    } catch {
      setDbConnectionStatus('fail');
      toast.error(t.failedToLoadDiagnostics);
    } finally {
      setIsDiagnosticsLoading(false);
    }
  }, [t.failedToLoadDiagnostics]);

  // Test database connection
  const handleTestConnection = async () => {
    try {
      const res = await fetch('/api/admin/diagnostics');
      if (res.ok) {
        setDbConnectionStatus('ok');
        toast.success(t.dbConnectionOk);
      } else {
        setDbConnectionStatus('fail');
        toast.error(t.dbConnectionFail);
      }
    } catch {
      setDbConnectionStatus('fail');
      toast.error(t.dbConnectionFail);
    }
  };

  // Auto-fix system
  const handleRecover = async () => {
    setIsRecovering(true);
    setRecoveryReport(null);
    try {
      const res = await fetch('/api/system-recover', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setRecoveryReport(data);
        if (data.errors?.length > 0) {
          toast.warning(t.recoveryCompletedWithErrors);
        } else {
          toast.success(t.recoveryCompleted);
        }
        // Refresh diagnostics after recovery
        await fetchDiagnostics();
      } else {
        toast.error(t.recoveryFailed);
      }
    } catch {
      toast.error(t.recoveryFailed);
    } finally {
      setIsRecovering(false);
    }
  };

  // Create backup admin
  const handleCreateBackupAdmin = async () => {
    if (!backupAdminEmail.trim() || !backupAdminName.trim() || !backupAdminPassword.trim()) {
      toast.error(t.fillAllFields);
      return;
    }
    setIsCreatingBackupAdmin(true);
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: backupAdminEmail.trim(),
          name: backupAdminName.trim(),
          nameEn: backupAdminNameEn.trim() || undefined,
          password: backupAdminPassword,
          role: 'ADMIN',
          isActive: true,
        }),
      });
      if (res.ok) {
        toast.success(t.backupAdminCreated);
        setBackupAdminEmail('');
        setBackupAdminName('');
        setBackupAdminNameEn('');
        setBackupAdminPassword('');
        // Refresh diagnostics
        await fetchDiagnostics();
      } else {
        const data = await res.json();
        toast.error(data.error || t.backupAdminFailed);
      }
    } catch {
      toast.error(t.backupAdminFailed);
    } finally {
      setIsCreatingBackupAdmin(false);
    }
  };

  // Format date for display
  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleDateString(locale === 'ar' ? 'ar-SA-u-nu-latn' : 'en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    } catch {
      return dateStr;
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="size-8 animate-spin text-primary" />
          <span className="text-muted-foreground text-sm">{t.loadingSettings}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto" dir={isRTL ? 'rtl' : 'ltr'}>
      {/* Header with Save Button */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Settings className="size-5" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-foreground">{t.settingsTitle}</h2>
            <p className="text-sm text-muted-foreground">{t.settingsDesc}</p>
          </div>
        </div>
        <Button onClick={handleSave} disabled={isSaving} className="gap-2">
          {isSaving ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Save className="size-4" />
          )}
          {t.saveSettings}
        </Button>
      </div>

      <Separator />

      <Tabs defaultValue="general" className="w-full">
        <TabsList className="w-full grid grid-cols-4">
          <TabsTrigger value="general" className="gap-1">
            <Settings className="size-3.5" />
            {t.generalSettings}
          </TabsTrigger>
          <TabsTrigger value="print" className="gap-1">
            <Globe className="size-3.5" />
            {t.printSettings}
          </TabsTrigger>
          <TabsTrigger value="branches" className="gap-1">
            <Building className="size-3.5" />
            {t.branchSettings}
          </TabsTrigger>
          <TabsTrigger value="diagnostics" className="gap-1" onClick={() => { if (!showDiagnostics) { setShowDiagnostics(true); fetchDiagnostics(); } }}>
            <Activity className="size-3.5" />
            {t.diagnosticsTab}
          </TabsTrigger>
        </TabsList>

        {/* ========== General Settings Tab ========== */}
        <TabsContent value="general" className="space-y-6 mt-6">

      {/* 1. Company Information */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <Building className="size-4" />
            </div>
            <div>
              <CardTitle className="text-base">{t.companyInfo}</CardTitle>
              <CardDescription>{t.companyInfoDesc}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="companyName">{t.companyName}</Label>
              <Input
                id="companyName"
                placeholder={t.enterCompanyName}
                value={companyInfo.companyName}
                onChange={(e) =>
                  setCompanyInfo((prev) => ({ ...prev, companyName: e.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="companyNameEn">{t.companyNameEn}</Label>
              <Input
                id="companyNameEn"
                placeholder="Enter company name in English"
                value={companyInfo.companyNameEn}
                onChange={(e) =>
                  setCompanyInfo((prev) => ({ ...prev, companyNameEn: e.target.value }))
                }
                dir="ltr"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="taxNumber">{t.taxNumber}</Label>
              <Input
                id="taxNumber"
                placeholder={t.enterTaxNumber}
                value={companyInfo.taxNumber}
                onChange={(e) =>
                  setCompanyInfo((prev) => ({ ...prev, taxNumber: e.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="crNumber">{t.crNumber || 'السجل التجاري'}</Label>
              <Input
                id="crNumber"
                placeholder={t.enterCrNumber || 'أدخل رقم السجل التجاري'}
                value={companyInfo.crNumber}
                onChange={(e) =>
                  setCompanyInfo((prev) => ({ ...prev, crNumber: e.target.value }))
                }
              />
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="address">{t.address}</Label>
              <Textarea
                id="address"
                placeholder={t.enterAddress}
                value={companyInfo.address}
                onChange={(e) =>
                  setCompanyInfo((prev) => ({ ...prev, address: e.target.value }))
                }
                rows={2}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="addressEn">{t.addressEn}</Label>
              <Textarea
                id="addressEn"
                placeholder="Enter company address in English"
                value={companyInfo.addressEn}
                onChange={(e) =>
                  setCompanyInfo((prev) => ({ ...prev, addressEn: e.target.value }))
                }
                rows={2}
                dir="ltr"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="phone">{t.phone}</Label>
              <Input
                id="phone"
                placeholder={t.enterPhone}
                value={companyInfo.phone}
                onChange={(e) =>
                  setCompanyInfo((prev) => ({ ...prev, phone: e.target.value }))
                }
                dir="ltr"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">{t.email}</Label>
              <Input
                id="email"
                type="email"
                placeholder={t.enterEmail}
                value={companyInfo.email}
                onChange={(e) =>
                  setCompanyInfo((prev) => ({ ...prev, email: e.target.value }))
                }
                dir="ltr"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 2. System Settings */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-md bg-teal-500/10 text-teal-600 dark:text-teal-400">
              <Globe className="size-4" />
            </div>
            <div>
              <CardTitle className="text-base">{t.systemSettings}</CardTitle>
              <CardDescription>{t.systemSettingsDesc}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>{t.defaultCurrency}</Label>
              <Select
                value={systemSettings.defaultCurrency}
                onValueChange={(value) =>
                  setSystemSettings((prev) => ({ ...prev, defaultCurrency: value }))
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="SAR">SAR</SelectItem>
                  <SelectItem value="USD">USD</SelectItem>
                  <SelectItem value="EUR">EUR</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="taxRate">{t.taxRate} (%)</Label>
              <Input
                id="taxRate"
                type="number"
                min="0"
                max="100"
                step="0.5"
                placeholder="15"
                value={systemSettings.taxRate}
                onChange={(e) =>
                  setSystemSettings((prev) => ({ ...prev, taxRate: e.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label>{t.fiscalYearStart}</Label>
              <Select
                value={systemSettings.fiscalYearStart}
                onValueChange={(value) =>
                  setSystemSettings((prev) => ({ ...prev, fiscalYearStart: value }))
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MONTHS.map((month) => (
                    <SelectItem key={month.value} value={month.value}>
                      {month.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Language Toggle */}
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div className="flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-md bg-primary/10 text-primary">
                <Globe className="size-4" />
              </div>
              <div>
                <div className="font-medium text-sm">{t.language}</div>
                <div className="text-xs text-muted-foreground">
                  {locale === 'ar' ? t.arabic : t.english}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant={locale === 'ar' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setLocale('ar')}
                className="gap-1"
              >
                {t.arabic}
              </Button>
              <Button
                variant={locale === 'en' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setLocale('en')}
                className="gap-1"
              >
                {t.english}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 2.5. Currency Symbol Image */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400">
              <DollarSignIcon className="size-4" />
            </div>
            <div>
              <CardTitle className="text-base">{t.currencySymbolImage}</CardTitle>
              <CardDescription>{t.uploadCurrencySymbol}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed p-6">
            {currencySymbolImage ? (
              <div className="flex flex-col items-center gap-3">
                <div className="relative group">
                  <img
                    src={currencySymbolImage}
                    alt={t.currencySymbolImage}
                    className="h-10 max-w-[120px] object-contain"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">100.00 <img src={currencySymbolImage} alt="" className="h-4 w-4 inline object-contain align-middle" /></span>
                </div>
                <div className="flex items-center gap-2">
                  <label htmlFor="currency-symbol-upload-replace">
                    <Button variant="outline" size="sm" className="gap-1 cursor-pointer" asChild>
                      <span>
                        <Upload className="size-3.5" />
                        {t.uploadCurrencySymbol}
                      </span>
                    </Button>
                    <input
                      id="currency-symbol-upload-replace"
                      type="file"
                      accept="image/png,image/jpeg,image/jpg"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleCurrencySymbolUpload(file);
                        e.target.value = '';
                      }}
                    />
                  </label>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="gap-1"
                    onClick={handleDeleteCurrencySymbol}
                    disabled={isCurrencySymbolUploading}
                  >
                    <Trash2 className="size-3.5" />
                    {t.delete}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3">
                <div className="flex size-16 items-center justify-center rounded-lg bg-muted">
                  <DollarSignIcon className="size-8 text-muted-foreground/40" />
                </div>
                <p className="text-sm text-muted-foreground">{t.uploadCurrencySymbol}</p>
                <label htmlFor="currency-symbol-upload">
                  <Button variant="outline" size="sm" className="gap-1 cursor-pointer" asChild disabled={isCurrencySymbolUploading}>
                    <span>
                      {isCurrencySymbolUploading ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Upload className="size-3.5" />
                      )}
                      {t.uploadCurrencySymbol}
                    </span>
                  </Button>
                  <input
                    id="currency-symbol-upload"
                    type="file"
                    accept="image/png,image/jpeg,image/jpg"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleCurrencySymbolUpload(file);
                      e.target.value = '';
                    }}
                  />
                </label>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* 2.6. Supervisor Password */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-md bg-rose-500/10 text-rose-600 dark:text-rose-400">
              <Lock className="size-4" />
            </div>
            <div>
              <CardTitle className="text-base">{t.supervisorPassword}</CardTitle>
              <CardDescription>{t.changeSupervisorPassword}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div className="flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-md bg-rose-500/10 text-rose-600 dark:text-rose-400">
                {supervisorPasswordSet ? <Lock className="size-4" /> : <Unlock className="size-4" />}
              </div>
              <div>
                <div className="font-medium text-sm">{t.supervisorPassword}</div>
                <div className="text-xs text-muted-foreground">
                  {supervisorPasswordSet ? t.active : t.inactive}
                </div>
              </div>
            </div>
            <Badge variant={supervisorPasswordSet ? 'default' : 'secondary'}>
              {supervisorPasswordSet ? t.active : t.inactive}
            </Badge>
          </div>

          {!showPasswordForm ? (
            <Button
              variant="outline"
              onClick={() => setShowPasswordForm(true)}
              className="gap-2 w-full"
            >
              <Lock className="size-4" />
              {t.changeSupervisorPassword}
            </Button>
          ) : (
            <div className="space-y-3 rounded-lg border border-dashed p-4">
              <p className="text-sm font-medium text-muted-foreground">{t.changeSupervisorPassword}</p>
              <div className="space-y-2">
                <Label htmlFor="currentPassword" className="text-xs">{t.currentPassword}</Label>
                <Input
                  id="currentPassword"
                  type="password"
                  placeholder={t.currentPassword}
                  value={currentPasswordInput}
                  onChange={(e) => setCurrentPasswordInput(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="newPassword" className="text-xs">{t.newPassword}</Label>
                <Input
                  id="newPassword"
                  type="password"
                  placeholder={t.newPassword}
                  value={newPasswordInput}
                  onChange={(e) => setNewPasswordInput(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmPassword" className="text-xs">{t.confirmPassword}</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  placeholder={t.confirmPassword}
                  value={confirmPasswordInput}
                  onChange={(e) => setConfirmPasswordInput(e.target.value)}
                />
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  onClick={async () => {
                    // Verify current password via server-side API (secure — supports bcrypt hashes)
                    // NEVER compare passwords client-side — the stored value is masked
                    if (supervisorPasswordSet && currentPasswordInput) {
                      try {
                        const verifyRes = await fetch('/api/settings/verify-supervisor', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ password: currentPasswordInput }),
                        });
                        const verifyData = await verifyRes.json();
                        if (!verifyData.valid) {
                          toast.error(t.incorrectPassword);
                          return;
                        }
                      } catch {
                        toast.error(t.incorrectPassword);
                        return;
                      }
                    } else if (supervisorPasswordSet && !currentPasswordInput) {
                      toast.error(t.currentPassword);
                      return;
                    }
                    if (!newPasswordInput.trim()) {
                      toast.error(t.newPassword);
                      return;
                    }
                    if (newPasswordInput !== confirmPasswordInput) {
                      toast.error(t.passwordsDontMatch);
                      return;
                    }
                    // Save the new password IMMEDIATELY to the server
                    try {
                      const saveRes = await fetch('/api/settings', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ supervisorPassword: newPasswordInput }),
                      });
                      if (!saveRes.ok) throw new Error('Failed to save');
                      setSupervisorPasswordSet(true);
                      setShowPasswordForm(false);
                      setCurrentPasswordInput('');
                      setNewPasswordInput('');
                      setConfirmPasswordInput('');
                      setPendingPasswordChange(null);
                      toast.success(t.passwordChanged || 'تم تغيير كلمة المرور بنجاح');
                    } catch {
                      toast.error(t.failedToSaveSettings || 'فشل في حفظ كلمة المرور');
                    }
                  }}
                  className="gap-1"
                >
                  <Save className="size-3" />
                  {t.save}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setShowPasswordForm(false);
                    setCurrentPasswordInput('');
                    setNewPasswordInput('');
                    setConfirmPasswordInput('');
                  }}
                >
                  {t.cancel}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 2.7. Max Discount Percentage */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400">
              <Tag className="size-4" />
            </div>
            <div>
              <CardTitle className="text-base">الحد الأعلى للخصم / Max Discount Limit</CardTitle>
              <CardDescription>الحد الأعلى لنسبة الخصم المسموح بها في نقطة البيع / Maximum discount percentage allowed in POS</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <div className="flex-1 space-y-2">
              <Label htmlFor="maxDiscountPercentage">نسبة الخصم القصوى % / Max Discount %</Label>
              <Input
                id="maxDiscountPercentage"
                type="number"
                min="0"
                max="100"
                step="0.5"
                value={maxDiscountPercentage}
                onChange={(e) => setMaxDiscountPercentage(e.target.value)}
                placeholder="0"
                dir="ltr"
              />
              <p className="text-xs text-muted-foreground">
                {maxDiscountPercentage === '0' || !maxDiscountPercentage
                  ? 'لا يوجد حد أعلى / No limit set'
                  : `الحد الأعلى: ${maxDiscountPercentage}% / Maximum: ${maxDiscountPercentage}%`}
              </p>
            </div>
            <div className="flex items-center gap-2 pt-5">
              <Badge variant={maxDiscountPercentage && parseFloat(maxDiscountPercentage) > 0 ? 'default' : 'secondary'}>
                {maxDiscountPercentage && parseFloat(maxDiscountPercentage) > 0 ? `${maxDiscountPercentage}%` : '∞'}
              </Badge>
            </div>
          </div>
          {maxDiscountPercentage && parseFloat(maxDiscountPercentage) > 0 && (
            <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-3">
              <p className="text-xs text-amber-700 dark:text-amber-300">
                ⚠ لن يُسمح بإدخال خصم يتجاوز {maxDiscountPercentage}% في شاشة نقطة البيع
                <br />
                Discount above {maxDiscountPercentage}% will not be allowed in POS screen
              </p>
            </div>
          )}
        </CardContent>
      </Card>

        </TabsContent>

        {/* ========== Branch Settings Tab ========== */}
        <TabsContent value="branches" className="space-y-6 mt-6">

      {/* ===== Branch selector header (sticky) ===== */}
      <Card className="border-primary/40 bg-primary/5">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <Building className="size-4" />
            </div>
            <div className="flex-1">
              <CardTitle className="text-base">{t.branchIndependentSettings}</CardTitle>
              <CardDescription>{t.branchIndependentSettingsDesc}</CardDescription>
            </div>
            <Button
              onClick={handleSaveBranchDetails}
              disabled={isBranchSaving || !branchForm}
              className="gap-2"
              size="sm"
            >
              {isBranchSaving ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Save className="size-4" />
              )}
              {t.saveSettings}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-end">
            <div className="space-y-2">
              <Label className="text-xs font-medium text-muted-foreground">{t.selectBranchToEdit}</Label>
              <Select
                value={selectedBranchForEdit}
                onValueChange={(value) => setSelectedBranchForEdit(value)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t.selectBranchToEdit} />
                </SelectTrigger>
                <SelectContent>
                  {branches.map((branch) => (
                    <SelectItem key={branch.id} value={branch.id}>
                      <span className="flex items-center gap-2">
                        <span className={`size-2 rounded-full ${branch.enabled ? 'bg-emerald-500' : 'bg-muted-foreground/40'}`} />
                        {branch.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {branchDetails && (
              <div className="flex items-center gap-2">
                <Switch
                  checked={branchDetails.isActive}
                  onCheckedChange={(checked) => {
                    // Toggle branch active status via API
                    fetch('/api/branches', {
                      method: 'PUT',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ id: branchDetails.id, isActive: checked }),
                    }).then((res) => {
                      if (res.ok) {
                        setBranchDetails((prev) => (prev ? { ...prev, isActive: checked } : prev));
                        setBranchForm((prev) => (prev ? { ...prev, isActive: checked } : prev));
                        setBranches((prev) =>
                          prev.map((b) => (b.id === branchDetails.id ? { ...b, enabled: checked } : b))
                        );
                        toast.success(checked ? t.enableBranch : t.disableBranch);
                      } else {
                        toast.error(t.branchSaveFailed);
                      }
                    }).catch(() => toast.error(t.branchSaveFailed));
                  }}
                />
                <span className="text-sm text-muted-foreground whitespace-nowrap">
                  {branchDetails.isActive ? t.active : t.inactive}
                </span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Loading state for branch details */}
      {isBranchDetailsLoading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-8 animate-spin text-primary" />
        </div>
      )}

      {/* Empty state */}
      {!isBranchDetailsLoading && !branchForm && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Building className="size-10 mx-auto mb-3 opacity-50" />
            <p className="text-sm">
              {branches.length === 0 ? t.noBranchesAvailable : t.selectBranchToEdit}
            </p>
          </CardContent>
        </Card>
      )}

      {/* ===== Section 1: Branch Basic Info ===== */}
      {branchForm && (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <Building className="size-4" />
            </div>
            <div>
              <CardTitle className="text-base">{t.branchBasicInfo}</CardTitle>
              <CardDescription>{t.branchBasicInfoDesc}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="branch-name">{t.branchName}</Label>
              <Input
                id="branch-name"
                value={branchForm.name}
                onChange={(e) => updateBranchForm('name', e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="branch-name-en">{t.branchNameEn}</Label>
              <Input
                id="branch-name-en"
                value={branchForm.nameEn || ''}
                onChange={(e) => updateBranchForm('nameEn', e.target.value)}
                dir="ltr"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="branch-code">{t.branchCode}</Label>
              <Input
                id="branch-code"
                value={branchForm.code}
                disabled
                dir="ltr"
                className="font-mono text-sm bg-muted/50"
              />
              <p className="text-xs text-muted-foreground">{t.branchCode} (read-only)</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="branch-manager">{t.branchManager}</Label>
              <Input
                id="branch-manager"
                value={branchForm.manager || ''}
                onChange={(e) => updateBranchForm('manager', e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>
      )}

      {/* ===== Section 2: Branch Contact ===== */}
      {branchForm && (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-md bg-teal-500/10 text-teal-600 dark:text-teal-400">
              <Globe className="size-4" />
            </div>
            <div>
              <CardTitle className="text-base">{t.branchContact}</CardTitle>
              <CardDescription>{t.branchContactDesc}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="branch-phone">{t.phone}</Label>
              <Input
                id="branch-phone"
                value={branchForm.phone || ''}
                onChange={(e) => updateBranchForm('phone', e.target.value)}
                dir="ltr"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="branch-email">{t.branchEmail}</Label>
              <Input
                id="branch-email"
                type="email"
                value={branchForm.email || ''}
                onChange={(e) => updateBranchForm('email', e.target.value)}
                dir="ltr"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="branch-address">{t.address}</Label>
              <Textarea
                id="branch-address"
                value={branchForm.address || ''}
                onChange={(e) => updateBranchForm('address', e.target.value)}
                rows={2}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="branch-address-en">{t.branchAddressEn}</Label>
              <Textarea
                id="branch-address-en"
                value={branchForm.addressEn || ''}
                onChange={(e) => updateBranchForm('addressEn', e.target.value)}
                rows={2}
                dir="ltr"
              />
            </div>
          </div>
        </CardContent>
      </Card>
      )}

      {/* ===== Section 3: Branch Financial ===== */}
      {branchForm && (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400">
              <DollarSignIcon className="size-4" />
            </div>
            <div>
              <CardTitle className="text-base">{t.branchFinancial}</CardTitle>
              <CardDescription>{t.branchFinancialDesc}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="branch-vat">{t.branchVatNumber}</Label>
              <Input
                id="branch-vat"
                value={branchForm.vatNumber || ''}
                onChange={(e) => updateBranchForm('vatNumber', e.target.value)}
                dir="ltr"
                placeholder="300000000000003"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="branch-tax-rate">{t.branchTaxRate}</Label>
              <Input
                id="branch-tax-rate"
                type="number"
                min="0"
                max="100"
                step="0.5"
                value={branchForm.taxRate ?? ''}
                onChange={(e) =>
                  updateBranchForm('taxRate', e.target.value === '' ? null : Number(e.target.value))
                }
                placeholder={systemSettings.taxRate || '15'}
              />
              <p className="text-xs text-muted-foreground">{t.branchTaxRateHint}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="branch-max-discount">{t.branchMaxDiscount}</Label>
              <Input
                id="branch-max-discount"
                type="number"
                min="0"
                max="100"
                step="0.5"
                value={branchForm.maxDiscountPercentage ?? ''}
                onChange={(e) =>
                  updateBranchForm(
                    'maxDiscountPercentage',
                    e.target.value === '' ? null : Number(e.target.value)
                  )
                }
                placeholder={maxDiscountPercentage || '0'}
              />
              <p className="text-xs text-muted-foreground">{t.branchMaxDiscountHint}</p>
            </div>
          </div>
        </CardContent>
      </Card>
      )}

      {/* ===== Section 4: Branch Logo ===== */}
      {branchForm && (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <ImageIcon className="size-4" />
            </div>
            <div>
              <CardTitle className="text-base">{t.branchLogoSection}</CardTitle>
              <CardDescription>{t.branchLogoSectionDesc}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4 rounded-lg border p-4">
            {/* Logo preview */}
            <div className="size-24 rounded-lg border-2 border-dashed flex items-center justify-center bg-muted/50 overflow-hidden flex-shrink-0">
              {branchLogos[branchForm.id] ? (
                <img
                  src={branchLogos[branchForm.id]}
                  alt={t.branchLogo}
                  className="size-full object-contain p-1"
                />
              ) : (
                <ImageIcon className="size-10 text-muted-foreground/50" />
              )}
            </div>
            {/* Upload / Delete controls */}
            <div className="flex-1 space-y-2">
              <input
                type="file"
                accept=".png,.jpg,.jpeg"
                className="hidden"
                id={`logo-upload-${branchForm.id}`}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleLogoUpload(branchForm.id, file);
                }}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  disabled={isLogoUploading === branchForm.id}
                  onClick={() => document.getElementById(`logo-upload-${branchForm.id}`)?.click()}
                >
                  {isLogoUploading === branchForm.id ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Upload className="size-4" />
                  )}
                  {t.uploadBranchLogo}
                </Button>
                {branchLogos[branchForm.id] && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1 text-destructive"
                    onClick={() => handleDeleteLogo(branchForm.id)}
                  >
                    <Trash2 className="size-3.5" />
                    {t.deleteLogo}
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">PNG / JPG — 2MB</p>
            </div>
          </div>
        </CardContent>
      </Card>
      )}

      {/* ===== Section 5: Branch Receipt Customization ===== */}
      {branchForm && (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-md bg-violet-500/10 text-violet-600 dark:text-violet-400">
              <Settings className="size-4" />
            </div>
            <div>
              <CardTitle className="text-base">{t.branchReceipt}</CardTitle>
              <CardDescription>{t.branchReceiptDesc}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="branch-receipt-header">{t.branchReceiptHeader}</Label>
            <Textarea
              id="branch-receipt-header"
              value={branchForm.receiptHeader || ''}
              onChange={(e) => updateBranchForm('receiptHeader', e.target.value)}
              rows={2}
              placeholder={t.branchReceiptDesc}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="branch-receipt-footer">{t.branchReceiptFooter}</Label>
            <Textarea
              id="branch-receipt-footer"
              value={branchForm.receiptFooter || ''}
              onChange={(e) => updateBranchForm('receiptFooter', e.target.value)}
              rows={2}
              placeholder={t.branchReceiptDesc}
            />
          </div>
        </CardContent>
      </Card>
      )}

      {/* ===== Section 6: Branch Tables Management ===== */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-md bg-teal-500/10 text-teal-600 dark:text-teal-400">
              <ShoppingCart className="size-4" />
            </div>
            <div>
              <CardTitle className="text-base">{t.branchTablesSection}</CardTitle>
              <CardDescription>{t.addTable}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Branch selector */}
          <div className="space-y-2">
            <Label>{t.selectBranch}</Label>
            <Select
              value={selectedBranchForTables}
              onValueChange={(value) => {
                setSelectedBranchForTables(value);
                fetchTables(value);
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {branches.filter((b) => b.enabled).map((branch) => (
                  <SelectItem key={branch.id} value={branch.id}>
                    {branch.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {isTablesLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="size-6 animate-spin text-primary" />
            </div>
          ) : (
            <>
              {/* Tables list */}
              <div className="space-y-2">
                {(tablesByBranch[selectedBranchForTables] || []).length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <ShoppingCart className="size-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">{t.noTablesYet}</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                    {(tablesByBranch[selectedBranchForTables] || []).map((table) => (
                      <div
                        key={table.id}
                        className="relative group rounded-lg border p-3 text-center hover:border-primary/50 transition-colors"
                      >
                        <div className="font-semibold text-lg">{table.name}</div>
                        <div className="flex items-center justify-center gap-1 mt-2">
                          <Input
                            value={table.name}
                            onChange={(e) => {
                              // Optimistic update
                              setTablesByBranch((prev) => ({
                                ...prev,
                                [selectedBranchForTables]: (prev[selectedBranchForTables] || []).map((t_item) =>
                                  t_item.id === table.id ? { ...t_item, name: e.target.value } : t_item
                                ),
                              }));
                            }}
                            onBlur={(e) => handleRenameTable(table.id, e.target.value)}
                            className="h-7 text-sm text-center"
                          />
                        </div>
                        <button
                          onClick={() => handleDeleteTable(table.id)}
                          className="absolute -top-2 -left-2 size-5 rounded-full bg-destructive text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <X className="size-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Add table controls */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-2 flex-1 min-w-[200px]">
                  <Input
                    placeholder={t.tableName}
                    value={newTableName}
                    onChange={(e) => setNewTableName(e.target.value)}
                    className="h-9"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleAddTable();
                    }}
                  />
                  <Button
                    size="sm"
                    onClick={handleAddTable}
                    disabled={isTableSaving || !newTableName.trim()}
                    className="gap-1"
                  >
                    {isTableSaving ? <Loader2 className="size-3 animate-spin" /> : <Plus className="size-3" />}
                    {t.add}
                  </Button>
                </div>
                <Separator orientation="vertical" className="!h-6" />
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span>{t.addBulkTables}:</span>
                  {[5, 10, 15, 20].map((count) => (
                    <Button
                      key={count}
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => handleAddBulkTables(count)}
                      disabled={isTableSaving}
                    >
                      {count}
                    </Button>
                  ))}
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ===== Section 7: Branch Products & Categories ===== */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-md bg-teal-500/10 text-teal-600 dark:text-teal-400">
              <Package className="size-4" />
            </div>
            <div>
              <CardTitle className="text-base">{t.branchProductsSection}</CardTitle>
              <CardDescription>{t.addProductBtn}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Branch selector */}
          <div className="space-y-2">
            <Label>{t.selectBranch}</Label>
            <Select
              value={selectedBranchForProducts}
              onValueChange={(value) => {
                setSelectedBranchForProducts(value);
                setSelectedCategoryForProducts('all');
                fetchCategories(value);
                fetchProducts(value, 'all');
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {branches.filter((b) => b.enabled).map((branch) => (
                  <SelectItem key={branch.id} value={branch.id}>
                    {branch.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedBranchForProducts && (
            <Tabs value={productsTab} onValueChange={setProductsTab}>
              <TabsList className="w-full">
                <TabsTrigger value="categories" className="flex-1 gap-1">
                  <FolderOpen className="size-3.5" />
                  {t.categoryManagement}
                </TabsTrigger>
                <TabsTrigger value="products" className="flex-1 gap-1">
                  <Package className="size-3.5" />
                  {t.productManagement}
                </TabsTrigger>
              </TabsList>

              {/* Categories Tab */}
              <TabsContent value="categories" className="space-y-4 mt-4">
                {isCategoriesLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="size-6 animate-spin text-primary" />
                  </div>
                ) : (
                  <>
                    {/* Categories grid */}
                    {categories.filter((c) => c.isActive).length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground">
                        <FolderOpen className="size-8 mx-auto mb-2 opacity-50" />
                        <p className="text-sm">{t.noData}</p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                        {categories.filter((c) => c.isActive).map((cat) => (
                          <div
                            key={cat.id}
                            className="relative group rounded-lg border p-3 hover:border-primary/50 transition-colors"
                          >
                            {/* Color indicator */}
                            {cat.color && (
                              <div
                                className="absolute top-2 left-2 size-3 rounded-full"
                                style={{ backgroundColor: cat.color }}
                              />
                            )}
                            {/* Delete button */}
                            <button
                              onClick={() => handleDeleteCategory(cat.id)}
                              className="absolute -top-2 -left-2 size-5 rounded-full bg-destructive text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10"
                              title={t.delete}
                            >
                              <X className="size-3" />
                            </button>
                            {/* Icon */}
                            <div className="text-center mb-1">
                              {cat.icon ? (
                                <span className="text-2xl">{cat.icon}</span>
                              ) : (
                                <Tag className="size-5 mx-auto text-muted-foreground" />
                              )}
                            </div>
                            {/* Name - inline edit */}
                            {editingCategoryId === cat.id ? (
                              <Input
                                value={editingCategoryName}
                                onChange={(e) => setEditingCategoryName(e.target.value)}
                                onBlur={() => {
                                  if (editingCategoryName.trim()) {
                                    handleUpdateCategory(cat.id, { name: editingCategoryName.trim() });
                                  }
                                  setEditingCategoryId(null);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    if (editingCategoryName.trim()) {
                                      handleUpdateCategory(cat.id, { name: editingCategoryName.trim() });
                                    }
                                    setEditingCategoryId(null);
                                  }
                                  if (e.key === 'Escape') {
                                    setEditingCategoryId(null);
                                  }
                                }}
                                className="h-7 text-sm text-center"
                                autoFocus
                              />
                            ) : (
                              <div
                                className="flex items-center justify-center gap-1 cursor-pointer"
                                onClick={() => {
                                  setEditingCategoryId(cat.id);
                                  setEditingCategoryName(cat.name);
                                }}
                              >
                                <span className="font-medium text-sm truncate">{cat.name}</span>
                                <Pencil className="size-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                              </div>
                            )}
                            {/* Product count badge */}
                            <div className="flex justify-center mt-2">
                              <Badge variant="secondary" className="text-xs">
                                {cat.productsCount} {t.productName}
                              </Badge>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Add category form */}
                    <div className="rounded-lg border border-dashed p-3 space-y-3">
                      <p className="text-sm font-medium text-muted-foreground">{t.addCategory}</p>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <div className="space-y-1">
                          <Label className="text-xs">{t.categoryName}</Label>
                          <Input
                            placeholder={t.categoryName}
                            value={newCategoryName}
                            onChange={(e) => setNewCategoryName(e.target.value)}
                            className="h-9"
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleAddCategory();
                            }}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">{t.categoryIcon}</Label>
                          <Input
                            placeholder="☕"
                            value={newCategoryIcon}
                            onChange={(e) => setNewCategoryIcon(e.target.value)}
                            className="h-9"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">{t.categoryColor}</Label>
                          <div className="flex items-center gap-2">
                            <Input
                              placeholder="#ff6600"
                              value={newCategoryColor}
                              onChange={(e) => setNewCategoryColor(e.target.value)}
                              className="h-9"
                              dir="ltr"
                            />
                            {newCategoryColor && (
                              <div
                                className="size-6 rounded border flex-shrink-0"
                                style={{ backgroundColor: newCategoryColor }}
                              />
                            )}
                          </div>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        onClick={handleAddCategory}
                        disabled={isCategorySaving || !newCategoryName.trim()}
                        className="gap-1"
                      >
                        {isCategorySaving ? <Loader2 className="size-3 animate-spin" /> : <Plus className="size-3" />}
                        {t.addCategory}
                      </Button>
                    </div>
                  </>
                )}
              </TabsContent>

              {/* Products Tab */}
              <TabsContent value="products" className="space-y-4 mt-4">
                {isProductsLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="size-6 animate-spin text-primary" />
                  </div>
                ) : (
                  <>
                    {/* Category filter */}
                    <div className="space-y-2">
                      <Label>{t.selectCategory}</Label>
                      <Select
                        value={selectedCategoryForProducts}
                        onValueChange={(value) => {
                          setSelectedCategoryForProducts(value);
                          if (selectedBranchForProducts) {
                            fetchProducts(selectedBranchForProducts, value);
                          }
                        }}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">{t.allCategories}</SelectItem>
                          {categories.filter((c) => c.isActive).map((cat) => (
                            <SelectItem key={cat.id} value={cat.id}>
                              {cat.icon ? `${cat.icon} ` : ''}{cat.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Products grid */}
                    {products.filter((p) => p.isActive).length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground">
                        <Package className="size-8 mx-auto mb-2 opacity-50" />
                        <p className="text-sm">{t.noProducts}</p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                        {products.filter((p) => p.isActive).map((product) => (
                          <div
                            key={product.id}
                            className="relative group rounded-lg border p-3 hover:border-primary/50 transition-colors"
                          >
                            {/* Delete button */}
                            <button
                              onClick={() => handleDeleteProduct(product.id)}
                              className="absolute -top-2 -left-2 size-5 rounded-full bg-destructive text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10"
                              title={t.delete}
                            >
                              <X className="size-3" />
                            </button>
                            {/* Category color indicator */}
                            {product.category?.color && (
                              <div
                                className="absolute top-2 left-2 size-2.5 rounded-full"
                                style={{ backgroundColor: product.category.color }}
                              />
                            )}
                            {/* Product name - inline edit */}
                            {editingProductId === product.id ? (
                              <Input
                                value={editingProductName}
                                onChange={(e) => setEditingProductName(e.target.value)}
                                onBlur={() => {
                                  if (editingProductName.trim()) {
                                    handleUpdateProduct(product.id, { name: editingProductName.trim() });
                                  }
                                  setEditingProductId(null);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    if (editingProductName.trim()) {
                                      handleUpdateProduct(product.id, { name: editingProductName.trim() });
                                    }
                                    setEditingProductId(null);
                                  }
                                  if (e.key === 'Escape') {
                                    setEditingProductId(null);
                                  }
                                }}
                                className="h-7 text-sm mb-1"
                                autoFocus
                              />
                            ) : (
                              <div
                                className="flex items-center gap-1 cursor-pointer mb-1"
                                onClick={() => {
                                  setEditingProductId(product.id);
                                  setEditingProductName(product.name);
                                }}
                              >
                                <span className="font-medium text-sm truncate">{product.name}</span>
                                <Pencil className="size-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                              </div>
                            )}
                            {/* Price - inline edit */}
                            {editingProductId === `price-${product.id}` ? (
                              <Input
                                type="number"
                                value={editingProductPrice}
                                onChange={(e) => setEditingProductPrice(e.target.value)}
                                onBlur={() => {
                                  const priceVal = parseFloat(editingProductPrice);
                                  if (!isNaN(priceVal) && priceVal >= 0) {
                                    handleUpdateProduct(product.id, { price: priceVal });
                                  }
                                  setEditingProductId(null);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    const priceVal = parseFloat(editingProductPrice);
                                    if (!isNaN(priceVal) && priceVal >= 0) {
                                      handleUpdateProduct(product.id, { price: priceVal });
                                    }
                                    setEditingProductId(null);
                                  }
                                  if (e.key === 'Escape') {
                                    setEditingProductId(null);
                                  }
                                }}
                                className="h-7 text-sm"
                                dir="ltr"
                                autoFocus
                              />
                            ) : (
                              <div
                                className="flex items-center gap-1 cursor-pointer"
                                onClick={() => {
                                  setEditingProductId(`price-${product.id}`);
                                  setEditingProductPrice(String(product.price));
                                }}
                              >
                                <span className="text-sm text-primary font-semibold"><CurrencyAmount amount={product.price} symbolClassName="w-3 h-3" /></span>
                                <Pencil className="size-2.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                              </div>
                            )}
                            {/* Category name */}
                            {product.category && (
                              <Badge variant="outline" className="text-xs mt-1.5">
                                {product.category.icon ? `${product.category.icon} ` : ''}{product.category.name}
                              </Badge>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Add product form */}
                    <div className="rounded-lg border border-dashed p-3 space-y-3">
                      <p className="text-sm font-medium text-muted-foreground">{t.addProductBtn}</p>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <div className="space-y-1">
                          <Label className="text-xs">{t.productName}</Label>
                          <Input
                            placeholder={t.productName}
                            value={newProductName}
                            onChange={(e) => setNewProductName(e.target.value)}
                            className="h-9"
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleAddProduct();
                            }}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">{t.productPrice}</Label>
                          <Input
                            type="number"
                            placeholder="0.00"
                            value={newProductPrice}
                            onChange={(e) => setNewProductPrice(e.target.value)}
                            className="h-9"
                            dir="ltr"
                            min="0"
                            step="0.5"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">{t.selectCategory}</Label>
                          <Select
                            value={newProductCategory}
                            onValueChange={setNewProductCategory}
                          >
                            <SelectTrigger className="h-9">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {categories.filter((c) => c.isActive).map((cat) => (
                                <SelectItem key={cat.id} value={cat.id}>
                                  {cat.icon ? `${cat.icon} ` : ''}{cat.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        onClick={handleAddProduct}
                        disabled={isProductSaving || !newProductName.trim() || !newProductPrice || !newProductCategory}
                        className="gap-1"
                      >
                        {isProductSaving ? <Loader2 className="size-3 animate-spin" /> : <Plus className="size-3" />}
                        {t.addProductBtn}
                      </Button>
                    </div>
                  </>
                )}
              </TabsContent>
            </Tabs>
          )}
        </CardContent>
      </Card>

      {/* ===== Section 8: Add New Branch ===== */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <Plus className="size-4" />
            </div>
            <div>
              <CardTitle className="text-base">{t.branchManagement}</CardTitle>
              <CardDescription>{t.addBranch}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {showNewBranch ? (
            <div className="flex items-center gap-3 rounded-lg border border-dashed p-3">
              <Input
                placeholder={t.enterBranchName}
                value={newBranchName}
                onChange={(e) => setNewBranchName(e.target.value)}
                className="flex-1 h-8"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addBranch();
                }}
              />
              <Button size="sm" onClick={addBranch} disabled={isAddingBranch} className="gap-1">
                {isAddingBranch ? <Loader2 className="size-3 animate-spin" /> : <Plus className="size-3" />}
                {t.add}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setShowNewBranch(false);
                  setNewBranchName('');
                }}
              >
                {t.cancel}
              </Button>
            </div>
          ) : (
            <Button
              variant="outline"
              onClick={() => setShowNewBranch(true)}
              className="gap-2 w-full border-dashed"
            >
              <Plus className="size-4" />
              {t.addBranch}
            </Button>
          )}
        </CardContent>
      </Card>

        </TabsContent>

        {/* ========== Print Settings Tab (General Printing Defaults) ========== */}
        <TabsContent value="print" className="space-y-6 mt-6">

      {/* 3.7. Print Settings for POS Receipts (General / system-wide defaults) */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-md bg-violet-500/10 text-violet-600 dark:text-violet-400">
              <Settings className="size-4" />
            </div>
            <div>
              <CardTitle className="text-base">{t.printSettings}</CardTitle>
              <CardDescription>{t.receiptWidth}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Receipt Width */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">
                {t.receiptWidth}
              </Label>
              <Input
                type="number"
                min="58"
                max="120"
                step="1"
                value={printSettings.receiptWidth}
                onChange={(e) => setPrintSettings(prev => ({ ...prev, receiptWidth: parseInt(e.target.value) || 80 }))}
                onBlur={() => handleSavePrintSetting('receiptWidth', String(printSettings.receiptWidth))}
                className="h-9"
              />
            </div>

            {/* Font Size */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">
                {t.receiptFontSize}
              </Label>
              <Input
                type="number"
                min="8"
                max="16"
                step="1"
                value={printSettings.fontSize}
                onChange={(e) => setPrintSettings(prev => ({ ...prev, fontSize: parseInt(e.target.value) || 11 }))}
                onBlur={() => handleSavePrintSetting('receiptFontSize', String(printSettings.fontSize))}
                className="h-9"
              />
            </div>

            {/* Logo Width */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">
                {t.logoWidth}
              </Label>
              <Input
                type="number"
                min="10"
                max="80"
                step="1"
                value={printSettings.logoWidth}
                onChange={(e) => setPrintSettings(prev => ({ ...prev, logoWidth: parseInt(e.target.value) || 40 }))}
                onBlur={() => handleSavePrintSetting('logoWidth', String(printSettings.logoWidth))}
                className="h-9"
              />
            </div>

            {/* Logo Height */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">
                {t.logoHeight}
              </Label>
              <Input
                type="number"
                min="5"
                max="60"
                step="1"
                value={printSettings.logoHeight}
                onChange={(e) => setPrintSettings(prev => ({ ...prev, logoHeight: parseInt(e.target.value) || 20 }))}
                onBlur={() => handleSavePrintSetting('logoHeight', String(printSettings.logoHeight))}
                className="h-9"
              />
            </div>
          </div>

          {/* Preview */}
          <div className="mt-4 pt-4 border-t">
            <Label className="text-sm font-medium mb-3 block">{t.receiptWidth}</Label>
            <div className="flex justify-center">
              <div
                className="border-2 border-dashed border-muted-foreground/30 bg-white rounded-md"
                style={{
                  width: `${printSettings.receiptWidth}mm`,
                  minHeight: '40mm',
                  padding: '4mm',
                  fontSize: `${printSettings.fontSize}px`,
                  lineHeight: '1.5',
                  color: '#000',
                  fontFamily: "'Segoe UI', Tahoma, Arial, sans-serif",
                }}
              >
                <div style={{ textAlign: 'center' }}>
                  <div style={{
                    width: `${printSettings.logoWidth}mm`,
                    height: `${printSettings.logoHeight}mm`,
                    margin: '0 auto 4px',
                    border: '1px dashed #ccc',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#999',
                    fontSize: '8px',
                    objectFit: 'contain',
                  }}>
                    Logo
                  </div>
                  <div style={{ fontWeight: 700, fontSize: `${printSettings.fontSize + 4}px` }}>{t.companyName}</div>
                  <div style={{ fontSize: `${printSettings.fontSize - 2}px`, color: '#666' }}>Company Name</div>
                </div>
                <div style={{ borderTop: '1px dashed #555', margin: '3px 0' }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: `${printSettings.fontSize - 1}px` }}>
                  <span>{t.invoice}</span>
                  <span>POS-0001</span>
                </div>
                <div style={{ borderTop: '1px dashed #555', margin: '3px 0' }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: `${printSettings.fontSize - 1}px` }}>
                  <span>{t.total}</span>
                  <span>100.00</span>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

        </TabsContent>

        {/* ========== General Settings Tab (continued) ========== */}
        <TabsContent value="general" className="space-y-6 mt-6">

      {/* 4. Period Management */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-md bg-teal-500/10 text-teal-600 dark:text-teal-400">
              <Calendar className="size-4" />
            </div>
            <div>
              <CardTitle className="text-base">{t.fiscalPeriods}</CardTitle>
              <CardDescription>{t.closeCurrentPeriod}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Current Period */}
          {currentPeriod ? (
            <div className="rounded-lg border p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-muted-foreground">{t.currentPeriod}</span>
                <Badge
                  variant={currentPeriod.status === 'OPEN' ? 'default' : 'secondary'}
                  className="gap-1"
                >
                  {currentPeriod.status === 'OPEN' ? (
                    <>
                      <Unlock className="size-3" />
                      {t.open}
                    </>
                  ) : (
                    <>
                      <Lock className="size-3" />
                      {t.closed}
                    </>
                  )}
                </Badge>
              </div>
              <div className="font-semibold text-foreground">{currentPeriod.name}</div>
              <div className="text-sm text-muted-foreground">
                {t.from} {formatDate(currentPeriod.startDate)} {t.to} {formatDate(currentPeriod.endDate)}
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed p-4 text-center">
              <Calendar className="size-8 mx-auto mb-2 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">{t.noOpenPeriod}</p>
              <p className="text-xs text-muted-foreground mt-1">
                {t.openNewPeriod}
              </p>
            </div>
          )}

          {/* Period List */}
          {fiscalPeriods.length > 0 && (
            <div className="rounded-lg border overflow-hidden">
              <div className="bg-muted/50 px-4 py-2 text-sm font-medium">{t.fiscalPeriods}</div>
              <div className="max-h-40 overflow-y-auto">
                {fiscalPeriods.map((period) => (
                  <div
                    key={period.id}
                    className="flex items-center justify-between px-4 py-2 border-b last:border-b-0 text-sm"
                  >
                    <span className="font-medium">{period.name}</span>
                    <div className="flex items-center gap-3">
                      <span className="text-muted-foreground text-xs">
                        {formatDate(period.startDate)} - {formatDate(period.endDate)}
                      </span>
                      <Badge
                        variant={period.status === 'OPEN' ? 'default' : 'outline'}
                        className="text-xs"
                      >
                        {period.status === 'OPEN' ? t.open : t.closed}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Period Actions */}
          <div className="flex flex-wrap gap-3">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="outline"
                  disabled={!currentPeriod || currentPeriod.status === 'CLOSED' || isClosingPeriod}
                  className="gap-2"
                >
                  {isClosingPeriod ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Lock className="size-4" />
                  )}
                  {t.closePeriod}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent dir={isRTL ? 'rtl' : 'ltr'}>
                <AlertDialogHeader>
                  <AlertDialogTitle className="flex items-center gap-2">
                    <AlertTriangle className="size-5 text-amber-500" />
                    {t.closePeriod}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {t.closeCurrentPeriod}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t.cancel}</AlertDialogCancel>
                  <AlertDialogAction onClick={handleClosePeriod} className="bg-amber-600 hover:bg-amber-700">
                    {t.confirm}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            <Button
              variant="outline"
              onClick={handleOpenNewPeriod}
              disabled={isOpeningPeriod}
              className="gap-2"
            >
              {isOpeningPeriod ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Unlock className="size-4" />
              )}
              {t.openNewPeriod}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 5. Data Management */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400">
              <Database className="size-4" />
            </div>
            <div>
              <CardTitle className="text-base">{t.dataManagement}</CardTitle>
              <CardDescription>{t.dataManagement}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Recalculate Balances */}
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div className="flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-md bg-primary/10 text-primary">
                <RefreshCw className="size-4" />
              </div>
              <div>
                <div className="font-medium text-sm">{t.recalculateBalances}</div>
                <div className="text-xs text-muted-foreground">
                  {t.recalculateBalances}
                </div>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRecalculate}
              disabled={isRecalculating}
              className="gap-2"
            >
              {isRecalculating ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCw className="size-4" />
              )}
              {t.refresh}
            </Button>
          </div>

          {/* Seed Default Accounts */}
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div className="flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-md bg-primary/10 text-primary">
                <Shield className="size-4" />
              </div>
              <div>
                <div className="font-medium text-sm">{t.seedDefaultAccounts}</div>
                <div className="text-xs text-muted-foreground">
                  {t.seedDefaultAccounts}
                </div>
              </div>
            </div>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isSeeding}
                  className="gap-2"
                >
                  {isSeeding ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Shield className="size-4" />
                  )}
                  {t.seedDefaultAccounts}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent dir={isRTL ? 'rtl' : 'ltr'}>
                <AlertDialogHeader>
                  <AlertDialogTitle className="flex items-center gap-2">
                    <AlertTriangle className="size-5 text-amber-500" />
                    {t.seedDefaultAccounts}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {t.seedDefaultAccounts}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t.cancel}</AlertDialogCancel>
                  <AlertDialogAction onClick={handleSeedAccounts}>
                    {t.confirm}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>

          {/* Delete All Data */}
          <div className="flex items-center justify-between rounded-lg border border-destructive/30 bg-destructive/5 p-4">
            <div className="flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-md bg-destructive/10 text-destructive">
                <Trash2 className="size-4" />
              </div>
              <div>
                <div className="font-medium text-sm text-destructive">{t.purgeAllData}</div>
                <div className="text-xs text-muted-foreground">
                  {t.purgeWarning}
                </div>
              </div>
            </div>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={isPurging}
                  className="gap-2"
                >
                  {isPurging ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Trash2 className="size-4" />
                  )}
                  {t.delete}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent dir={isRTL ? 'rtl' : 'ltr'}>
                <AlertDialogHeader>
                  <AlertDialogTitle className="flex items-center gap-2">
                    <AlertTriangle className="size-5 text-destructive" />
                    {t.purgeAllData}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {t.purgeConfirm}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t.cancel}</AlertDialogCancel>
                  {/* Double confirmation: nested AlertDialog */}
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="destructive" className="gap-2">
                        <Trash2 className="size-4" />
                        {t.confirm}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent dir={isRTL ? 'rtl' : 'ltr'}>
                      <AlertDialogHeader>
                        <AlertDialogTitle className="flex items-center gap-2">
                          <AlertTriangle className="size-5 text-destructive" />
                          {t.purgeAllData}
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          {t.purgeConfirm}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>{t.cancel}</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={handlePurgeData}
                          className="bg-destructive text-white hover:bg-destructive/90"
                        >
                          {t.delete}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </CardContent>
      </Card>

      {/* 6. Appearance */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              {theme === 'dark' ? (
                <Moon className="size-4" />
              ) : (
                <Sun className="size-4" />
              )}
            </div>
            <div>
              <CardTitle className="text-base">{t.toggleTheme}</CardTitle>
              <CardDescription>{t.lightMode} / {t.darkMode}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div className="flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-md bg-muted">
                {theme === 'dark' ? (
                  <Moon className="size-4 text-primary" />
                ) : (
                  <Sun className="size-4 text-primary" />
                )}
              </div>
              <div>
                <div className="font-medium text-sm">{t.darkMode}</div>
                <div className="text-xs text-muted-foreground">
                  {theme === 'dark'
                    ? t.darkMode
                    : t.lightMode}
                </div>
              </div>
            </div>
            <Switch
              checked={theme === 'dark'}
              onCheckedChange={(checked) => setTheme(checked ? 'dark' : 'light')}
            />
          </div>
        </CardContent>
      </Card>

      {/* Bottom save bar */}
      <div className="sticky bottom-4 flex justify-end">
        <Button onClick={handleSave} disabled={isSaving} size="lg" className="gap-2 shadow-lg">
          {isSaving ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Save className="size-4" />
          )}
          {t.saveSettings}
        </Button>
      </div>

        </TabsContent>

        {/* ========== Diagnostics Tab ========== */}
        <TabsContent value="diagnostics" className="space-y-6 mt-6">

          {/* Refresh Button */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Activity className="size-5" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-foreground">{t.diagnosticsTitle}</h3>
                <p className="text-sm text-muted-foreground">{t.diagnosticsDesc}</p>
              </div>
            </div>
            <Button
              variant="outline"
              onClick={fetchDiagnostics}
              disabled={isDiagnosticsLoading}
              className="gap-2"
            >
              {isDiagnosticsLoading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCw className="size-4" />
              )}
              {t.refresh}
            </Button>
          </div>

          {/* 1. Database Information Card */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex size-9 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                    <Database className="size-4" />
                  </div>
                  <div>
                    <CardTitle className="text-base">{t.databaseInfo}</CardTitle>
                    <CardDescription>{t.databaseInfoDesc}</CardDescription>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleTestConnection}
                    className="gap-1"
                  >
                    {dbConnectionStatus === 'ok' ? (
                      <CheckCircle className="size-3.5 text-green-500" />
                    ) : dbConnectionStatus === 'fail' ? (
                      <XCircle className="size-3.5 text-red-500" />
                    ) : null}
                    {t.testConnection}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {diagnostics ? (
                <>
                  <div className="space-y-3">
                    <div className="rounded-lg border bg-muted/30 p-3">
                      <p className="text-xs text-muted-foreground">DATABASE_URL</p>
                      <p className="text-sm font-mono truncate" dir="ltr">{diagnostics.database?.url || 'N/A'}</p>
                    </div>
                    <div className="rounded-lg border bg-muted/30 p-3">
                      <p className="text-xs text-muted-foreground">{t.dbFileSize}</p>
                      <p className="text-sm font-mono" dir="ltr">
                        {diagnostics.database?.configured
                          ? 'PostgreSQL ✓'
                          : t.notAvailable}
                      </p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                    <div className="rounded-lg border bg-muted/30 p-3">
                      <p className="text-xs text-muted-foreground">{t.users}</p>
                      <p className="text-2xl font-bold">{diagnostics.database?.users ?? 0}</p>
                    </div>
                    <div className="rounded-lg border bg-muted/30 p-3">
                      <p className="text-xs text-muted-foreground">{t.accounts}</p>
                      <p className="text-2xl font-bold">{diagnostics.database?.accounts ?? 0}</p>
                    </div>
                    <div className="rounded-lg border bg-muted/30 p-3">
                      <p className="text-xs text-muted-foreground">{t.products}</p>
                      <p className="text-2xl font-bold">{diagnostics.database?.products ?? 0}</p>
                    </div>
                    <div className="rounded-lg border bg-muted/30 p-3">
                      <p className="text-xs text-muted-foreground">{t.customers}</p>
                      <p className="text-2xl font-bold">{diagnostics.database?.customers ?? 0}</p>
                    </div>
                    <div className="rounded-lg border bg-muted/30 p-3">
                      <p className="text-xs text-muted-foreground">{t.branches}</p>
                      <p className="text-2xl font-bold">{diagnostics.database?.branches ?? 0}</p>
                    </div>
                    <div className="rounded-lg border bg-muted/30 p-3">
                      <p className="text-xs text-muted-foreground">{t.invoices}</p>
                      <p className="text-2xl font-bold">{diagnostics.database?.invoices ?? 0}</p>
                    </div>
                    <div className="rounded-lg border bg-muted/30 p-3">
                      <p className="text-xs text-muted-foreground">{t.journalEntries}</p>
                      <p className="text-2xl font-bold">{diagnostics.database?.journalEntries ?? 0}</p>
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex items-center justify-center py-8 text-muted-foreground">
                  <p className="text-sm">{t.clickRefreshToLoad}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* 2. System Status Card */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="flex size-9 items-center justify-center rounded-md bg-teal-500/10 text-teal-600 dark:text-teal-400">
                  <Shield className="size-4" />
                </div>
                <div>
                  <CardTitle className="text-base">{t.systemStatus}</CardTitle>
                  <CardDescription>{t.systemStatusDesc}</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {diagnostics ? (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="rounded-lg border bg-muted/30 p-3">
                    <p className="text-xs text-muted-foreground">Node.js</p>
                    <p className="text-sm font-mono" dir="ltr">{diagnostics.server?.nodeEnv === 'not set' ? 'N/A' : process.version || 'N/A'}</p>
                  </div>
                  <div className="rounded-lg border bg-muted/30 p-3">
                    <p className="text-xs text-muted-foreground">Platform</p>
                    <p className="text-sm font-mono" dir="ltr">{diagnostics.server?.platform || 'N/A'}</p>
                  </div>
                  <div className="rounded-lg border bg-muted/30 p-3">
                    <p className="text-xs text-muted-foreground">Architecture</p>
                    <p className="text-sm font-mono" dir="ltr">{diagnostics.server?.arch || 'N/A'}</p>
                  </div>
                  <div className="rounded-lg border bg-muted/30 p-3">
                    <p className="text-xs text-muted-foreground">NODE_ENV</p>
                    <Badge variant={diagnostics.server?.nodeEnv === 'production' ? 'default' : 'secondary'}>
                      {diagnostics.server?.nodeEnv || 'N/A'}
                    </Badge>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-center py-8 text-muted-foreground">
                  <p className="text-sm">{t.clickRefreshToLoad}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* 3. Currency & Logo Verification Card */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="flex size-9 items-center justify-center rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400">
                  <ImageIcon className="size-4" />
                </div>
                <div>
                  <CardTitle className="text-base">{t.currencyLogoVerification}</CardTitle>
                  <CardDescription>{t.currencyLogoVerificationDesc}</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Currency Symbol */}
              <div className="rounded-lg border p-4 space-y-2">
                <p className="text-sm font-medium">{t.currencySymbolImage}</p>
                {currencySymbolImage ? (
                  <div className="flex items-center gap-3">
                    <div className="size-12 rounded-lg border bg-muted/50 flex items-center justify-center overflow-hidden">
                      <img src={currencySymbolImage} alt={t.currencySymbolImage} className="size-full object-contain p-1" />
                    </div>
                    <div className="flex items-center gap-1 text-green-600 dark:text-green-400">
                      <CheckCircle className="size-4" />
                      <span className="text-xs">{t.configured}</span>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-1 text-amber-500">
                    <AlertTriangle className="size-4" />
                    <span className="text-xs">{t.notConfigured}</span>
                  </div>
                )}
              </div>

              {/* Branch Logos */}
              <div className="space-y-2">
                <p className="text-sm font-medium">{t.branchLogos}</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {branches.filter((b) => b.enabled).map((branch) => (
                    <div key={branch.id} className="rounded-lg border p-3 flex items-center gap-3">
                      <div className="size-10 rounded-lg border-2 border-dashed flex items-center justify-center bg-muted/50 overflow-hidden flex-shrink-0">
                        {branchLogos[branch.id] ? (
                          <img src={branchLogos[branch.id]} alt={branch.name} className="size-full object-contain p-0.5" />
                        ) : (
                          <ImageIcon className="size-5 text-muted-foreground/50" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{branch.name}</p>
                        {branchLogos[branch.id] ? (
                          <div className="flex items-center gap-1 text-green-600 dark:text-green-400">
                            <CheckCircle className="size-3" />
                            <span className="text-xs">{t.configured}</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1 text-amber-500">
                            <AlertTriangle className="size-3" />
                            <span className="text-xs">{t.notConfigured}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* 4. System Recovery Card */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="flex size-9 items-center justify-center rounded-md bg-rose-500/10 text-rose-600 dark:text-rose-400">
                  <Wrench className="size-4" />
                </div>
                <div>
                  <CardTitle className="text-base">{t.systemRecovery}</CardTitle>
                  <CardDescription>{t.systemRecoveryDesc}</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Auto-Fix Button */}
              <div className="flex items-center justify-between rounded-lg border p-4">
                <div className="flex items-center gap-3">
                  <div className="flex size-9 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <Wrench className="size-4" />
                  </div>
                  <div>
                    <div className="font-medium text-sm">{t.autoFixSystem}</div>
                    <div className="text-xs text-muted-foreground">{t.autoFixSystemDesc}</div>
                  </div>
                </div>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isRecovering}
                      className="gap-2"
                    >
                      {isRecovering ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Wrench className="size-4" />
                      )}
                      {t.autoFixSystem}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent dir={isRTL ? 'rtl' : 'ltr'}>
                    <AlertDialogHeader>
                      <AlertDialogTitle className="flex items-center gap-2">
                        <AlertTriangle className="size-5 text-amber-500" />
                        {t.autoFixSystem}
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        {t.autoFixConfirmMsg}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>{t.cancel}</AlertDialogCancel>
                      <AlertDialogAction onClick={handleRecover}>
                        {t.confirm}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>

              {/* Recovery Report */}
              {recoveryReport && (
                <div className="rounded-lg border p-4 space-y-3">
                  <p className="text-sm font-medium">{t.recoveryReport}</p>
                  {recoveryReport.fixes.length > 0 && (
                    <div className="space-y-1">
                      {recoveryReport.fixes.map((fix) => (
                        <div key={fix} className="flex items-start gap-2 text-sm">
                          <CheckCircle className="size-3.5 text-green-500 mt-0.5 flex-shrink-0" />
                          <span>{fix}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {recoveryReport.errors.length > 0 && (
                    <div className="space-y-1">
                      {recoveryReport.errors.map((err) => (
                        <div key={err} className="flex items-start gap-2 text-sm text-destructive">
                          <XCircle className="size-3.5 mt-0.5 flex-shrink-0" />
                          <span>{err}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <Separator />

              {/* Database Backup & Restore */}
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <div className="flex size-9 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <Database className="size-4" />
                  </div>
                  <div>
                    <div className="font-medium text-sm">{t.databaseBackupRestore || 'نسخ احتياطي واستعادة'}</div>
                    <div className="text-xs text-muted-foreground">{t.databaseBackupRestoreDesc || 'تصدير واستيراد قاعدة البيانات بالكامل'}</div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-3">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      try {
                        toast.info(t.exportingDatabase || 'جاري التصدير...');
                        const resp = await fetch('/api/data/export');
                        if (!resp.ok) throw new Error('Export failed');
                        const blob = await resp.blob();
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        const contentDisposition = resp.headers.get('Content-Disposition');
                        const match = contentDisposition?.match(/filename="?(.+?)"?$/);
                        a.download = match?.[1] || `chinese-plate-backup-${new Date().toISOString().slice(0, 10)}.json`;
                        a.click();
                        URL.revokeObjectURL(url);
                        toast.success(t.databaseExported || 'تم تصدير قاعدة البيانات بنجاح');
                      } catch (err: any) {
                        toast.error(t.databaseExportFailed || 'فشل في تصدير قاعدة البيانات');
                      }
                    }}
                    className="gap-2"
                  >
                    <Database className="size-3.5" />
                    {t.exportDatabase || 'تصدير النسخة الاحتياطية'}
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-2 border-amber-500/50 text-amber-600 hover:bg-amber-500/10"
                      >
                        <Upload className="size-3.5" />
                        {t.importDatabase || 'استعادة من نسخة احتياطية'}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent dir={isRTL ? 'rtl' : 'ltr'}>
                      <AlertDialogHeader>
                        <AlertDialogTitle className="flex items-center gap-2">
                          <AlertTriangle className="size-5 text-amber-500" />
                          {t.importDatabase || 'استعادة من نسخة احتياطية'}
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          {t.importDatabaseWarning || 'تحذير: ستتم استبدال قاعدة البيانات الحالية بالكامل بالملف المرفوع. سيتم حفظ نسخة احتياطية من القاعدة الحالية تلقائياً قبل الاستعادة. يجب إعادة تشغيل النظام بعد الاستعادة.'}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <div className="py-2">
                        <input
                          type="file"
                          accept=".json"
                          id="database-restore-input"
                          className="block w-full text-sm text-muted-foreground
                            file:mr-4 file:py-2 file:px-4
                            file:rounded-md file:border-0
                            file:text-sm file:font-semibold
                            file:bg-primary/10 file:text-primary
                            hover:file:bg-primary/20"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                              (e.target as any)._selectedFile = file;
                            }
                          }}
                        />
                      </div>
                      <AlertDialogFooter>
                        <AlertDialogCancel>{t.cancel || 'إلغاء'}</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={async () => {
                            const input = document.getElementById('database-restore-input') as any;
                            const file = input?._selectedFile || input?.files?.[0];
                            if (!file) {
                              toast.error(t.noFileSelected || 'لم يتم اختيار ملف');
                              return;
                            }
                            try {
                              const formData = new FormData();
                              formData.append('database', file);
                              const resp = await fetch('/api/data/import', { method: 'POST', body: formData });
                              const data = await resp.json();
                              if (resp.ok && data.success) {
                                toast.success(data.message || t.databaseImported || 'تم استعادة قاعدة البيانات بنجاح');
                              } else {
                                toast.error(data.error || t.databaseImportFailed || 'فشل في استعادة قاعدة البيانات');
                              }
                            } catch (err: any) {
                              toast.error(t.databaseImportFailed || 'فشل في استعادة قاعدة البيانات');
                            }
                          }}
                          className="bg-amber-600 hover:bg-amber-700"
                        >
                          {t.confirmRestore || 'تأكيد الاستعادة'}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>

              <Separator />

              {/* Auto Backup */}
              <AutoBackupSection />

              <Separator />

              {/* Backup Admin Creation */}
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <div className="flex size-9 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <UserPlus className="size-4" />
                  </div>
                  <div>
                    <div className="font-medium text-sm">{t.backupAdminCreation}</div>
                    <div className="text-xs text-muted-foreground">{t.backupAdminCreationDesc}</div>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label className="text-xs">{t.email}</Label>
                    <Input
                      type="email"
                      placeholder="admin@example.com"
                      value={backupAdminEmail}
                      onChange={(e) => setBackupAdminEmail(e.target.value)}
                      className="h-9"
                      dir="ltr"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs">{t.adminName}</Label>
                    <Input
                      placeholder={t.adminName}
                      value={backupAdminName}
                      onChange={(e) => setBackupAdminName(e.target.value)}
                      className="h-9"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs">{t.adminNameEn}</Label>
                    <Input
                      placeholder="Admin Name (English)"
                      value={backupAdminNameEn}
                      onChange={(e) => setBackupAdminNameEn(e.target.value)}
                      className="h-9"
                      dir="ltr"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs">{t.password}</Label>
                    <Input
                      type="password"
                      placeholder={t.password}
                      value={backupAdminPassword}
                      onChange={(e) => setBackupAdminPassword(e.target.value)}
                      className="h-9"
                      dir="ltr"
                    />
                  </div>
                </div>
                <Button
                  size="sm"
                  onClick={handleCreateBackupAdmin}
                  disabled={isCreatingBackupAdmin || !backupAdminEmail.trim() || !backupAdminName.trim() || !backupAdminPassword.trim()}
                  className="gap-2"
                >
                  {isCreatingBackupAdmin ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <UserPlus className="size-3.5" />
                  )}
                  {t.backupAdminCreation}
                </Button>
              </div>
            </CardContent>
          </Card>

        </TabsContent>

      </Tabs>
    </div>
  );
}
