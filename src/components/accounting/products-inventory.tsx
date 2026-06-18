'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
// XLSX is dynamically imported to reduce initial bundle size (~400KB)

import {
  Package,
  Plus,
  Pencil,
  Trash2,
  Search,
  Loader2,
  Upload,
  FileSpreadsheet,
  Download,
  CheckCircle2,
  XCircle,
  ArrowUpDown,
  AlertTriangle,
  ChevronDown,
  Filter,
  X,
  PackageCheck,
  PackageX,
  ArrowDown,
  ArrowUp,
  History,
  Layers,
  Tag,
  ClipboardCheck,
  ArrowLeftRight,
  AlertCircle,
  ArrowRight,
  Send,
  Inbox,
  ShoppingCart,
} from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { formatNumber } from '@/lib/types';
import { CurrencyAmount, CurrencySymbol } from '@/components/ui/currency-symbol';
import { useTranslation } from '@/lib/i18n';
import { useAppStore } from '@/lib/store';

// ─── Type Definitions ─────────────────────────────────────────────

interface ProductCategory {
  id: string;
  name: string;
  nameEn?: string;
  branchId: string;
  icon?: string;
  color?: string;
  isActive: boolean;
  sortOrder: number;
  productsCount?: number;
}

interface Product {
  id: string;
  name: string;
  nameEn?: string;
  sku?: string;
  categoryId: string;
  branchId: string;
  costPrice: number;
  price: number;
  unit: string;
  currentStock: number;
  minStock: number;
  isActive: boolean;
  sortOrder: number;
  category?: {
    id: string;
    name: string;
    nameEn?: string;
    icon?: string;
    color?: string;
  };
  createdAt: string;
  updatedAt: string;
}

interface StockTransaction {
  id: string;
  productId: string;
  productName: string;
  productNameEn?: string;
  category: string;
  type: string;
  quantity: number;
  costPrice: number;
  totalCost: number;
  reference?: string;
  referenceType?: string;
  referenceId?: string;
  notes?: string;
  branchId: string;
  createdAt: string;
}

interface StockTakeItem {
  id: string;
  productId: string;
  productName: string;
  productNameEn?: string;
  sku?: string;
  unit?: string;
  systemQty: number;
  countedQty: number | null;
  difference: number;
  costPrice: number;
  totalValue: number;
  notes?: string;
}

interface StockTake {
  id: string;
  number: string;
  date: string;
  branchId: string;
  status: 'DRAFT' | 'IN_PROGRESS' | 'COMPLETED' | 'POSTED' | 'CANCELLED';
  notes?: string;
  items: StockTakeItem[];
  totalItems: number;
  countedItems: number;
  itemsWithDifference: number;
  totalSurplusValue: number;
  totalShortageValue: number;
  createdAt: string;
  createdByName?: string;
  postedAt?: string;
  postedByName?: string;
}

interface StockTransferItem {
  id: string;
  productId: string;
  productName: string;
  productNameEn?: string;
  quantity: number;
  costPrice: number;
  totalCost: number;
}

interface StockTransfer {
  id: string;
  number: string;
  date: string;
  fromBranch: string;
  toBranch: string;
  status: 'DRAFT' | 'IN_TRANSIT' | 'RECEIVED' | 'CANCELLED';
  notes?: string;
  items: StockTransferItem[];
  createdAt: string;
  createdByName?: string;
  receivedAt?: string;
  receivedByName?: string;
}

// ─── Constants (non-translatable) ─────────────────────────────────

const STOCK_TYPE_COLORS: Record<string, string> = {
  PURCHASE: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  SALE: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400',
  ADJUSTMENT: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  RETURN: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400',
  TRANSFER: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  OPENING: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400',
};

const UNIT_OPTIONS = ['قطعة', 'كيلو', 'لتر', 'متر', 'علبة', 'كرتون', 'زجاجة', 'كيس', 'مجموعة'];

const CATEGORY_ICONS = ['🍔', '🍕', '🥤', '🍰', '🍗', '🥗', '☕', '🌮', '🍣', '🥘', '📦', '🎁', '🛍️', '🔧', '💊'];

// ─── Component ────────────────────────────────────────────────────

export default function ProductsInventory() {
  const { t, isRTL, locale } = useTranslation();
  const canAccessBranch = useAppStore((s) => s.canAccessBranch);

  // ─── Translatable Constants ──────────────────────────────────────

  // ─── Branches (fetched from API for dynamic branch support) ─────────
  // `id` is the UUID from DB — branchFilter / form fields hold this value.
  // `key` (branch code) is kept for canAccessBranch() compatibility (allowedBranches uses codes).
  const [dynamicBranches, setDynamicBranches] = useState<Array<{id: string; key: string; name: string}>>([]);

  const ALL_BRANCHES = dynamicBranches.length > 0
    ? dynamicBranches
    : [
        { id: 'CHINA_TOWN', key: 'CHINA_TOWN', name: t.branchChinaTown },
        { id: 'PALACE_INDIA', key: 'PALACE_INDIA', name: t.branchPalaceIndia },
      ];

  // Filter branches by user's allowedBranches (allowedBranches stores branch codes)
  const BRANCHES = ALL_BRANCHES.filter((b) => canAccessBranch(b.key));

  const STOCK_TYPE_LABELS: Record<string, string> = {
    PURCHASE: t.stockTypePurchase,
    SALE: t.stockTypeSale,
    ADJUSTMENT: t.stockTypeAdjustment,
    RETURN: t.stockTypeReturn,
    TRANSFER: t.stockTypeTransfer,
    OPENING: t.stockTypeOpening,
  };

  const CATEGORY_COLORS = [
    { value: '#10b981', label: t.colorEmerald },
    { value: '#14b8a6', label: t.colorTeal },
    { value: '#f59e0b', label: t.colorGold },
    { value: '#f97316', label: t.colorOrange },
    { value: '#ef4444', label: t.colorRed },
    { value: '#8b5cf6', label: t.colorViolet },
    { value: '#06b6d4', label: t.colorCyan },
    { value: '#ec4899', label: t.colorPink },
    { value: '#84cc16', label: t.colorLime },
    { value: '#64748b', label: t.colorGray },
  ];

  // ─── State ───────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<string>('products');

  // Data
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [stockTransactions, setStockTransactions] = useState<StockTransaction[]>([]);
  const [stockTotal, setStockTotal] = useState(0);

  // UI State
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  // branchFilter holds a branch UUID — auto-switched to BRANCHES[0].id once branches load
  const [branchFilter, setBranchFilter] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [productsLoading, setProductsLoading] = useState(false);
  const [stockLoading, setStockLoading] = useState(false);

  // Category Dialog
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<ProductCategory | null>(null);
  const [categoryForm, setCategoryForm] = useState({
    name: '',
    nameEn: '',
    branchId: '',
    icon: '📦',
    color: '#10b981',
    sortOrder: 0,
  });
  const [savingCategory, setSavingCategory] = useState(false);

  // Delete Category Confirmation
  const [deleteCategoryTarget, setDeleteCategoryTarget] = useState<ProductCategory | null>(null);

  // Product Dialog
  const [productDialogOpen, setProductDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [productForm, setProductForm] = useState({
    name: '',
    nameEn: '',
    sku: '',
    categoryId: '',
    branchId: '',
    costPrice: '',
    price: '',
    unit: 'قطعة',
    minStock: '',
    sortOrder: 0,
  });
  const [savingProduct, setSavingProduct] = useState(false);

  // Delete Product Confirmation
  const [deleteProductTarget, setDeleteProductTarget] = useState<Product | null>(null);

  // Stock Adjustment Dialog
  const [stockDialogOpen, setStockDialogOpen] = useState(false);
  const [stockProduct, setStockProduct] = useState<Product | null>(null);
  const [stockForm, setStockForm] = useState({
    type: 'ADJUSTMENT',
    quantity: '',
    costPrice: '',
    notes: '',
    branchId: '',
  });
  const [savingStock, setSavingStock] = useState(false);

  // Stock Transaction Detail Dialog
  const [productStockFilter, setProductStockFilter] = useState<string | null>(null);

  // Product Import Dialog
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importStep, setImportStep] = useState<'upload' | 'preview' | 'importing' | 'results'>('upload');
  const [importData, setImportData] = useState<(Record<string, any> & { _rowIdx: number })[]>([]);
  const [importResults, setImportResults] = useState<{ total: number; success: number; failed: number; errors: { row: number; name: string; error: string }[] } | null>(null);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Stock Take State
  const [stockTakes, setStockTakes] = useState<StockTake[]>([]);
  const [stockTakeLoading, setStockTakeLoading] = useState(false);
  const [selectedStockTake, setSelectedStockTake] = useState<StockTake | null>(null);
  const [stockTakeDetailLoading, setStockTakeDetailLoading] = useState(false);
  const [newStockTakeDialogOpen, setNewStockTakeDialogOpen] = useState(false);
  const [stockTakeForm, setStockTakeForm] = useState({ branchId: '', date: new Date().toISOString().split('T')[0], notes: '', includeAll: true });
  const [creatingStockTake, setCreatingStockTake] = useState(false);
  const [editedCounts, setEditedCounts] = useState<Record<string, number | undefined>>({});
  const [savingCounts, setSavingCounts] = useState(false);
  const [postingStockTake, setPostingStockTake] = useState(false);
  const [postConfirmTarget, setPostConfirmTarget] = useState<string | null>(null);

  // Stock Transfer State
  const [transfers, setTransfers] = useState<StockTransfer[]>([]);
  const [transferLoading, setTransferLoading] = useState(false);
  const [selectedTransfer, setSelectedTransfer] = useState<StockTransfer | null>(null);
  const [transferDetailLoading, setTransferDetailLoading] = useState(false);
  const [newTransferDialogOpen, setNewTransferDialogOpen] = useState(false);
  const [transferForm, setTransferForm] = useState({ fromBranch: '', toBranch: '', date: new Date().toISOString().split('T')[0], notes: '' });
  const [transferItems, setTransferItems] = useState<{ productId: string; productName: string; quantity: number; costPrice: number }[]>([]);
  const [transferProductSearch, setTransferProductSearch] = useState('');
  const [creatingTransfer, setCreatingTransfer] = useState(false);
  const [sendingTransfer, setSendingTransfer] = useState(false);
  const [receivingTransfer, setReceivingTransfer] = useState(false);

  // Reorder State
  const [reorderProducts, setReorderProducts] = useState<Product[]>([]);
  const [reorderLoading, setReorderLoading] = useState(false);
  const [reorderEditTarget, setReorderEditTarget] = useState<Product | null>(null);
  const [reorderForm, setReorderForm] = useState({ minStock: '', maxStock: '', reorderQuantity: '' });
  const [savingReorder, setSavingReorder] = useState(false);

  // ─── Fetch Categories ────────────────────────────────────────────

  const fetchCategories = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (branchFilter) params.set('branchId', branchFilter);
      const res = await fetch(`/api/pos/categories?${params.toString()}`);
      if (!res.ok) throw new Error(t.failedToFetchCategories);
      const data = await res.json();
      setCategories(Array.isArray(data) ? data : data.categories || []);
    } catch {
      toast.error(t.failedToFetchCategories);
    } finally {
      setLoading(false);
    }
  }, [branchFilter, t]);

  // ─── Fetch Products ──────────────────────────────────────────────

  const fetchProducts = useCallback(async () => {
    try {
      setProductsLoading(true);
      const params = new URLSearchParams();
      if (branchFilter) params.set('branchId', branchFilter);
      if (selectedCategoryId) params.set('categoryId', selectedCategoryId);
      if (searchQuery) params.set('search', searchQuery);
      const res = await fetch(`/api/pos/products?${params.toString()}`);
      if (!res.ok) throw new Error(t.failedToFetchProducts);
      const data = await res.json();
      setProducts(Array.isArray(data) ? data : data.products || []);
    } catch {
      toast.error(t.failedToFetchProducts);
    } finally {
      setProductsLoading(false);
    }
  }, [branchFilter, selectedCategoryId, searchQuery, t]);

  // ─── Fetch Stock Transactions ────────────────────────────────────

  const fetchStockTransactions = useCallback(async (offset = 0) => {
    try {
      setStockLoading(true);
      const params = new URLSearchParams();
      params.set('limit', '50');
      params.set('offset', String(offset));
      if (productStockFilter) params.set('productId', productStockFilter);
      if (branchFilter) params.set('branchId', branchFilter);
      const res = await fetch(`/api/inventory/stock?${params.toString()}`);
      if (!res.ok) throw new Error(t.failedToFetchStockTransactions);
      const data = await res.json();
      setStockTransactions(data.transactions || []);
      setStockTotal(data.total || 0);
    } catch {
      toast.error(t.failedToFetchStockTransactions);
    } finally {
      setStockLoading(false);
    }
  }, [branchFilter, productStockFilter, t]);

  // ─── Effects ─────────────────────────────────────────────────────

  // Fetch branches from API for dynamic branch support
  useEffect(() => {
    const fetchBranches = async () => {
      try {
        const res = await fetch('/api/branches');
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data) && data.length > 0) {
            // Store both `id` (UUID — primary identifier for API calls)
            // and `key` (branch code — used by canAccessBranch which checks allowedBranches)
            setDynamicBranches(data.map((b: any) => ({
              id: b.id,
              key: b.code,
              name: b.nameEn || b.name,
            })));
          }
        }
      } catch {
        // Keep default branches
      }
    };
    fetchBranches();
  }, []);

  // Auto-switch branchFilter if current branch is not accessible
  // branchFilter holds a UUID — compare against b.id
  useEffect(() => {
    if (BRANCHES.length > 0 && !BRANCHES.some((b) => b.id === branchFilter)) {
      setBranchFilter(BRANCHES[0].id);
    }
  }, [BRANCHES, branchFilter]);

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  useEffect(() => {
    if (activeTab === 'products') {
      fetchProducts();
    }
  }, [activeTab, fetchProducts]);

  useEffect(() => {
    if (activeTab === 'stock') {
      fetchStockTransactions();
    }
  }, [activeTab, fetchStockTransactions]);

  useEffect(() => {
    if (activeTab === 'stock-take' && !selectedStockTake) {
      fetchStockTakes();
    }
  }, [activeTab, selectedStockTake]);

  useEffect(() => {
    if (activeTab === 'transfers' && !selectedTransfer) {
      fetchTransfers();
    }
  }, [activeTab, selectedTransfer]);

  useEffect(() => {
    if (activeTab === 'reorder') {
      fetchReorderProducts();
    }
  }, [activeTab]);

  // ─── Category Handlers ───────────────────────────────────────────

  const handleOpenCategoryDialog = (category?: ProductCategory) => {
    if (category) {
      setEditingCategory(category);
      setCategoryForm({
        name: category.name,
        nameEn: category.nameEn || '',
        branchId: category.branchId,
        icon: category.icon || '📦',
        color: category.color || '#10b981',
        sortOrder: category.sortOrder,
      });
    } else {
      setEditingCategory(null);
      setCategoryForm({
        name: '',
        nameEn: '',
        branchId: branchFilter,
        icon: '📦',
        color: '#10b981',
        sortOrder: 0,
      });
    }
    setCategoryDialogOpen(true);
  };

  const handleSaveCategory = async () => {
    if (!categoryForm.name.trim()) {
      toast.error(t.categoryNameRequired);
      return;
    }

    try {
      setSavingCategory(true);
      const url = editingCategory
        ? `/api/pos/categories/${editingCategory.id}`
        : '/api/pos/categories';
      const method = editingCategory ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(categoryForm),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || (editingCategory ? t.failedToUpdateCategory : t.failedToAddCategory));
      }

      toast.success(editingCategory ? t.categoryUpdated : t.categoryAdded);
      setCategoryDialogOpen(false);
      fetchCategories();
    } catch (error: any) {
      toast.error(error.message || (editingCategory ? t.failedToUpdateCategory : t.failedToAddCategory));
    } finally {
      setSavingCategory(false);
    }
  };

  const handleDeleteCategory = async () => {
    if (!deleteCategoryTarget) return;

    try {
      const res = await fetch(`/api/pos/categories/${deleteCategoryTarget.id}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || t.failedToDeleteCategory);
      }

      toast.success(t.categoryDeleted);
      if (selectedCategoryId === deleteCategoryTarget.id) {
        setSelectedCategoryId(null);
      }
      setDeleteCategoryTarget(null);
      fetchCategories();
    } catch (error: any) {
      toast.error(error.message || t.failedToDeleteCategory);
    }
  };

  // ─── Product Handlers ────────────────────────────────────────────

  const handleOpenProductDialog = (product?: Product) => {
    if (product) {
      setEditingProduct(product);
      setProductForm({
        name: product.name,
        nameEn: product.nameEn || '',
        sku: product.sku || '',
        categoryId: product.categoryId,
        branchId: product.branchId,
        costPrice: String(product.costPrice),
        price: String(product.price),
        unit: product.unit,
        minStock: String(product.minStock),
        sortOrder: product.sortOrder,
      });
    } else {
      setEditingProduct(null);
      setProductForm({
        name: '',
        nameEn: '',
        sku: '',
        categoryId: selectedCategoryId || '',
        branchId: branchFilter,
        costPrice: '',
        price: '',
        unit: 'قطعة',
        minStock: '0',
        sortOrder: 0,
      });
    }
    setProductDialogOpen(true);
  };

  const handleSaveProduct = async () => {
    if (!productForm.name.trim()) {
      toast.error(t.productNameRequired);
      return;
    }
    if (!productForm.categoryId) {
      toast.error(t.productCategoryRequired);
      return;
    }
    if (!productForm.price || parseFloat(productForm.price) <= 0) {
      toast.error(t.productPriceRequired);
      return;
    }

    try {
      setSavingProduct(true);
      const url = editingProduct
        ? `/api/pos/products/${editingProduct.id}`
        : '/api/pos/products';
      const method = editingProduct ? 'PUT' : 'POST';

      const body = {
        ...productForm,
        costPrice: parseFloat(productForm.costPrice) || 0,
        price: parseFloat(productForm.price),
        minStock: parseFloat(productForm.minStock) || 0,
      };

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || (editingProduct ? t.failedToUpdateProduct : t.failedToAddProduct));
      }

      toast.success(editingProduct ? t.productUpdated : t.productAdded);
      setProductDialogOpen(false);
      fetchProducts();
      fetchCategories();
    } catch (error: any) {
      toast.error(error.message || (editingProduct ? t.failedToUpdateProduct : t.failedToAddProduct));
    } finally {
      setSavingProduct(false);
    }
  };

  const handleDeleteProduct = async () => {
    if (!deleteProductTarget) return;

    try {
      const res = await fetch(`/api/pos/products/${deleteProductTarget.id}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || t.failedToDeleteProduct);
      }

      toast.success(t.productDeleted);
      setDeleteProductTarget(null);
      fetchProducts();
      fetchCategories();
    } catch (error: any) {
      toast.error(error.message || t.failedToDeleteProduct);
    }
  };

  // ─── Stock Adjustment Handlers ───────────────────────────────────

  const handleOpenStockDialog = (product: Product) => {
    setStockProduct(product);
    setStockForm({
      type: 'ADJUSTMENT',
      quantity: '',
      costPrice: String(product.costPrice),
      notes: '',
      branchId: product.branchId,
    });
    setStockDialogOpen(true);
  };

  const handleSaveStock = async () => {
    if (!stockProduct) return;
    if (!stockForm.quantity || parseFloat(stockForm.quantity) === 0) {
      toast.error(t.quantityRequired);
      return;
    }

    try {
      setSavingStock(true);
      const res = await fetch('/api/inventory/stock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: stockProduct.id,
          type: stockForm.type,
          quantity: parseFloat(stockForm.quantity),
          costPrice: parseFloat(stockForm.costPrice) || stockProduct.costPrice,
          notes: stockForm.notes,
          branchId: stockForm.branchId,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || t.failedToRecordStock);
      }

      const result = await res.json();
      toast.success(`${t.stockMovementRecorded} - ${t.newStock}: ${formatNumber(result.newStock)}`);
      setStockDialogOpen(false);
      fetchProducts();
    } catch (error: any) {
      toast.error(error.message || t.failedToRecordStock);
    } finally {
      setSavingStock(false);
    }
  };

  // ─── Product Import Handlers ──────────────────────────────────────

  const handleOpenImportDialog = () => {
    setImportStep('upload');
    setImportData([]);
    setImportResults(null);
    setImporting(false);
    setImportDialogOpen(true);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const data = new Uint8Array(evt.target?.result as ArrayBuffer);
        const XLSX = await import('xlsx');
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { defval: '' }).map((row: any, i: number) => ({ ...row, _rowIdx: i }));

        if (jsonData.length === 0) {
          toast.error(t.importNoData || 'الملف لا يحتوي على بيانات');
          return;
        }

        setImportData(jsonData);
        setImportStep('preview');
      } catch (err: any) {
        toast.error(t.importFileError || 'خطأ في قراءة الملف');
      }
    };
    reader.readAsArrayBuffer(file);
    // Reset file input
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDownloadTemplate = async () => {
    const XLSX = await import('xlsx');
    const headers = ['Name', 'Name (Arabic)', 'Cost Price', 'Selling Price'];
    const sampleRow = ['Burger', 'برجر', '15', '25'];
    const ws = XLSX.utils.aoa_to_sheet([headers, sampleRow]);
    // Set column widths
    ws['!cols'] = [{ wch: 25 }, { wch: 25 }, { wch: 15 }, { wch: 15 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Products');
    XLSX.writeFile(wb, 'products_template.xlsx');
  };

  const handleImportProducts = async () => {
    if (importData.length === 0) return;

    setImportStep('importing');
    setImporting(true);

    try {
      const res = await fetch('/api/pos/products/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          products: importData,
          defaultBranchId: branchFilter,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || t.importFailed || 'فشل في الاستيراد');
      }

      const results = await res.json();
      setImportResults(results);
      setImportStep('results');

      if (results.success > 0) {
        toast.success(`${results.success} ${t.importSuccessCount || 'منتج تم استيراده'}`);
        fetchProducts();
        fetchCategories();
      }
    } catch (error: any) {
      toast.error(error.message || t.importFailed || 'فشل في الاستيراد');
      setImportStep('preview');
    } finally {
      setImporting(false);
    }
  };

  // ─── Helpers ─────────────────────────────────────────────────────

  // Stock Take Fetch & Handlers
  const fetchStockTakes = useCallback(async () => {
    try {
      setStockTakeLoading(true);
      const params = new URLSearchParams();
      params.set('limit', '50');
      if (branchFilter) params.set('branchId', branchFilter);
      const res = await fetch(`/api/inventory/stock-take?${params.toString()}`);
      if (!res.ok) throw new Error(t.failedToFetchStockTakes);
      const data = await res.json();
      setStockTakes(Array.isArray(data) ? data : data.stockTakes || []);
    } catch {
      toast.error(t.failedToFetchStockTakes);
    } finally {
      setStockTakeLoading(false);
    }
  }, [branchFilter, t]);

  const fetchStockTakeDetail = useCallback(async (id: string) => {
    try {
      setStockTakeDetailLoading(true);
      const res = await fetch(`/api/inventory/stock-take/${id}`);
      if (!res.ok) throw new Error(t.failedToFetchStockTakes);
      const data = await res.json();
      setSelectedStockTake(data);
      setEditedCounts({});
    } catch {
      toast.error(t.failedToFetchStockTakes);
    } finally {
      setStockTakeDetailLoading(false);
    }
  }, [t]);

  const handleCreateStockTake = async () => {
    try {
      setCreatingStockTake(true);
      const res = await fetch('/api/inventory/stock-take', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(stockTakeForm),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || t.failedToCreateStockTake);
      }
      const data = await res.json();
      toast.success(t.stockTake);
      setNewStockTakeDialogOpen(false);
      fetchStockTakeDetail(data.id);
    } catch (error: any) {
      toast.error(error.message || t.failedToCreateStockTake);
    } finally {
      setCreatingStockTake(false);
    }
  };

  const handleSaveCounts = async () => {
    if (!selectedStockTake) return;
    try {
      setSavingCounts(true);
      const items = selectedStockTake.items.map(item => ({
        id: item.id,
        countedQty: editedCounts[item.id] !== undefined ? editedCounts[item.id] : item.countedQty,
        notes: item.notes,
      }));
      const res = await fetch(`/api/inventory/stock-take/${selectedStockTake.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || t.failedToUpdateStockTake);
      }
      const data = await res.json();
      setSelectedStockTake(data);
      setEditedCounts({});
      toast.success(t.save);
    } catch (error: any) {
      toast.error(error.message || t.failedToUpdateStockTake);
    } finally {
      setSavingCounts(false);
    }
  };

  const handleMarkCompleted = async () => {
    if (!selectedStockTake) return;
    const allCounted = selectedStockTake.items.every(item =>
      editedCounts[item.id] !== undefined ? editedCounts[item.id] !== null : item.countedQty !== null
    );
    if (!allCounted) {
      toast.error(t.allItemsMustBeCounted);
      return;
    }
    try {
      const items = selectedStockTake.items.map(item => ({
        id: item.id,
        countedQty: editedCounts[item.id] !== undefined ? editedCounts[item.id] : item.countedQty,
      }));
      const res = await fetch(`/api/inventory/stock-take/${selectedStockTake.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items, status: 'COMPLETED' }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || t.failedToUpdateStockTake);
      }
      const data = await res.json();
      setSelectedStockTake(data);
      setEditedCounts({});
      toast.success(t.completed);
    } catch (error: any) {
      toast.error(error.message || t.failedToUpdateStockTake);
    }
  };

  const handlePostStockTake = async (id: string) => {
    try {
      setPostingStockTake(true);
      const res = await fetch(`/api/inventory/stock-take/${id}/post`, { method: 'POST' });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || t.failedToPostStockTake);
      }
      toast.success(t.stockTakePosted);
      setSelectedStockTake(null);
      fetchStockTakes();
    } catch (error: any) {
      toast.error(error.message || t.failedToPostStockTake);
    } finally {
      setPostingStockTake(false);
      setPostConfirmTarget(null);
    }
  };

  // Stock Transfer Fetch & Handlers
  const fetchTransfers = useCallback(async () => {
    try {
      setTransferLoading(true);
      const params = new URLSearchParams();
      params.set('limit', '50');
      if (branchFilter) params.set('branchId', branchFilter);
      const res = await fetch(`/api/inventory/stock-transfer?${params.toString()}`);
      if (!res.ok) throw new Error(t.failedToFetchTransfers);
      const data = await res.json();
      setTransfers(Array.isArray(data) ? data : data.transfers || []);
    } catch {
      toast.error(t.failedToFetchTransfers);
    } finally {
      setTransferLoading(false);
    }
  }, [branchFilter, t]);

  const fetchTransferDetail = useCallback(async (id: string) => {
    try {
      setTransferDetailLoading(true);
      const res = await fetch(`/api/inventory/stock-transfer/${id}`);
      if (!res.ok) throw new Error(t.failedToFetchTransfers);
      const data = await res.json();
      setSelectedTransfer(data);
    } catch {
      toast.error(t.failedToFetchTransfers);
    } finally {
      setTransferDetailLoading(false);
    }
  }, [t]);

  const handleCreateTransfer = async () => {
    if (transferForm.fromBranch === transferForm.toBranch) {
      toast.error(t.cannotTransferSameBranch);
      return;
    }
    if (transferItems.length === 0) {
      toast.error(t.noItems);
      return;
    }
    try {
      setCreatingTransfer(true);
      const res = await fetch('/api/inventory/stock-transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromBranch: transferForm.fromBranch,
          toBranch: transferForm.toBranch,
          date: transferForm.date,
          notes: transferForm.notes,
          items: transferItems.map(i => ({ productId: i.productId, quantity: i.quantity })),
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || t.failedToCreateTransfer);
      }
      const data = await res.json();
      toast.success(t.stockTransfer);
      setNewTransferDialogOpen(false);
      setTransferItems([]);
      fetchTransferDetail(data.id);
    } catch (error: any) {
      toast.error(error.message || t.failedToCreateTransfer);
    } finally {
      setCreatingTransfer(false);
    }
  };

  const handleSendTransfer = async (id: string) => {
    try {
      setSendingTransfer(true);
      const res = await fetch(`/api/inventory/stock-transfer/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'IN_TRANSIT' }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || t.failedToSendTransfer);
      }
      toast.success(t.transferSent);
      fetchTransferDetail(id);
    } catch (error: any) {
      toast.error(error.message || t.failedToSendTransfer);
    } finally {
      setSendingTransfer(false);
    }
  };

  const handleReceiveTransfer = async (id: string) => {
    try {
      setReceivingTransfer(true);
      const res = await fetch(`/api/inventory/stock-transfer/${id}/receive`, { method: 'POST' });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || t.failedToReceiveTransfer);
      }
      toast.success(t.transferReceived);
      fetchTransferDetail(id);
    } catch (error: any) {
      toast.error(error.message || t.failedToReceiveTransfer);
    } finally {
      setReceivingTransfer(false);
    }
  };

  // Reorder Fetch & Handlers
  const fetchReorderProducts = useCallback(async () => {
    try {
      setReorderLoading(true);
      const params = new URLSearchParams();
      if (branchFilter) params.set('branchId', branchFilter);
      const res = await fetch(`/api/pos/products?${params.toString()}`);
      if (!res.ok) throw new Error(t.failedToFetchProducts);
      const data = await res.json();
      const allProducts: Product[] = Array.isArray(data) ? data : data.products || [];
      setReorderProducts(allProducts.filter(p => p.isActive && p.minStock > 0 && p.currentStock <= p.minStock));
    } catch {
      toast.error(t.failedToFetchProducts);
    } finally {
      setReorderLoading(false);
    }
  }, [branchFilter, t]);

  const handleOpenReorderEdit = (product: Product) => {
    setReorderEditTarget(product);
    setReorderForm({
      minStock: String(product.minStock),
      maxStock: '0',
      reorderQuantity: '0',
    });
  };

  const handleSaveReorder = async () => {
    if (!reorderEditTarget) return;
    try {
      setSavingReorder(true);
      const res = await fetch(`/api/pos/products/${reorderEditTarget.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: reorderEditTarget.name,
          nameEn: reorderEditTarget.nameEn || '',
          sku: reorderEditTarget.sku || '',
          categoryId: reorderEditTarget.categoryId,
          branchId: reorderEditTarget.branchId,
          costPrice: reorderEditTarget.costPrice,
          price: reorderEditTarget.price,
          unit: reorderEditTarget.unit,
          minStock: parseFloat(reorderForm.minStock) || 0,
          sortOrder: reorderEditTarget.sortOrder,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || t.failedToUpdateProduct);
      }
      toast.success(t.productUpdated);
      setReorderEditTarget(null);
      fetchReorderProducts();
      fetchProducts();
    } catch (error: any) {
      toast.error(error.message || t.failedToUpdateProduct);
    } finally {
      setSavingReorder(false);
    }
  };

  // ─── Helpers (original) ─────────────────────────────────────────

  const getStockBadge = (currentStock: number, minStock: number) => {
    if (currentStock <= 0) {
      return (
        <Badge className="bg-rose-100 text-rose-700 border-rose-200 hover:bg-rose-100 dark:bg-rose-900/30 dark:text-rose-400 dark:border-rose-800 gap-1">
          <PackageX className="size-3" />
          {t.outOfStock}
        </Badge>
      );
    }
    if (currentStock <= minStock) {
      return (
        <Badge className="bg-amber-100 text-amber-700 border-amber-200 hover:bg-amber-100 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800 gap-1">
          <AlertTriangle className="size-3" />
          {t.lowStock}
        </Badge>
      );
    }
    return (
      <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 hover:bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-800 gap-1">
        <PackageCheck className="size-3" />
        {t.inStock}
      </Badge>
    );
  };

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleDateString(locale, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return dateStr;
    }
  };

  const formatDateTime = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleDateString(locale, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return dateStr;
    }
  };

  // Look up branch display name by UUID (branchFilter and form fields hold UUIDs)
  const getBranchName = (id: string) => {
    return BRANCHES.find(b => b.id === id)?.name || id;
  };

  const lowStockProducts = products.filter(p => p.isActive && p.currentStock <= p.minStock);
  const outOfStockProducts = products.filter(p => p.isActive && p.currentStock <= 0);
  const totalProducts = products.filter(p => p.isActive).length;
  // Stock value: sum of (currentStock × costPrice) — estimated, based on last known cost
  // NOTE: This is an estimate. For restaurants, actual COGS should be calculated
  // from purchase records, not from per-item costPrice.
  const totalStockValue = products
    .filter(p => p.isActive)
    .reduce((sum, p) => sum + p.currentStock * p.costPrice, 0);

  // ═══════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════

  return (
    <div className="space-y-4" dir={isRTL ? 'rtl' : 'ltr'}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
            <Package className="size-5" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-foreground">{t.productManagement}</h2>
            <p className="text-sm text-muted-foreground">{t.productManagementDesc}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Select value={branchFilter} onValueChange={setBranchFilter}>
            <SelectTrigger className="w-[160px]">
              <Filter className="size-4 ml-1 text-muted-foreground" />
              <SelectValue placeholder={t.branch} />
            </SelectTrigger>
            <SelectContent>
              {BRANCHES.map((b) => (
                <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="border-emerald-200 dark:border-emerald-800">
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <div className="flex size-8 items-center justify-center rounded-lg bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400">
                <Package className="size-4" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t.totalProducts}</p>
                <p className="text-lg font-bold text-foreground">{formatNumber(totalProducts, 0)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-teal-200 dark:border-teal-800">
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <div className="flex size-8 items-center justify-center rounded-lg bg-teal-100 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400">
                <Layers className="size-4" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t.stockValue}</p>
                <p className="text-lg font-bold text-foreground"><CurrencyAmount amount={totalStockValue} symbolClassName="w-3.5 h-3.5" /></p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-amber-200 dark:border-amber-800">
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <div className="flex size-8 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400">
                <AlertTriangle className="size-4" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t.lowStock}</p>
                <p className="text-lg font-bold text-foreground">{formatNumber(lowStockProducts.length, 0)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-rose-200 dark:border-rose-800">
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <div className="flex size-8 items-center justify-center rounded-lg bg-rose-100 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400">
                <PackageX className="size-4" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t.outOfStock}</p>
                <p className="text-lg font-bold text-foreground">{formatNumber(outOfStockProducts.length, 0)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value="products" className="gap-1.5">
            <Package className="size-4" />
            {t.products}
          </TabsTrigger>
          <TabsTrigger value="stock" className="gap-1.5">
            <History className="size-4" />
            {t.stockMovements}
          </TabsTrigger>
          <TabsTrigger value="stock-take" className="gap-1.5">
            <ClipboardCheck className="size-4" />
            {t.stockTakeTab}
          </TabsTrigger>
          <TabsTrigger value="transfers" className="gap-1.5">
            <ArrowLeftRight className="size-4" />
            {t.transfersTab}
          </TabsTrigger>
          <TabsTrigger value="reorder" className="gap-1.5">
            <AlertCircle className="size-4" />
            {t.reorderTab}
          </TabsTrigger>
        </TabsList>

        {/* ─── Products Tab ──────────────────────────────────────────── */}
        <TabsContent value="products" className="mt-4">
          <div className="flex flex-col lg:flex-row gap-4">
            {/* Left Panel: Categories */}
            <div className="w-full lg:w-72 shrink-0">
              <Card>
                <CardHeader className="p-4 pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-semibold text-foreground">{t.categoryManagement}</CardTitle>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 gap-1 text-xs border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-400 dark:hover:bg-emerald-950/30"
                      onClick={() => handleOpenCategoryDialog()}
                    >
                      <Plus className="size-3" />
                      {t.addCategory}
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="p-2">
                  <ScrollArea className="max-h-[60vh]">
                    {/* All Categories Option */}
                    <button
                      className={`w-full flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm transition-colors ${
                        selectedCategoryId === null
                          ? 'bg-emerald-100 text-emerald-700 font-medium dark:bg-emerald-900/30 dark:text-emerald-400'
                          : 'hover:bg-muted text-foreground'
                      }`}
                      onClick={() => setSelectedCategoryId(null)}
                    >
                      <div className="flex size-7 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                        <Layers className="size-3.5" />
                      </div>
                      <span>{t.allCategories}</span>
                      <Badge variant="secondary" className="mr-auto text-xs">
                        {categories.reduce((sum, c) => sum + (c.productsCount || 0), 0)}
                      </Badge>
                    </button>

                    <Separator className="my-1" />

                    {categories.map((category) => (
                      <div
                        key={category.id}
                        className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors group cursor-pointer ${
                          selectedCategoryId === category.id
                            ? 'bg-emerald-100 text-emerald-700 font-medium dark:bg-emerald-900/30 dark:text-emerald-400'
                            : 'hover:bg-muted text-foreground'
                        }`}
                        onClick={() => setSelectedCategoryId(category.id)}
                      >
                        <div
                          className="flex size-7 items-center justify-center rounded-md text-sm"
                          style={{
                            backgroundColor: `${category.color || '#10b981'}20`,
                            color: category.color || '#10b981',
                          }}
                        >
                          {category.icon || '📦'}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="truncate font-medium">{category.name}</p>
                          {category.nameEn && (
                            <p className="text-xs text-muted-foreground truncate">{category.nameEn}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          <Badge variant="secondary" className="text-xs">
                            {category.productsCount || 0}
                          </Badge>
                          <div className="flex opacity-0 group-hover:opacity-100 transition-opacity gap-0.5">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="size-6"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenCategoryDialog(category);
                              }}
                            >
                              <Pencil className="size-3" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="size-6 text-rose-600 hover:text-rose-700"
                              onClick={(e) => {
                                e.stopPropagation();
                                setDeleteCategoryTarget(category);
                              }}
                            >
                              <Trash2 className="size-3" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}

                    {categories.length === 0 && !loading && (
                      <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                        <Tag className="size-8 mb-2 opacity-30" />
                        <p className="text-xs">{t.noData}</p>
                      </div>
                    )}
                  </ScrollArea>
                </CardContent>
              </Card>
            </div>

            {/* Right Panel: Products */}
            <div className="flex-1 min-w-0">
              <Card>
                <CardHeader className="p-4 pb-2">
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-2 flex-1 w-full sm:w-auto">
                      <div className="relative flex-1">
                        <Search className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                        <Input
                          placeholder={t.search}
                          className="pr-9"
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                        />
                        {searchQuery && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="absolute left-1 top-1/2 -translate-y-1/2 size-6"
                            onClick={() => setSearchQuery('')}
                          >
                            <X className="size-3" />
                          </Button>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5 shrink-0"
                        onClick={handleOpenImportDialog}
                      >
                        <Upload className="size-4" />
                        {t.importProducts || 'استيراد'}
                      </Button>
                      <Button
                        className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white shrink-0"
                        onClick={() => handleOpenProductDialog()}
                      >
                        <Plus className="size-4" />
                        {t.addProductBtn}
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-4 pt-2">
                  {productsLoading ? (
                    <div className="flex items-center justify-center py-16">
                      <div className="flex flex-col items-center gap-3">
                        <Loader2 className="size-8 animate-spin text-emerald-600" />
                        <span className="text-muted-foreground text-sm">{t.loading}</span>
                      </div>
                    </div>
                  ) : products.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                      <Package className="size-16 mb-4 opacity-30" />
                      <p className="text-lg">{t.noData}</p>
                      <p className="text-sm mt-1">
                        {selectedCategoryId
                          ? t.noProductsInCategory
                          : t.addProductsToStart}
                      </p>
                      <Button
                        className="mt-4 gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
                        onClick={() => handleOpenProductDialog()}
                      >
                        <Plus className="size-4" />
                        {t.addProductBtn}
                      </Button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                      {products.map((product) => (
                        <Card
                          key={product.id}
                          className={`group transition-all duration-200 hover:shadow-md border ${
                            !product.isActive
                              ? 'opacity-50 border-muted'
                              : product.currentStock <= 0
                              ? 'border-rose-200 dark:border-rose-800'
                              : product.currentStock <= product.minStock
                              ? 'border-amber-200 dark:border-amber-800'
                              : 'border-emerald-200 dark:border-emerald-800'
                          }`}
                        >
                          <CardContent className="p-4">
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <h3 className="font-semibold text-foreground truncate">{product.name}</h3>
                                  {!product.isActive && (
                                    <Badge variant="secondary" className="text-xs shrink-0">{t.inactive}</Badge>
                                  )}
                                </div>
                                {product.nameEn && (
                                  <p className="text-xs text-muted-foreground truncate">{product.nameEn}</p>
                                )}
                                {product.sku && (
                                  <p className="text-xs text-muted-foreground font-mono mt-0.5">
                                    {t.productSKU}: {product.sku}
                                  </p>
                                )}
                              </div>
                              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="size-7"
                                  onClick={() => handleOpenStockDialog(product)}
                                  title={t.stockAdjustment}
                                >
                                  <ArrowUpDown className="size-3.5" />
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="size-7"
                                  onClick={() => handleOpenProductDialog(product)}
                                  title={t.edit}
                                >
                                  <Pencil className="size-3.5" />
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="size-7 text-rose-600 hover:text-rose-700"
                                  onClick={() => setDeleteProductTarget(product)}
                                  title={t.delete}
                                >
                                  <Trash2 className="size-3.5" />
                                </Button>
                              </div>
                            </div>

                            <Separator className="my-3" />

                            {/* Prices */}
                            <div className="grid grid-cols-2 gap-2 text-sm">
                              <div>
                                <p className="text-xs text-muted-foreground">{t.productCost}</p>
                                <p className="font-semibold text-foreground"><CurrencyAmount amount={product.costPrice} symbolClassName="w-3.5 h-3.5" /></p>
                              </div>
                              <div>
                                <p className="text-xs text-muted-foreground">{t.productPrice}</p>
                                <p className="font-semibold text-emerald-600 dark:text-emerald-400"><CurrencyAmount amount={product.price} symbolClassName="w-3.5 h-3.5" /></p>
                              </div>
                            </div>

                            {/* Stock & Unit */}
                            <div className="flex items-center justify-between mt-3">
                              <div className="flex items-center gap-2">
                                {getStockBadge(product.currentStock, product.minStock)}
                                <span className="text-sm font-medium text-foreground">
                                  {formatNumber(product.currentStock, product.unit === 'كيلو' || product.unit === 'لتر' || product.unit === 'متر' ? 2 : 0)}
                                </span>
                                <span className="text-xs text-muted-foreground">{product.unit}</span>
                              </div>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 gap-1 text-xs"
                                onClick={() => {
                                  setProductStockFilter(product.id);
                                  setActiveTab('stock');
                                }}
                              >
                                <History className="size-3" />
                                {t.stockHistory}
                              </Button>
                            </div>

                            {/* Branch */}
                            <div className="mt-2">
                              <Badge variant="outline" className="text-xs">
                                {getBranchName(product.branchId)}
                              </Badge>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        {/* ─── Stock Movements Tab ────────────────────────────────────── */}
        <TabsContent value="stock" className="mt-4">
          <Card>
            <CardHeader className="p-4 pb-2">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-sm font-semibold text-foreground">{t.stockMovements}</CardTitle>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t.total} {formatNumber(stockTotal, 0)} {t.stockMovements}
                    {productStockFilter && ` (${t.filteredByProduct})`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {productStockFilter && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 gap-1 text-xs"
                      onClick={() => setProductStockFilter(null)}
                    >
                      <X className="size-3" />
                      {t.clearFilter}
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-4 pt-2">
              {stockLoading ? (
                <div className="flex items-center justify-center py-16">
                  <div className="flex flex-col items-center gap-3">
                    <Loader2 className="size-8 animate-spin text-emerald-600" />
                    <span className="text-muted-foreground text-sm">{t.loading}</span>
                  </div>
                </div>
              ) : stockTransactions.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                  <History className="size-16 mb-4 opacity-30" />
                  <p className="text-lg">{t.noData}</p>
                  <p className="text-sm mt-1">{t.stockMovementsDesc}</p>
                </div>
              ) : (
                <div className="rounded-lg border overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-right">{t.date}</TableHead>
                        <TableHead className="text-right">{t.productName}</TableHead>
                        <TableHead className="text-right">{t.productCategory}</TableHead>
                        <TableHead className="text-right">{t.type}</TableHead>
                        <TableHead className="text-right">{t.quantity}</TableHead>
                        <TableHead className="text-right">{t.productCost}</TableHead>
                        <TableHead className="text-right">{t.total}</TableHead>
                        <TableHead className="text-right">{t.reference}</TableHead>
                        <TableHead className="text-right">{t.notes}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {stockTransactions.map((tx) => {
                        const isPositive = ['PURCHASE', 'RETURN', 'OPENING'].includes(tx.type) ||
                          (tx.type === 'ADJUSTMENT' && tx.quantity > 0);

                        return (
                          <TableRow key={tx.id}>
                            <TableCell className="text-xs whitespace-nowrap">
                              {formatDateTime(tx.createdAt)}
                            </TableCell>
                            <TableCell>
                              <div>
                                <p className="font-medium text-foreground text-sm">{tx.productName}</p>
                                {tx.productNameEn && (
                                  <p className="text-xs text-muted-foreground">{tx.productNameEn}</p>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {tx.category || '-'}
                            </TableCell>
                            <TableCell>
                              <Badge className={`text-xs ${STOCK_TYPE_COLORS[tx.type] || ''}`}>
                                {STOCK_TYPE_LABELS[tx.type] || tx.type}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <span className={`font-mono font-semibold flex items-center gap-1 ${
                                isPositive ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                              }`}>
                                {isPositive ? (
                                  <ArrowUp className="size-3" />
                                ) : (
                                  <ArrowDown className="size-3" />
                                )}
                                {formatNumber(Math.abs(tx.quantity), tx.quantity % 1 !== 0 ? 2 : 0)}
                              </span>
                            </TableCell>
                            <TableCell className="text-sm">
                              <CurrencyAmount amount={tx.costPrice} symbolClassName="w-3.5 h-3.5" />
                            </TableCell>
                            <TableCell className="text-sm font-semibold">
                              <CurrencyAmount amount={tx.totalCost} symbolClassName="w-3.5 h-3.5" />
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {tx.reference || '-'}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground max-w-[150px] truncate">
                              {tx.notes || '-'}
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
        </TabsContent>

        {/* ─── Stock Take Tab ──────────────────────────────────────────── */}
        <TabsContent value="stock-take" className="mt-4">
          {selectedStockTake ? (
            <Card>
              <CardHeader className="p-4 pb-2">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <Button variant="ghost" size="sm" className="gap-1" onClick={() => setSelectedStockTake(null)}>
                      <ArrowRight className="size-4" />
                      {t.back}
                    </Button>
                    <div>
                      <CardTitle className="text-sm font-semibold text-foreground">{selectedStockTake.number}</CardTitle>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {formatDate(selectedStockTake.date)} • {getBranchName(selectedStockTake.branchId)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge className={
                      selectedStockTake.status === 'DRAFT' ? 'bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400' :
                      selectedStockTake.status === 'IN_PROGRESS' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' :
                      selectedStockTake.status === 'COMPLETED' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' :
                      selectedStockTake.status === 'POSTED' ? 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400' :
                      'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400'
                    }>
                      {selectedStockTake.status === 'DRAFT' ? t.draft :
                       selectedStockTake.status === 'IN_PROGRESS' ? t.inProgress :
                       selectedStockTake.status === 'COMPLETED' ? t.completed :
                       selectedStockTake.status === 'POSTED' ? t.posted : t.cancelled}
                    </Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-4 pt-2 space-y-4">
                {stockTakeDetailLoading ? (
                  <div className="flex items-center justify-center py-16">
                    <Loader2 className="size-8 animate-spin text-emerald-600" />
                  </div>
                ) : (
                  <>
                    <div className="rounded-lg border overflow-auto max-h-[50vh]">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-right">{t.productName}</TableHead>
                            <TableHead className="text-right">{t.productSKU}</TableHead>
                            <TableHead className="text-right">{t.systemQty}</TableHead>
                            <TableHead className="text-right">{t.countedQty}</TableHead>
                            <TableHead className="text-right">{t.difference}</TableHead>
                            <TableHead className="text-right">{t.productCost}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {selectedStockTake.items.map((item) => {
                            const currentCount = editedCounts[item.id] !== undefined ? editedCounts[item.id] : item.countedQty;
                            const diff = currentCount !== null && currentCount !== undefined ? currentCount - item.systemQty : null;
                            return (
                              <TableRow key={item.id}>
                                <TableCell className="text-sm font-medium">
                                  <div>
                                    <p>{item.productName}</p>
                                    {item.productNameEn && <p className="text-xs text-muted-foreground">{item.productNameEn}</p>}
                                  </div>
                                </TableCell>
                                <TableCell className="text-xs font-mono text-muted-foreground">{item.sku || '-'}</TableCell>
                                <TableCell className="text-sm">{formatNumber(item.systemQty)}</TableCell>
                                <TableCell>
                                  {['DRAFT', 'IN_PROGRESS'].includes(selectedStockTake.status) ? (
                                    <Input
                                      type="number"
                                      className="w-24 h-8 text-sm"
                                      dir="ltr"
                                      value={currentCount ?? ''}
                                      onChange={(e) => {
                                        const val = e.target.value === '' ? undefined : parseFloat(e.target.value);
                                        setEditedCounts(prev => ({ ...prev, [item.id]: val }));
                                      }}
                                      placeholder="-"
                                    />
                                  ) : (
                                    <span className="text-sm font-medium">{currentCount !== null ? formatNumber(currentCount) : '-'}</span>
                                  )}
                                </TableCell>
                                <TableCell>
                                  {diff !== null ? (
                                    <span className={`text-sm font-semibold ${diff > 0 ? 'text-emerald-600 dark:text-emerald-400' : diff < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-muted-foreground'}`}>
                                      {diff > 0 ? '+' : ''}{formatNumber(diff)}
                                      {diff > 0 && <span className="text-xs mr-1">({t.surplus})</span>}
                                      {diff < 0 && <span className="text-xs mr-1">({t.shortage})</span>}
                                    </span>
                                  ) : <span className="text-muted-foreground">-</span>}
                                </TableCell>
                                <TableCell className="text-sm"><CurrencyAmount amount={item.costPrice} symbolClassName="w-3 h-3 inline-block" /></TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>

                    {/* Summary Footer */}
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                      <Card className="border-gray-200 dark:border-gray-800">
                        <CardContent className="p-3 text-center">
                          <p className="text-xs text-muted-foreground">{t.itemsCount}</p>
                          <p className="text-lg font-bold">{selectedStockTake.items.length}</p>
                        </CardContent>
                      </Card>
                      <Card className="border-blue-200 dark:border-blue-800">
                        <CardContent className="p-3 text-center">
                          <p className="text-xs text-muted-foreground">{t.countedItems}</p>
                          <p className="text-lg font-bold text-blue-600">
                            {selectedStockTake.items.filter(i => (editedCounts[i.id] !== undefined ? editedCounts[i.id] : i.countedQty) !== null).length}
                          </p>
                        </CardContent>
                      </Card>
                      <Card className="border-amber-200 dark:border-amber-800">
                        <CardContent className="p-3 text-center">
                          <p className="text-xs text-muted-foreground">{t.pendingItems}</p>
                          <p className="text-lg font-bold text-amber-600">
                            {selectedStockTake.items.filter(i => (editedCounts[i.id] !== undefined ? editedCounts[i.id] : i.countedQty) === null).length}
                          </p>
                        </CardContent>
                      </Card>
                      <Card className="border-emerald-200 dark:border-emerald-800">
                        <CardContent className="p-3 text-center">
                          <p className="text-xs text-muted-foreground">{t.totalSurplusValue}</p>
                          <p className="text-lg font-bold text-emerald-600">
                            <CurrencyAmount amount={selectedStockTake.totalSurplusValue || 0} symbolClassName="w-3 h-3 inline-block" />
                          </p>
                        </CardContent>
                      </Card>
                      <Card className="border-rose-200 dark:border-rose-800">
                        <CardContent className="p-3 text-center">
                          <p className="text-xs text-muted-foreground">{t.totalShortageValue}</p>
                          <p className="text-lg font-bold text-rose-600">
                            <CurrencyAmount amount={selectedStockTake.totalShortageValue || 0} symbolClassName="w-3 h-3 inline-block" />
                          </p>
                        </CardContent>
                      </Card>
                    </div>

                    {/* Action Buttons */}
                    {['DRAFT', 'IN_PROGRESS'].includes(selectedStockTake.status) && (
                      <div className="flex items-center gap-2 flex-wrap">
                        <Button className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white" onClick={handleSaveCounts} disabled={savingCounts}>
                          {savingCounts && <Loader2 className="size-4 animate-spin" />}
                          {t.save}
                        </Button>
                        <Button className="gap-1.5 bg-blue-600 hover:bg-blue-700 text-white" onClick={handleMarkCompleted}>
                          <CheckCircle2 className="size-4" />
                          {t.markAsCompleted}
                        </Button>
                      </div>
                    )}
                    {selectedStockTake.status === 'COMPLETED' && (
                      <Button className="gap-1.5 bg-teal-600 hover:bg-teal-700 text-white" onClick={() => setPostConfirmTarget(selectedStockTake.id)}>
                        {postingStockTake && <Loader2 className="size-4 animate-spin" />}
                        <Send className="size-4" />
                        {t.postStockTake}
                      </Button>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader className="p-4 pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold text-foreground">{t.stockTake}</CardTitle>
                  <Button className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => setNewStockTakeDialogOpen(true)}>
                    <Plus className="size-4" />
                    {t.newStockTake}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-4 pt-2">
                {stockTakeLoading ? (
                  <div className="flex items-center justify-center py-16">
                    <Loader2 className="size-8 animate-spin text-emerald-600" />
                  </div>
                ) : stockTakes.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                    <ClipboardCheck className="size-16 mb-4 opacity-30" />
                    <p className="text-lg">{t.noData}</p>
                  </div>
                ) : (
                  <div className="rounded-lg border overflow-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-right">{t.stockTakeNumber}</TableHead>
                          <TableHead className="text-right">{t.stockTakeDate}</TableHead>
                          <TableHead className="text-right">{t.branch}</TableHead>
                          <TableHead className="text-right">{t.status}</TableHead>
                          <TableHead className="text-right">{t.itemsCount}</TableHead>
                          <TableHead className="text-right">{t.actions}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {stockTakes.map((st) => (
                          <TableRow key={st.id} className="cursor-pointer hover:bg-muted/50" onClick={() => fetchStockTakeDetail(st.id)}>
                            <TableCell className="text-sm font-mono font-medium">{st.number}</TableCell>
                            <TableCell className="text-sm">{formatDate(st.date)}</TableCell>
                            <TableCell className="text-sm">{getBranchName(st.branchId)}</TableCell>
                            <TableCell>
                              <Badge className={
                                st.status === 'DRAFT' ? 'bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400' :
                                st.status === 'IN_PROGRESS' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' :
                                st.status === 'COMPLETED' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' :
                                st.status === 'POSTED' ? 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400' :
                                'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400'
                              }>
                                {st.status === 'DRAFT' ? t.draft :
                                 st.status === 'IN_PROGRESS' ? t.inProgress :
                                 st.status === 'COMPLETED' ? t.completed :
                                 st.status === 'POSTED' ? t.posted : t.cancelled}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-sm">{st.totalItems || st.items?.length || 0}</TableCell>
                            <TableCell>
                              <Button size="sm" variant="ghost" className="gap-1 text-xs" onClick={(e) => { e.stopPropagation(); fetchStockTakeDetail(st.id); }}>
                                {t.view}
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
          )}
        </TabsContent>

        {/* ─── Transfers Tab ──────────────────────────────────────────── */}
        <TabsContent value="transfers" className="mt-4">
          {selectedTransfer ? (
            <Card>
              <CardHeader className="p-4 pb-2">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <Button variant="ghost" size="sm" className="gap-1" onClick={() => setSelectedTransfer(null)}>
                      <ArrowRight className="size-4" />
                      {t.back}
                    </Button>
                    <div>
                      <CardTitle className="text-sm font-semibold text-foreground">{selectedTransfer.number}</CardTitle>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {formatDate(selectedTransfer.date)} • {getBranchName(selectedTransfer.fromBranch)} → {getBranchName(selectedTransfer.toBranch)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge className={
                      selectedTransfer.status === 'DRAFT' ? 'bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400' :
                      selectedTransfer.status === 'IN_TRANSIT' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' :
                      selectedTransfer.status === 'RECEIVED' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' :
                      'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400'
                    }>
                      {selectedTransfer.status === 'DRAFT' ? t.draft :
                       selectedTransfer.status === 'IN_TRANSIT' ? t.inTransit :
                       selectedTransfer.status === 'RECEIVED' ? t.completed : t.cancelled}
                    </Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-4 pt-2 space-y-4">
                {transferDetailLoading ? (
                  <div className="flex items-center justify-center py-16">
                    <Loader2 className="size-8 animate-spin text-emerald-600" />
                  </div>
                ) : (
                  <>
                    <div className="rounded-lg border overflow-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-right">{t.productName}</TableHead>
                            <TableHead className="text-right">{t.quantity}</TableHead>
                            <TableHead className="text-right">{t.productCost}</TableHead>
                            <TableHead className="text-right">{t.total}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {selectedTransfer.items.map((item) => (
                            <TableRow key={item.id}>
                              <TableCell className="text-sm font-medium">
                                <div>
                                  <p>{item.productName}</p>
                                  {item.productNameEn && <p className="text-xs text-muted-foreground">{item.productNameEn}</p>}
                                </div>
                              </TableCell>
                              <TableCell className="text-sm">{formatNumber(item.quantity)}</TableCell>
                              <TableCell className="text-sm"><CurrencyAmount amount={item.costPrice} symbolClassName="w-3 h-3 inline-block" /></TableCell>
                              <TableCell className="text-sm font-semibold"><CurrencyAmount amount={item.totalCost} symbolClassName="w-3 h-3 inline-block" /></TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 flex-wrap">
                      {selectedTransfer.status === 'DRAFT' && (
                        <>
                          <Button className="gap-1.5 bg-blue-600 hover:bg-blue-700 text-white" onClick={() => handleSendTransfer(selectedTransfer.id)} disabled={sendingTransfer}>
                            {sendingTransfer && <Loader2 className="size-4 animate-spin" />}
                            <Send className="size-4" />
                            {t.sendTransfer}
                          </Button>
                        </>
                      )}
                      {selectedTransfer.status === 'IN_TRANSIT' && (
                        <Button className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => handleReceiveTransfer(selectedTransfer.id)} disabled={receivingTransfer}>
                          {receivingTransfer && <Loader2 className="size-4 animate-spin" />}
                          <Inbox className="size-4" />
                          {t.receiveTransfer}
                        </Button>
                      )}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader className="p-4 pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold text-foreground">{t.stockTransfer}</CardTitle>
                  <Button className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => setNewTransferDialogOpen(true)}>
                    <Plus className="size-4" />
                    {t.newTransfer}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-4 pt-2">
                {transferLoading ? (
                  <div className="flex items-center justify-center py-16">
                    <Loader2 className="size-8 animate-spin text-emerald-600" />
                  </div>
                ) : transfers.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                    <ArrowLeftRight className="size-16 mb-4 opacity-30" />
                    <p className="text-lg">{t.noData}</p>
                  </div>
                ) : (
                  <div className="rounded-lg border overflow-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-right">{t.transferNumber}</TableHead>
                          <TableHead className="text-right">{t.date}</TableHead>
                          <TableHead className="text-right">{t.fromBranch}</TableHead>
                          <TableHead className="text-right">{t.toBranch}</TableHead>
                          <TableHead className="text-right">{t.status}</TableHead>
                          <TableHead className="text-right">{t.itemsCount}</TableHead>
                          <TableHead className="text-right">{t.actions}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {transfers.map((tr) => (
                          <TableRow key={tr.id} className="cursor-pointer hover:bg-muted/50" onClick={() => fetchTransferDetail(tr.id)}>
                            <TableCell className="text-sm font-mono font-medium">{tr.number}</TableCell>
                            <TableCell className="text-sm">{formatDate(tr.date)}</TableCell>
                            <TableCell className="text-sm">{getBranchName(tr.fromBranch)}</TableCell>
                            <TableCell className="text-sm">{getBranchName(tr.toBranch)}</TableCell>
                            <TableCell>
                              <Badge className={
                                tr.status === 'DRAFT' ? 'bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400' :
                                tr.status === 'IN_TRANSIT' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' :
                                tr.status === 'RECEIVED' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' :
                                'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400'
                              }>
                                {tr.status === 'DRAFT' ? t.draft :
                                 tr.status === 'IN_TRANSIT' ? t.inTransit :
                                 tr.status === 'RECEIVED' ? t.completed : t.cancelled}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-sm">{tr.items?.length || 0}</TableCell>
                            <TableCell>
                              <Button size="sm" variant="ghost" className="gap-1 text-xs" onClick={(e) => { e.stopPropagation(); fetchTransferDetail(tr.id); }}>
                                {t.view}
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
          )}
        </TabsContent>

        {/* ─── Reorder Tab ──────────────────────────────────────────── */}
        <TabsContent value="reorder" className="mt-4">
          {/* Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
            <Card className="border-amber-200 dark:border-amber-800">
              <CardContent className="p-4">
                <div className="flex items-center gap-2">
                  <div className="flex size-8 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400">
                    <AlertCircle className="size-4" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">{t.belowReorderLevel}</p>
                    <p className="text-lg font-bold">{reorderProducts.length}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="border-rose-200 dark:border-rose-800">
              <CardContent className="p-4">
                <div className="flex items-center gap-2">
                  <div className="flex size-8 items-center justify-center rounded-lg bg-rose-100 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400">
                    <PackageX className="size-4" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">{t.outOfStock}</p>
                    <p className="text-lg font-bold">{reorderProducts.filter(p => p.currentStock <= 0).length}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="border-emerald-200 dark:border-emerald-800">
              <CardContent className="p-4">
                <div className="flex items-center gap-2">
                  <div className="flex size-8 items-center justify-center rounded-lg bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400">
                    <ShoppingCart className="size-4" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">{t.estimatedReorderValue}</p>
                    <p className="text-lg font-bold">
                      <CurrencyAmount amount={reorderProducts.reduce((sum, p) => sum + (p.minStock - p.currentStock) * p.costPrice, 0)} symbolClassName="w-3.5 h-3.5" />
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-sm font-semibold text-foreground">{t.reorderLevel}</CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-2">
              {reorderLoading ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="size-8 animate-spin text-emerald-600" />
                </div>
              ) : reorderProducts.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                  <CheckCircle2 className="size-16 mb-4 opacity-30" />
                  <p className="text-lg">{t.noProductsBelowReorder}</p>
                </div>
              ) : (
                <div className="rounded-lg border overflow-auto max-h-[60vh]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-right">{t.productName}</TableHead>
                        <TableHead className="text-right">{t.productSKU}</TableHead>
                        <TableHead className="text-right">{t.currentStock}</TableHead>
                        <TableHead className="text-right">{t.minStock}</TableHead>
                        <TableHead className="text-right">{t.suggestedOrderQty}</TableHead>
                        <TableHead className="text-right">{t.estimatedReorderValue}</TableHead>
                        <TableHead className="text-right">{t.actions}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {reorderProducts.map((product) => {
                        const suggestedQty = Math.max(0, product.minStock - product.currentStock);
                        const reorderValue = suggestedQty * product.costPrice;
                        const isOutOfStock = product.currentStock <= 0;
                        const isNearMin = !isOutOfStock && product.currentStock <= product.minStock * 1.2;
                        return (
                          <TableRow key={product.id} className={isOutOfStock ? 'bg-rose-50/50 dark:bg-rose-900/10' : isNearMin ? 'bg-amber-50/50 dark:bg-amber-900/10' : ''}>
                            <TableCell>
                              <div>
                                <p className="font-medium text-sm">{product.name}</p>
                                {product.nameEn && <p className="text-xs text-muted-foreground">{product.nameEn}</p>}
                              </div>
                            </TableCell>
                            <TableCell className="text-xs font-mono text-muted-foreground">{product.sku || '-'}</TableCell>
                            <TableCell>
                              <span className={`text-sm font-semibold ${isOutOfStock ? 'text-rose-600 dark:text-rose-400' : 'text-amber-600 dark:text-amber-400'}`}>
                                {formatNumber(product.currentStock)}
                              </span>
                            </TableCell>
                            <TableCell className="text-sm">{formatNumber(product.minStock)}</TableCell>
                            <TableCell className="text-sm font-semibold text-blue-600 dark:text-blue-400">{formatNumber(suggestedQty)}</TableCell>
                            <TableCell className="text-sm"><CurrencyAmount amount={reorderValue} symbolClassName="w-3 h-3 inline-block" /></TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1">
                                <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => handleOpenReorderEdit(product)}>
                                  {t.updateReorderSettings}
                                </Button>
                                <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => handleOpenStockDialog(product)}>
                                  <ShoppingCart className="size-3" />
                                </Button>
                              </div>
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
        </TabsContent>

      </Tabs>

      {/* ─── Category Dialog ─────────────────────────────────────────── */}
      <Dialog open={categoryDialogOpen} onOpenChange={setCategoryDialogOpen}>
        <DialogContent className="sm:max-w-md" dir={isRTL ? 'rtl' : 'ltr'}>
          <DialogHeader>
            <DialogTitle>
              {editingCategory ? t.editCategory : t.addCategory}
            </DialogTitle>
            <DialogDescription>
              {editingCategory ? t.editCategoryDesc : t.addCategoryDesc}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="cat-name">{t.categoryNameAr}</Label>
                <Input
                  id="cat-name"
                  value={categoryForm.name}
                  onChange={(e) => setCategoryForm({ ...categoryForm, name: e.target.value })}
                  placeholder={t.categoryNamePlaceholder}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cat-nameEn">{t.categoryNameEn}</Label>
                <Input
                  id="cat-nameEn"
                  value={categoryForm.nameEn}
                  onChange={(e) => setCategoryForm({ ...categoryForm, nameEn: e.target.value })}
                  placeholder="Beverages"
                  dir="ltr"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t.branch}</Label>
                <Select
                  value={categoryForm.branchId}
                  onValueChange={(v) => setCategoryForm({ ...categoryForm, branchId: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {BRANCHES.map((b) => (
                      <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{t.sortOrder}</Label>
                <Input
                  type="number"
                  value={categoryForm.sortOrder}
                  onChange={(e) => setCategoryForm({ ...categoryForm, sortOrder: parseInt(e.target.value) || 0 })}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t.categoryIcon}</Label>
                <div className="flex flex-wrap gap-1.5">
                  {CATEGORY_ICONS.map((icon) => (
                    <button
                      key={icon}
                      className={`size-9 flex items-center justify-center rounded-md border-2 transition-colors text-lg ${
                        categoryForm.icon === icon
                          ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30'
                          : 'border-transparent hover:border-muted hover:bg-muted'
                      }`}
                      onClick={() => setCategoryForm({ ...categoryForm, icon })}
                    >
                      {icon}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <Label>{t.categoryColor}</Label>
                <div className="flex flex-wrap gap-1.5">
                  {CATEGORY_COLORS.map((c) => (
                    <button
                      key={c.value}
                      className={`size-9 rounded-md border-2 transition-colors ${
                        categoryForm.color === c.value
                          ? 'border-foreground ring-2 ring-foreground/20'
                          : 'border-transparent'
                      }`}
                      style={{ backgroundColor: c.value }}
                      onClick={() => setCategoryForm({ ...categoryForm, color: c.value })}
                      title={c.label}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCategoryDialogOpen(false)}
            >
              {t.cancel}
            </Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5"
              onClick={handleSaveCategory}
              disabled={savingCategory}
            >
              {savingCategory && <Loader2 className="size-4 animate-spin" />}
              {editingCategory ? t.save : t.add}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Product Dialog ───────────────────────────────────────────── */}
      <Dialog open={productDialogOpen} onOpenChange={setProductDialogOpen}>
        <DialogContent className="sm:max-w-lg" dir={isRTL ? 'rtl' : 'ltr'}>
          <DialogHeader>
            <DialogTitle>
              {editingProduct ? t.editProduct : t.addProductBtn}
            </DialogTitle>
            <DialogDescription>
              {editingProduct ? t.editProductDesc : t.addProductDesc}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="prod-name">{t.productNameAr}</Label>
                <Input
                  id="prod-name"
                  value={productForm.name}
                  onChange={(e) => setProductForm({ ...productForm, name: e.target.value })}
                  placeholder={t.productNamePlaceholder}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="prod-nameEn">{t.productNameEn}</Label>
                <Input
                  id="prod-nameEn"
                  value={productForm.nameEn}
                  onChange={(e) => setProductForm({ ...productForm, nameEn: e.target.value })}
                  placeholder="Orange Juice"
                  dir="ltr"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="prod-sku">{t.productSKU}</Label>
                <Input
                  id="prod-sku"
                  value={productForm.sku}
                  onChange={(e) => setProductForm({ ...productForm, sku: e.target.value })}
                  placeholder="SKU-001"
                  dir="ltr"
                />
              </div>
              <div className="space-y-2">
                <Label>{t.productCategory} *</Label>
                <Select
                  value={productForm.categoryId}
                  onValueChange={(v) => setProductForm({ ...productForm, categoryId: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t.selectCategory} />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="prod-costPrice" className="flex items-center gap-1">
                  {t.productCost}
                  <span className="text-[10px] text-muted-foreground">(تقديري / Est.)</span>
                </Label>
                <div className="relative">
                  <Input
                    id="prod-costPrice"
                    type="number"
                    step="0.01"
                    min="0"
                    value={productForm.costPrice}
                    onChange={(e) => setProductForm({ ...productForm, costPrice: e.target.value })}
                    placeholder="0.00"
                    dir="ltr"
                    className="pl-12"
                  />
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground"><CurrencySymbol className="w-3 h-3 inline-block" /></span>
                </div>
                <p className="text-[10px] text-muted-foreground">تكلفة تقديرية — لا تستخدم لحساب تكاليف المبيعات / Estimated cost — not used for COGS</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="prod-price">{t.productPrice} *</Label>
                <div className="relative">
                  <Input
                    id="prod-price"
                    type="number"
                    step="0.01"
                    min="0"
                    value={productForm.price}
                    onChange={(e) => setProductForm({ ...productForm, price: e.target.value })}
                    placeholder="0.00"
                    dir="ltr"
                    className="pl-12"
                  />
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground"><CurrencySymbol className="w-3 h-3 inline-block" /></span>
                </div>
              </div>
              <div className="space-y-2">
                <Label>{t.productUnit}</Label>
                <Select
                  value={productForm.unit}
                  onValueChange={(v) => setProductForm({ ...productForm, unit: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {UNIT_OPTIONS.map((u) => (
                      <SelectItem key={u} value={u}>{u}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="prod-minStock">{t.minStock}</Label>
                <Input
                  id="prod-minStock"
                  type="number"
                  step="0.01"
                  min="0"
                  value={productForm.minStock}
                  onChange={(e) => setProductForm({ ...productForm, minStock: e.target.value })}
                  placeholder="0"
                  dir="ltr"
                />
              </div>
              <div className="space-y-2">
                <Label>{t.branch}</Label>
                <Select
                  value={productForm.branchId}
                  onValueChange={(v) => setProductForm({ ...productForm, branchId: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {BRANCHES.map((b) => (
                      <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Margin preview (estimated — not used for COGS accounting) */}
            {productForm.costPrice && productForm.price && parseFloat(productForm.price) > 0 && (
              <div className="rounded-lg border bg-muted/50 p-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{t.profitMargin} <span className="text-[10px]">(تقديري / Est.)</span></span>
                  {(() => {
                    const cost = parseFloat(productForm.costPrice) || 0;
                    const sell = parseFloat(productForm.price);
                    const margin = sell - cost;
                    const marginPercent = sell > 0 ? (margin / sell) * 100 : 0;
                    return (
                      <span className={`font-semibold ${
                        margin > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                      }`}>
                        <CurrencyAmount amount={margin} symbolClassName="w-3.5 h-3.5" /> ({formatNumber(marginPercent)}%)
                      </span>
                    );
                  })()}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setProductDialogOpen(false)}
            >
              {t.cancel}
            </Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5"
              onClick={handleSaveProduct}
              disabled={savingProduct}
            >
              {savingProduct && <Loader2 className="size-4 animate-spin" />}
              {editingProduct ? t.save : t.add}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Stock Adjustment Dialog ──────────────────────────────────── */}
      <Dialog open={stockDialogOpen} onOpenChange={setStockDialogOpen}>
        <DialogContent className="sm:max-w-md" dir={isRTL ? 'rtl' : 'ltr'}>
          <DialogHeader>
            <DialogTitle>{t.stockAdjustment}</DialogTitle>
            <DialogDescription>
              {stockProduct && (
                <span>
                  {t.adjustStockFor}: <strong>{stockProduct.name}</strong> — {t.currentStock}:{' '}
                  <strong>{formatNumber(stockProduct.currentStock, stockProduct.unit === 'كيلو' || stockProduct.unit === 'لتر' || stockProduct.unit === 'متر' ? 2 : 0)} {stockProduct.unit}</strong>
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>{t.movementType}</Label>
              <Select
                value={stockForm.type}
                onValueChange={(v) => setStockForm({ ...stockForm, type: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ADJUSTMENT">{t.stockTypeAdjustment}</SelectItem>
                  <SelectItem value="PURCHASE">{t.stockTypePurchaseAdd}</SelectItem>
                  <SelectItem value="RETURN">{t.stockTypeReturnAdd}</SelectItem>
                  <SelectItem value="OPENING">{t.stockTypeOpening}</SelectItem>
                  <SelectItem value="TRANSFER">{t.stockTypeTransferDeduct}</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {stockForm.type === 'ADJUSTMENT'
                  ? t.adjustmentHint
                  : stockForm.type === 'PURCHASE' || stockForm.type === 'RETURN' || stockForm.type === 'OPENING'
                  ? t.additionHint
                  : t.deductionHint}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="stock-qty">{t.quantity} *</Label>
                <Input
                  id="stock-qty"
                  type="number"
                  step="0.01"
                  value={stockForm.quantity}
                  onChange={(e) => setStockForm({ ...stockForm, quantity: e.target.value })}
                  placeholder={stockForm.type === 'ADJUSTMENT' ? '+5 / -3' : '0'}
                  dir="ltr"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="stock-cost">{t.productCost}</Label>
                <div className="relative">
                  <Input
                    id="stock-cost"
                    type="number"
                    step="0.01"
                    min="0"
                    value={stockForm.costPrice}
                    onChange={(e) => setStockForm({ ...stockForm, costPrice: e.target.value })}
                    dir="ltr"
                    className="pl-12"
                  />
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground"><CurrencySymbol className="w-3 h-3 inline-block" /></span>
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <Label>{t.branch}</Label>
              <Select
                value={stockForm.branchId}
                onValueChange={(v) => setStockForm({ ...stockForm, branchId: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BRANCHES.map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="stock-notes">{t.notes}</Label>
              <Textarea
                id="stock-notes"
                value={stockForm.notes}
                onChange={(e) => setStockForm({ ...stockForm, notes: e.target.value })}
                placeholder={t.notesPlaceholder}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setStockDialogOpen(false)}
            >
              {t.cancel}
            </Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5"
              onClick={handleSaveStock}
              disabled={savingStock}
            >
              {savingStock && <Loader2 className="size-4 animate-spin" />}
              {t.registerMovement}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Delete Category Confirmation ─────────────────────────────── */}
      <AlertDialog
        open={!!deleteCategoryTarget}
        onOpenChange={(open) => !open && setDeleteCategoryTarget(null)}
      >
        <AlertDialogContent dir={isRTL ? 'rtl' : 'ltr'}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.deleteCategory}</AlertDialogTitle>
            <AlertDialogDescription>
              {t.confirmDeactivateCategory} &quot;{deleteCategoryTarget?.name}&quot;?
              {deleteCategoryTarget?.productsCount && deleteCategoryTarget.productsCount > 0 && (
                <span className="block mt-2 text-rose-600 dark:text-rose-400">
                  {t.categoryHasActiveProducts}
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.cancel}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-600 hover:bg-rose-700 text-white"
              onClick={handleDeleteCategory}
              disabled={!!deleteCategoryTarget?.productsCount && deleteCategoryTarget.productsCount > 0}
            >
              {t.deactivate}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ─── Delete Product Confirmation ──────────────────────────────── */}
      <AlertDialog
        open={!!deleteProductTarget}
        onOpenChange={(open) => !open && setDeleteProductTarget(null)}
      >
        <AlertDialogContent dir={isRTL ? 'rtl' : 'ltr'}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.deactivateProduct}</AlertDialogTitle>
            <AlertDialogDescription>
              {t.confirmDeactivateProduct} &quot;{deleteProductTarget?.name}&quot;?
              {t.deactivateProductDesc}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.cancel}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-600 hover:bg-rose-700 text-white"
              onClick={handleDeleteProduct}
            >
              {t.deactivate}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ─── Product Import Dialog ──────────────────────────────────── */}
      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto" dir={isRTL ? 'rtl' : 'ltr'}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="size-5 text-emerald-600" />
              {t.importProductsTitle || 'استيراد الأصناف والوجبات'}
            </DialogTitle>
            <DialogDescription>
              {t.importProductsDesc || 'استيراد الأصناف والوجبات من ملف Excel أو CSV'}
            </DialogDescription>
          </DialogHeader>

          {/* Upload Step */}
          {importStep === 'upload' && (
            <div className="space-y-4 py-2">
              <div className="flex items-center gap-2 mb-4">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={handleDownloadTemplate}
                >
                  <Download className="size-4" />
                  {t.downloadTemplate || 'تحميل القالب'}
                </Button>
              </div>

              <div className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-8 text-center hover:border-emerald-400 transition-colors">
                <Upload className="size-12 mx-auto mb-3 text-muted-foreground/50" />
                <p className="text-sm font-medium mb-2">
                  {t.importDropFile || 'اسحب الملف هنا أو انقر للاختيار'}
                </p>
                <p className="text-xs text-muted-foreground mb-4">
                  {t.importFileFormats || 'Excel (.xlsx, .xls) أو CSV'}
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleFileUpload}
                  className="hidden"
                  id="product-import-file"
                />
                <Button
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  className="gap-1.5"
                >
                  <Upload className="size-4" />
                  {t.chooseFile || 'اختيار ملف'}
                </Button>
              </div>

              <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                <p className="text-sm font-medium">{t.importColumns || 'الأعمدة المطلوبة:'}</p>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="flex items-center gap-1.5">
                    <Badge variant="outline" className="bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 text-[10px]">
                      {t.importColRequired || 'مطلوب'}
                    </Badge>
                    <span>Name / الاسم</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Badge variant="outline" className="bg-muted text-muted-foreground text-[10px]">
                      {t.importColOptional || 'اختياري'}
                    </Badge>
                    <span>Name (Arabic) / الاسم عربي</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Badge variant="outline" className="bg-muted text-muted-foreground text-[10px]">
                      {t.importColOptional || 'اختياري'}
                    </Badge>
                    <span>Cost Price / سعر التكلفة</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Badge variant="outline" className="bg-muted text-muted-foreground text-[10px]">
                      {t.importColOptional || 'اختياري'}
                    </Badge>
                    <span>Selling Price / سعر البيع</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Preview Step */}
          {importStep === 'preview' && (
            <div className="space-y-4 py-2">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  {t.importPreviewCount || 'عدد الصفوف'}: {importData.length}
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setImportStep('upload');
                    setImportData([]);
                  }}
                >
                  {t.importChangeFile || 'تغيير الملف'}
                </Button>
              </div>

              <div className="max-h-72 overflow-y-auto border rounded-lg">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">#</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Name (Arabic)</TableHead>
                      <TableHead className="text-left">Cost Price <span className="text-[10px] text-muted-foreground">(Opt.)</span></TableHead>
                      <TableHead className="text-left">Selling Price</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {importData.map((row, idx) => {
                      const name = (row.Name || row.name || row['Name (Arabic)'] || row['name (arabic)'] || row['الاسم'] || '').toString().trim();
                      const nameAr = (row['Name (Arabic)'] || row['name (Arabic)'] || row['name (arabic)'] || row['الاسم عربي'] || '').toString().trim();
                      const costPrice = row['Cost Price'] || row['Cost Prise'] || row['cost price'] || row['costPrice'] || row['سعر التكلفة'] || row['تكلفة'] || '';
                      const sellingPrice = row['Selling Price'] || row['selling price'] || row['Price'] || row['price'] || row['سعر البيع'] || row['سعر'] || '';
                      const hasName = !!(name || nameAr);

                      return (
                        <TableRow key={row._rowIdx} className={!hasName ? 'bg-rose-50 dark:bg-rose-900/10' : ''}>
                          <TableCell className="text-xs text-muted-foreground">{idx + 2}</TableCell>
                          <TableCell className={hasName ? '' : 'text-rose-500'}>
                            {name || (nameAr ? '' : '—')}
                          </TableCell>
                          <TableCell>{nameAr || '—'}</TableCell>
                          <TableCell className="text-left">{costPrice || '0'}</TableCell>
                          <TableCell className="text-left">{sellingPrice || '0'}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setImportDialogOpen(false)}>
                  {t.cancel}
                </Button>
                <Button
                  className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5"
                  onClick={handleImportProducts}
                  disabled={importData.length === 0}
                >
                  <Upload className="size-4" />
                  {t.importBtn || 'استيراد'} ({importData.length})
                </Button>
              </DialogFooter>
            </div>
          )}

          {/* Importing Step */}
          {importStep === 'importing' && (
            <div className="flex flex-col items-center justify-center py-12 gap-4">
              <Loader2 className="size-12 animate-spin text-emerald-600" />
              <p className="text-sm text-muted-foreground">
                {t.importingProducts || 'جارٍ استيراد المنتجات...'}
              </p>
            </div>
          )}

          {/* Results Step */}
          {importStep === 'results' && importResults && (
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-3 gap-3">
                <Card>
                  <CardContent className="p-4 text-center">
                    <p className="text-2xl font-bold text-foreground">{importResults.total}</p>
                    <p className="text-xs text-muted-foreground">{t.importTotal || 'إجمالي'}</p>
                  </CardContent>
                </Card>
                <Card className="border-emerald-200 dark:border-emerald-800">
                  <CardContent className="p-4 text-center">
                    <p className="text-2xl font-bold text-emerald-600">{importResults.success}</p>
                    <p className="text-xs text-muted-foreground">{t.importSuccess || 'نجح'}</p>
                  </CardContent>
                </Card>
                <Card className={importResults.failed > 0 ? 'border-rose-200 dark:border-rose-800' : ''}>
                  <CardContent className="p-4 text-center">
                    <p className="text-2xl font-bold text-rose-600">{importResults.failed}</p>
                    <p className="text-xs text-muted-foreground">{t.importFailed || 'فشل'}</p>
                  </CardContent>
                </Card>
              </div>

              {importResults.errors.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-rose-600">
                    {t.importErrors || 'أخطاء الاستيراد:'}
                  </p>
                  <div className="max-h-40 overflow-y-auto border rounded-lg">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-16">{t.importRow || 'صف'}</TableHead>
                          <TableHead>{t.importName || 'اسم'}</TableHead>
                          <TableHead>{t.importError || 'خطأ'}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {importResults.errors.map((err) => (
                          <TableRow key={err.row}>
                            <TableCell className="text-xs">{err.row}</TableCell>
                            <TableCell className="text-xs">{err.name}</TableCell>
                            <TableCell className="text-xs text-rose-600">{err.error}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}

              <DialogFooter>
                <Button
                  className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5"
                  onClick={() => setImportDialogOpen(false)}
                >
                  <CheckCircle2 className="size-4" />
                  {t.done || 'تم'}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ─── New Stock Take Dialog ─────────────────────────────────────── */}
      <Dialog open={newStockTakeDialogOpen} onOpenChange={setNewStockTakeDialogOpen}>
        <DialogContent className="sm:max-w-md" dir={isRTL ? 'rtl' : 'ltr'}>
          <DialogHeader>
            <DialogTitle>{t.newStockTake}</DialogTitle>
            <DialogDescription>{t.stockTake}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>{t.branch}</Label>
              <Select value={stockTakeForm.branchId} onValueChange={(v) => setStockTakeForm({ ...stockTakeForm, branchId: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {BRANCHES.map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t.stockTakeDate}</Label>
              <Input type="date" value={stockTakeForm.date} onChange={(e) => setStockTakeForm({ ...stockTakeForm, date: e.target.value })} dir="ltr" />
            </div>
            <div className="space-y-2">
              <Label>{t.notes}</Label>
              <Textarea value={stockTakeForm.notes} onChange={(e) => setStockTakeForm({ ...stockTakeForm, notes: e.target.value })} placeholder={t.notesPlaceholder} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewStockTakeDialogOpen(false)}>{t.cancel}</Button>
            <Button className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white" onClick={handleCreateStockTake} disabled={creatingStockTake}>
              {creatingStockTake && <Loader2 className="size-4 animate-spin" />}
              {t.create}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── New Transfer Dialog ───────────────────────────────────────── */}
      <Dialog open={newTransferDialogOpen} onOpenChange={setNewTransferDialogOpen}>
        <DialogContent className="sm:max-w-lg" dir={isRTL ? 'rtl' : 'ltr'}>
          <DialogHeader>
            <DialogTitle>{t.newTransfer}</DialogTitle>
            <DialogDescription>{t.stockTransfer}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t.fromBranch}</Label>
                <Select value={transferForm.fromBranch} onValueChange={(v) => setTransferForm({ ...transferForm, fromBranch: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {BRANCHES.map((b) => (
                      <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{t.toBranch}</Label>
                <Select value={transferForm.toBranch} onValueChange={(v) => setTransferForm({ ...transferForm, toBranch: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {BRANCHES.filter(b => b.id !== transferForm.fromBranch).map((b) => (
                      <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>{t.date}</Label>
              <Input type="date" value={transferForm.date} onChange={(e) => setTransferForm({ ...transferForm, date: e.target.value })} dir="ltr" />
            </div>

            {/* Add Items */}
            <div className="space-y-2">
              <Label>{t.addTransferItem}</Label>
              <div className="flex gap-2">
                <Select onValueChange={(productId) => {
                  const product = products.find(p => p.id === productId);
                  if (product && !transferItems.find(i => i.productId === productId)) {
                    setTransferItems([...transferItems, { productId: product.id, productName: product.name, quantity: 1, costPrice: product.costPrice }]);
                  }
                }}>
                  <SelectTrigger><SelectValue placeholder={t.search} /></SelectTrigger>
                  <SelectContent>
                    {products.filter(p => p.isActive && p.branchId === transferForm.fromBranch && !transferItems.find(i => i.productId === p.id)).map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name} {p.sku ? `(${p.sku})` : ''}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Transfer Items List */}
            {transferItems.length > 0 && (
              <div className="rounded-lg border overflow-auto max-h-48">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-right">{t.productName}</TableHead>
                      <TableHead className="text-right">{t.quantity}</TableHead>
                      <TableHead className="text-right">{t.actions}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {transferItems.map((item, idx) => (
                      <TableRow key={item.productId}>
                        <TableCell className="text-sm">{item.productName}</TableCell>
                        <TableCell>
                          <Input type="number" min="1" className="w-20 h-8 text-sm" dir="ltr" value={item.quantity}
                            onChange={(e) => {
                              const newItems = [...transferItems];
                              newItems[idx] = { ...newItems[idx], quantity: parseInt(e.target.value) || 1 };
                              setTransferItems(newItems);
                            }}
                          />
                        </TableCell>
                        <TableCell>
                          <Button size="icon" variant="ghost" className="size-7 text-rose-600" onClick={() => setTransferItems(transferItems.filter((_, i) => i !== idx))}>
                            <X className="size-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            <div className="space-y-2">
              <Label>{t.notes}</Label>
              <Textarea value={transferForm.notes} onChange={(e) => setTransferForm({ ...transferForm, notes: e.target.value })} placeholder={t.notesPlaceholder} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setNewTransferDialogOpen(false); setTransferItems([]); }}>{t.cancel}</Button>
            <Button className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white" onClick={handleCreateTransfer} disabled={creatingTransfer}>
              {creatingTransfer && <Loader2 className="size-4 animate-spin" />}
              {t.create}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Post Stock Take Confirm ─────────────────────────────────────── */}
      <AlertDialog open={!!postConfirmTarget} onOpenChange={(open) => !open && setPostConfirmTarget(null)}>
        <AlertDialogContent dir={isRTL ? 'rtl' : 'ltr'}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.postStockTake}</AlertDialogTitle>
            <AlertDialogDescription>{t.postStockTakeConfirm}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.cancel}</AlertDialogCancel>
            <AlertDialogAction className="bg-teal-600 hover:bg-teal-700 text-white" onClick={() => postConfirmTarget && handlePostStockTake(postConfirmTarget)}>
              {t.confirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ─── Reorder Settings Dialog ─────────────────────────────────────── */}
      <Dialog open={!!reorderEditTarget} onOpenChange={(open) => !open && setReorderEditTarget(null)}>
        <DialogContent className="sm:max-w-md" dir={isRTL ? 'rtl' : 'ltr'}>
          <DialogHeader>
            <DialogTitle>{t.updateReorderSettings}</DialogTitle>
            <DialogDescription>
              {reorderEditTarget?.name}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>{t.minStock}</Label>
              <Input type="number" step="0.01" min="0" value={reorderForm.minStock}
                onChange={(e) => setReorderForm({ ...reorderForm, minStock: e.target.value })} dir="ltr" />
            </div>
            <div className="space-y-2">
              <Label>{t.maxStock}</Label>
              <Input type="number" step="0.01" min="0" value={reorderForm.maxStock}
                onChange={(e) => setReorderForm({ ...reorderForm, maxStock: e.target.value })} dir="ltr" />
            </div>
            <div className="space-y-2">
              <Label>{t.reorderQuantity}</Label>
              <Input type="number" step="0.01" min="0" value={reorderForm.reorderQuantity}
                onChange={(e) => setReorderForm({ ...reorderForm, reorderQuantity: e.target.value })} dir="ltr" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReorderEditTarget(null)}>{t.cancel}</Button>
            <Button className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white" onClick={handleSaveReorder} disabled={savingReorder}>
              {savingReorder && <Loader2 className="size-4 animate-spin" />}
              {t.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
