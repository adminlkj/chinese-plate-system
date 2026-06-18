'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import {
  ShoppingCart,
  CreditCard,
  Receipt,
  ArrowRightLeft,
  Save,
  X,
  Loader2,
  CheckCircle2,
  ArrowUpDown,
  Landmark,
  Banknote,
  ArrowLeftRight,
  Percent,
  Upload,
} from 'lucide-react';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';

import {
  formatNumber,
  TAX_RATE,
  type AccountType,
  type Branch,
  type JournalEntryType,
  type PaymentMethod,
} from '@/lib/types';
import { CurrencyAmount } from '@/components/ui/currency-symbol';
import ImportDialog from '@/components/accounting/import-dialog';
import { useTranslation } from '@/lib/i18n';

// ─── Types ───────────────────────────────────────────────

interface Account {
  id: string;
  code: string;
  name: string;
  nameEn?: string;
  type: AccountType;
  parentId?: string;
  branch: Branch;
  level: number;
  isActive: boolean;
  children?: Account[];
}

interface Customer {
  id: string;
  name: string;
  nameEn?: string;
  type: string;
  phone?: string;
  email?: string;
  balance: number;
  isActive: boolean;
}

interface Supplier {
  id: string;
  name: string;
  nameEn?: string;
  phone?: string;
  email?: string;
  balance: number;
  isActive: boolean;
}

interface PreviewLine {
  accountId: string;
  accountName: string;
  accountCode: string;
  debit: number;
  credit: number;
}

type SaleSubType = 'CASH' | 'BANK' | 'PLATFORM';
type ExpensePaymentMethod = 'CASH' | 'SADAD' | 'CARD' | 'TRANSFER';
type PurchasePaymentMethod = 'CASH' | 'TRANSFER' | 'CARD' | 'CREDIT';
type SettlementDirection = 'COLLECTION' | 'PAYMENT';
type SettlementPaymentMethod = 'CASH' | 'BANK';
type TransferSubType = 'DEPOSIT' | 'WITHDRAWAL' | 'TRANSFER';
type WithdrawalPaymentMethod = 'CASH' | 'BANK_TRANSFER' | 'BANK_SADAD';

// ─── Helpers ─────────────────────────────────────────────

function getTodayDate(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// ─── Component ───────────────────────────────────────────

export default function TransactionEntry() {
  const { t, isRTL } = useTranslation();

  // ── Local helper functions replacing label maps from types.ts ──
  function getBranchLabel(branch: Branch): string {
    switch (branch) {
      case 'CHINA_TOWN': return t.branchChinaTown;
      case 'PALACE_INDIA': return t.branchPalaceIndia;
      default: return branch;
    }
  }

  function getEntryTypeLabel(type: JournalEntryType): string {
    const map: Record<JournalEntryType, string> = {
      SALE_CASH: t.saleCash,
      SALE_BANK: t.saleBank,
      SALE_PLATFORM: t.salePlatform,
      SALE_RETURN_CASH: t.saleReturnCash,
      SALE_RETURN_BANK: t.saleReturnBank,
      SALE_RETURN_PLATFORM: t.saleReturnPlatform,
      EXPENSE_CASH: t.expenseCash,
      EXPENSE_BANK: t.expenseBank,
      EXPENSE_SADAD: t.expenseSadad,
      PURCHASE_CASH: t.purchaseCash,
      PURCHASE_BANK: t.purchaseBank,
      PURCHASE_CREDIT: t.purchaseCredit,
      PURCHASE_RETURN_CASH: (t as Record<string, string>).purchaseReturnCash || 'مرتجع مشتريات نقدي',
      PURCHASE_RETURN_BANK: (t as Record<string, string>).purchaseReturnBank || 'مرتجع مشتريات بنكي',
      PURCHASE_RETURN_CREDIT: (t as Record<string, string>).purchaseReturnCredit || 'مرتجع مشتريات آجل',
      COLLECTION: t.collection,
      PAYMENT: t.payment,
      DEPOSIT: t.deposit,
      WITHDRAWAL: t.withdrawal,
      TRANSFER: t.transfer,
      MANUAL: t.manual,
      OPENING_BALANCE: t.openingBalance,
      YEAR_END_CLOSING: (t as Record<string, string>).yearEndClosing || 'قفل نهاية السنة',
    };
    return map[type] || type;
  }

  function getPaymentMethodLabel(method: PaymentMethod): string {
    const map: Record<PaymentMethod, string> = {
      CASH: t.cash,
      MADA: t.mada,
      VISA: t.visa,
      MASTERCARD: t.mastercard,
      OTHER_CARD: t.otherCard,
      SADAD: t.sadad,
      TRANSFER: t.bankTransfer,
      CREDIT: t.credit,
    };
    return map[method] || method;
  }

  // ── Data state ──
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);

  // ── Date (shared across all forms) ──
  const [transactionDate, setTransactionDate] = useState(getTodayDate());

  // ── Sale form ──
  const [saleSubType, setSaleSubType] = useState<SaleSubType>('CASH');
  const [saleAmount, setSaleAmount] = useState('');
  const [saleBranch, setSaleBranch] = useState<Branch>('CHINA_TOWN');
  const [salePaymentMethod, setSalePaymentMethod] = useState<PaymentMethod>('MADA');
  const [saleCustomerId, setSaleCustomerId] = useState('');
  const [saleInvoiceNumber, setSaleInvoiceNumber] = useState('');
  const [saleDescription, setSaleDescription] = useState('');
  const [saleApplyTax, setSaleApplyTax] = useState(false);
  const [saleDiscount, setSaleDiscount] = useState('');

  // ── Expense form ──
  const [expenseAccountId, setExpenseAccountId] = useState('');
  const [expenseAmount, setExpenseAmount] = useState('');
  const [expensePaymentMethod, setExpensePaymentMethod] = useState<ExpensePaymentMethod>('CASH');
  const [expenseDescription, setExpenseDescription] = useState('');
  const [expenseApplyTax, setExpenseApplyTax] = useState(false);
  const [expenseDiscount, setExpenseDiscount] = useState('');
  const [expenseSupplierId, setExpenseSupplierId] = useState('');

  // ── Purchase form ──
  const [purchaseAccountId, setPurchaseAccountId] = useState('');
  const [purchaseAmount, setPurchaseAmount] = useState('');
  const [purchasePaymentMethod, setPurchasePaymentMethod] = useState<PurchasePaymentMethod>('CASH');
  const [purchaseSupplierId, setPurchaseSupplierId] = useState('');
  const [purchaseDescription, setPurchaseDescription] = useState('');
  const [purchaseApplyTax, setPurchaseApplyTax] = useState(false);
  const [purchaseDiscount, setPurchaseDiscount] = useState('');

  // ── Settlement form ──
  const [settlementDirection, setSettlementDirection] = useState<SettlementDirection>('COLLECTION');
  const [settlementPayableAccountId, setSettlementPayableAccountId] = useState('');
  const [settlementAmount, setSettlementAmount] = useState('');
  const [settlementPaymentMethod, setSettlementPaymentMethod] = useState<SettlementPaymentMethod>('CASH');
  const [settlementCustomerId, setSettlementCustomerId] = useState('');
  const [settlementInvoiceNumber, setSettlementInvoiceNumber] = useState('');
  const [settlementSupplierId, setSettlementSupplierId] = useState('');

  // ── Transfer form (new tab) ──
  const [transferSubType, setTransferSubType] = useState<TransferSubType>('DEPOSIT');
  const [transferAmount, setTransferAmount] = useState('');
  const [transferFromAccountId, setTransferFromAccountId] = useState('');
  const [transferToAccountId, setTransferToAccountId] = useState('');
  const [transferBankAccountId, setTransferBankAccountId] = useState('');
  const [transferWithdrawalPaymentMethod, setTransferWithdrawalPaymentMethod] = useState<WithdrawalPaymentMethod>('CASH');
  const [transferDescription, setTransferDescription] = useState('');

  // ── Save state ──
  const [saving, setSaving] = useState(false);

  // ── Current tab ──
  const [activeTab, setActiveTab] = useState('sales');

  // ── Import state ──
  const [importOpen, setImportOpen] = useState(false);
  const [importType, setImportType] = useState('SALE_CASH');
  const [importLabel, setImportLabel] = useState(t.saleCash);

  function openImportDialog(type: string) {
    setImportType(type);
    setImportLabel(getEntryTypeLabel(type as JournalEntryType) || type);
    setImportOpen(true);
  }

  // ── Get current import type based on active tab and sub-type ──
  function getCurrentImportType(): string {
    if (activeTab === 'sales') {
      if (saleSubType === 'CASH') return 'SALE_CASH';
      if (saleSubType === 'BANK') return 'SALE_BANK';
      return 'SALE_PLATFORM';
    }
    if (activeTab === 'expenses') {
      if (expensePaymentMethod === 'CASH') return 'EXPENSE_CASH';
      if (expensePaymentMethod === 'SADAD') return 'EXPENSE_SADAD';
      return 'EXPENSE_BANK';
    }
    if (activeTab === 'purchases') {
      if (purchasePaymentMethod === 'CASH') return 'PURCHASE_CASH';
      if (purchasePaymentMethod === 'CREDIT') return 'PURCHASE_CREDIT';
      return 'PURCHASE_BANK';
    }
    if (activeTab === 'settlement') {
      return settlementDirection === 'COLLECTION' ? 'COLLECTION' : 'PAYMENT';
    }
    if (activeTab === 'transfer') {
      return transferSubType;
    }
    return 'SALE_CASH';
  }

  // ────────────────────────────────────────────
  // DATA FETCHING
  // ────────────────────────────────────────────

  useEffect(() => {
    async function fetchData() {
      try {
        const [accRes, custRes, supRes] = await Promise.all([
          fetch('/api/accounts'),
          fetch('/api/customers'),
          fetch('/api/suppliers'),
        ]);

        if (!accRes.ok) throw new Error(t.errorFetchAccounts);
        if (!custRes.ok) throw new Error(t.errorFetchCustomers);
        if (!supRes.ok) throw new Error(t.errorFetchSuppliers);

        const [accData, custData, supData] = await Promise.all([
          accRes.json(),
          custRes.json(),
          supRes.json(),
        ]);

        setAccounts(flattenAccounts(accData));
        setCustomers(Array.isArray(custData) ? custData : (custData.customers || []));
        setSuppliers(Array.isArray(supData) ? supData : (supData.suppliers || []));
      } catch (err: any) {
        toast.error(err.message || t.errorLoadingData);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  function flattenAccounts(tree: Account[]): Account[] {
    const result: Account[] = [];
    for (const acc of tree) {
      result.push(acc);
      if (acc.children && acc.children.length > 0) {
        result.push(...flattenAccounts(acc.children));
      }
    }
    return result;
  }

  // ── Helper: find account by code ──
  function findAccountByCode(code: string): Account | undefined {
    return accounts.find((a) => a.code === code);
  }

  // ── Helper: find leaf bank account (first active child under 1010, fallback to 1010) ──
  function findLeafBankAccount(): Account | undefined {
    const parent1010 = findAccountByCode('1010');
    if (parent1010) {
      // Find first active leaf child (e.g., 1011, 1012)
      const leaf = accounts.find(a => a.parentId === parent1010.id && a.isActive);
      if (leaf) return leaf;
      // Fallback: parent itself (old DB without children)
      return parent1010;
    }
    // Last resort: any active account starting with 101
    return accounts.find(a => a.code.startsWith('101') && a.isActive);
  }

  // ── Helper: find platform customers account (1102, fallback to 1100) ──
  function findPlatformCustomersAccount(): Account | undefined {
    const acc1102 = findAccountByCode('1102');
    if (acc1102 && acc1102.isActive) return acc1102;
    // Fallback: any active child under 1100
    const parent1100 = findAccountByCode('1100');
    if (parent1100) {
      const leaf = accounts.find(a => a.parentId === parent1100.id && a.isActive);
      if (leaf) return leaf;
      return parent1100; // old DB without children
    }
    return undefined;
  }

  // ── Helper: find local suppliers account (2001, fallback to 2000) ──
  function findLocalSuppliersAccount(): Account | undefined {
    const acc2001 = findAccountByCode('2001');
    if (acc2001 && acc2001.isActive) return acc2001;
    // Fallback: any active child under 2000
    const parent2000 = findAccountByCode('2000');
    if (parent2000) {
      const leaf = accounts.find(a => a.parentId === parent2000.id && a.isActive);
      if (leaf) return leaf;
      return parent2000; // old DB without children
    }
    return undefined;
  }

  // ── Filtered account lists ──
  // Filter out parent accounts (accounts with children) from selection dropdowns
  // to prevent postings to summary/parent accounts which would cause trial balance imbalance
  const parentAccountIds = useMemo(() => new Set(
    accounts.filter(a => a.children && a.children.length > 0).map(a => a.id)
  ), [accounts]);

  const leafAccounts = useMemo(() => accounts.filter(a => !parentAccountIds.has(a.id)), [accounts, parentAccountIds]);

  const expenseAccounts = useMemo(() => leafAccounts.filter(
    (a) => a.type === 'EXPENSE' && a.isActive && a.level >= 1
  ), [leafAccounts]);

  const purchaseAccounts = useMemo(() => leafAccounts.filter(
    (a) => a.type === 'EXPENSE' && a.code.startsWith('5') && a.isActive
  ), [leafAccounts]);

  // Payable accounts: include parent 2000 and its children (2001, 2002) + other liabilities
  const payableAccounts = useMemo(() => accounts.filter(
    (a) => a.isActive && (
      ['2100', '2200', '2300', '2400', '2500', '2600'].includes(a.code) ||
      a.code === '2000' ||
      (a.code.startsWith('200') && a.code.length === 4) // includes 2001, 2002, etc.
    )
  ), [accounts]);

  // Whether to show the supplier dropdown in settlement PAYMENT direction
  // Show by default if no payable account is selected; hide if the payable account
  // is not related to suppliers (i.e., code does not start with '20')
  const showSupplierInSettlement = useMemo(() => {
    if (!settlementPayableAccountId) return true; // show by default if no account selected
    const acc = accounts.find((a) => a.id === settlementPayableAccountId);
    return !acc || acc.code.startsWith('20');
  }, [settlementPayableAccountId, accounts]);

  // Bank accounts for deposit/transfer: include leaf bank accounts under 1010
  const bankAccounts = useMemo(() => accounts.filter(
    (a) => a.isActive && a.type === 'ASSET' && (
      a.code.startsWith('101') && a.code.length === 4 && a.code !== '1010' || // 1011, 1012, 1013, 1014
      a.code === '1020' // backward compat for old DB
    )
  ), [accounts]);

  // All asset accounts for transfer
  const assetAccounts = useMemo(() => accounts.filter(
    (a) => a.type === 'ASSET' && a.isActive && a.level >= 1
  ), [accounts]);

  // ── Tax/Discount calculations ──
  const saleTaxAmount = saleApplyTax ? Math.round((parseFloat(saleAmount) || 0) * TAX_RATE * 100) / 100 : 0;
  const saleDiscountAmount = parseFloat(saleDiscount) || 0;

  const expenseTaxAmount = expenseApplyTax ? Math.round((parseFloat(expenseAmount) || 0) * TAX_RATE * 100) / 100 : 0;
  const expenseDiscountAmount = parseFloat(expenseDiscount) || 0;

  const purchaseTaxAmount = purchaseApplyTax ? Math.round((parseFloat(purchaseAmount) || 0) * TAX_RATE * 100) / 100 : 0;
  const purchaseDiscountAmount = parseFloat(purchaseDiscount) || 0;

  // ────────────────────────────────────────────
  // PREVIEW COMPUTATION
  // ────────────────────────────────────────────

  const getPreviewLines = useCallback((): PreviewLine[] => {
    const lines: PreviewLine[] = [];

    if (activeTab === 'sales') {
      const amount = parseFloat(saleAmount) || 0;
      if (amount <= 0) return lines;
      const tax = saleTaxAmount;
      const discount = saleDiscountAmount;

      // Determine receiving account
      let receivingAcc: Account | undefined;
      if (saleSubType === 'CASH') {
        receivingAcc = findAccountByCode('1000');
      } else if (saleSubType === 'BANK') {
        receivingAcc = findLeafBankAccount();
      } else {
        receivingAcc = findPlatformCustomersAccount(); // customers AR for platform
      }

      // Determine sales account — each branch must have its own sales sub-account under 4000
      let salesAcc: Account | undefined;
      if (saleSubType === 'PLATFORM') {
        salesAcc = findAccountByCode('4300');
      } else {
        // Look up the sales sub-account by branch field
        const parent4000 = findAccountByCode('4000');
        if (parent4000) {
          salesAcc = accounts.find(a =>
            a.parentId === parent4000.id &&
            a.branch === saleBranch &&
            a.type === 'REVENUE' &&
            a.code !== '4300' &&
            a.isActive
          );
        }
        // Fallback: try legacy hardcoded codes
        if (!salesAcc) {
          if (saleBranch === 'CHINA_TOWN') salesAcc = findAccountByCode('4100');
          else if (saleBranch === 'PALACE_INDIA') salesAcc = findAccountByCode('4200');
        }
        if (!salesAcc) {
          toast.error(`لا يوجد حساب مبيعات للفرع المحدد. يجب إنشاء حساب مبيعات فرعي.`);
          return lines;
        }
      }

      const outputTaxAcc = findAccountByCode('2100');
      const discountAllowedAcc = findAccountByCode('5800');

      // Debit: Cash/Bank/AR receives amount + tax - discount
      const receivedAmount = amount + tax - discount;
      lines.push({
        accountId: receivingAcc?.id || '',
        accountName: receivingAcc?.name || (saleSubType === 'CASH' ? t.cashLabel : saleSubType === 'BANK' ? t.bankLabel : t.customers),
        accountCode: receivingAcc?.code || (saleSubType === 'CASH' ? '1000' : saleSubType === 'BANK' ? '1011' : '1102'),
        debit: receivedAmount,
        credit: 0,
      });

      // Debit: Discount Allowed (if any)
      if (discount > 0) {
        lines.push({
          accountId: discountAllowedAcc?.id || '',
          accountName: discountAllowedAcc?.name || t.discountAllowed,
          accountCode: discountAllowedAcc?.code || '5800',
          debit: discount,
          credit: 0,
        });
      }

      // Credit: Sales amount
      lines.push({
        accountId: salesAcc?.id || '',
        accountName: salesAcc?.name || t.salesLabel,
        accountCode: salesAcc?.code || '4100',
        debit: 0,
        credit: amount,
      });

      // Credit: Output Tax (if any)
      if (tax > 0) {
        lines.push({
          accountId: outputTaxAcc?.id || '',
          accountName: outputTaxAcc?.name || t.outputTax,
          accountCode: outputTaxAcc?.code || '2100',
          debit: 0,
          credit: tax,
        });
      }
    }

    if (activeTab === 'expenses') {
      const amount = parseFloat(expenseAmount) || 0;
      if (amount <= 0) return lines;
      const expAcc = accounts.find((a) => a.id === expenseAccountId);
      if (!expAcc) return lines;
      const tax = expenseTaxAmount;
      const discount = expenseDiscountAmount;

      const inputTaxAcc = findAccountByCode('1200');
      const discountReceivedAcc = findAccountByCode('4400');

      // Debit: Expense account
      lines.push({
        accountId: expAcc.id,
        accountName: expAcc.name,
        accountCode: expAcc.code,
        debit: amount,
        credit: 0,
      });

      // Debit: Input Tax (if any)
      if (tax > 0) {
        lines.push({
          accountId: inputTaxAcc?.id || '',
          accountName: inputTaxAcc?.name || t.inputTax,
          accountCode: inputTaxAcc?.code || '1200',
          debit: tax,
          credit: 0,
        });
      }

      // Credit: Discount Received (if any)
      if (discount > 0) {
        lines.push({
          accountId: discountReceivedAcc?.id || '',
          accountName: discountReceivedAcc?.name || t.discountReceived,
          accountCode: discountReceivedAcc?.code || '4400',
          debit: 0,
          credit: discount,
        });
      }

      // Credit: Cash/Bank pays amount + tax - discount
      const totalPaid = amount + tax - discount;
      if (expensePaymentMethod === 'CASH') {
        const cashAcc = findAccountByCode('1000');
        lines.push({
          accountId: cashAcc?.id || '',
          accountName: cashAcc?.name || t.cashLabel,
          accountCode: cashAcc?.code || '1000',
          debit: 0,
          credit: totalPaid,
        });
      } else {
        const bankAcc = findLeafBankAccount();
        lines.push({
          accountId: bankAcc?.id || '',
          accountName: bankAcc?.name || t.bankLabel,
          accountCode: bankAcc?.code || '1011',
          debit: 0,
          credit: totalPaid,
        });
      }
    }

    if (activeTab === 'purchases') {
      const amount = parseFloat(purchaseAmount) || 0;
      if (amount <= 0) return lines;
      const purchAcc = accounts.find((a) => a.id === purchaseAccountId);
      if (!purchAcc) return lines;
      const tax = purchaseTaxAmount;
      const discount = purchaseDiscountAmount;

      const inputTaxAcc = findAccountByCode('1200');
      const discountReceivedAcc = findAccountByCode('4400');

      // Debit: Purchase account
      lines.push({
        accountId: purchAcc.id,
        accountName: purchAcc.name,
        accountCode: purchAcc.code,
        debit: amount,
        credit: 0,
      });

      // Debit: Input Tax (if any)
      if (tax > 0) {
        lines.push({
          accountId: inputTaxAcc?.id || '',
          accountName: inputTaxAcc?.name || t.inputTax,
          accountCode: inputTaxAcc?.code || '1200',
          debit: tax,
          credit: 0,
        });
      }

      // Credit: Discount Received (if any)
      if (discount > 0) {
        lines.push({
          accountId: discountReceivedAcc?.id || '',
          accountName: discountReceivedAcc?.name || t.discountReceived,
          accountCode: discountReceivedAcc?.code || '4400',
          debit: 0,
          credit: discount,
        });
      }

      // Credit: Payment side
      const totalPaid = amount + tax - discount;
      if (purchasePaymentMethod === 'CASH') {
        const cashAcc = findAccountByCode('1000');
        lines.push({
          accountId: cashAcc?.id || '',
          accountName: cashAcc?.name || t.cashLabel,
          accountCode: cashAcc?.code || '1000',
          debit: 0,
          credit: totalPaid,
        });
      } else if (purchasePaymentMethod === 'CREDIT') {
        const suppliersAcc = findLocalSuppliersAccount();
        lines.push({
          accountId: suppliersAcc?.id || '',
          accountName: suppliersAcc?.name || t.suppliersAccount,
          accountCode: suppliersAcc?.code || '2001',
          debit: 0,
          credit: totalPaid,
        });
      } else {
        const bankAcc = findLeafBankAccount();
        lines.push({
          accountId: bankAcc?.id || '',
          accountName: bankAcc?.name || t.bankLabel,
          accountCode: bankAcc?.code || '1011',
          debit: 0,
          credit: totalPaid,
        });
      }
    }

    if (activeTab === 'settlement') {
      const amount = parseFloat(settlementAmount) || 0;
      if (amount <= 0) return lines;

      if (settlementDirection === 'COLLECTION') {
        const receivingAcc =
          settlementPaymentMethod === 'CASH'
            ? findAccountByCode('1000')
            : findLeafBankAccount();
        const customersAcc = findPlatformCustomersAccount();
        lines.push(
          {
            accountId: receivingAcc?.id || '',
            accountName: receivingAcc?.name || (settlementPaymentMethod === 'CASH' ? t.cashLabel : t.bankLabel),
            accountCode: receivingAcc?.code || (settlementPaymentMethod === 'CASH' ? '1000' : '1011'),
            debit: amount,
            credit: 0,
          },
          {
            accountId: customersAcc?.id || '',
            accountName: customersAcc?.name || t.customers,
            accountCode: customersAcc?.code || '1102',
            debit: 0,
            credit: amount,
          }
        );
      } else {
        const payableAcc = accounts.find((a) => a.id === settlementPayableAccountId);
        const payingAcc =
          settlementPaymentMethod === 'CASH'
            ? findAccountByCode('1000')
            : findLeafBankAccount();
        lines.push(
          {
            accountId: payableAcc?.id || '',
            accountName: payableAcc?.name || t.creditorAccount,
            accountCode: payableAcc?.code || '',
            debit: amount,
            credit: 0,
          },
          {
            accountId: payingAcc?.id || '',
            accountName: payingAcc?.name || (settlementPaymentMethod === 'CASH' ? t.cashLabel : t.bankLabel),
            accountCode: payingAcc?.code || (settlementPaymentMethod === 'CASH' ? '1000' : '1011'),
            debit: 0,
            credit: amount,
          }
        );
      }
    }

    if (activeTab === 'transfer') {
      const amount = parseFloat(transferAmount) || 0;
      if (amount <= 0) return lines;

      if (transferSubType === 'DEPOSIT') {
        // Deposit cash into bank: Debit Bank, Credit Cash
        const bankAcc = accounts.find((a) => a.id === transferBankAccountId) || findLeafBankAccount();
        const cashAcc = findAccountByCode('1000');
        lines.push(
          {
            accountId: bankAcc?.id || '',
            accountName: bankAcc?.name || t.bankLabel,
            accountCode: bankAcc?.code || '1011',
            debit: amount,
            credit: 0,
          },
          {
            accountId: cashAcc?.id || '',
            accountName: cashAcc?.name || t.cashLabel,
            accountCode: cashAcc?.code || '1000',
            debit: 0,
            credit: amount,
          }
        );
      } else if (transferSubType === 'WITHDRAWAL') {
        // Withdrawal: Debit personal withdrawal (3001), Credit Cash or Bank
        const withdrawalAcc = findAccountByCode('3001');
        let fromAcc: Account | undefined;
        if (transferWithdrawalPaymentMethod === 'CASH') {
          fromAcc = findAccountByCode('1000');
        } else if (transferWithdrawalPaymentMethod === 'BANK_TRANSFER') {
          fromAcc = findLeafBankAccount();
        } else {
          // SADAD
          fromAcc = findLeafBankAccount();
        }
        lines.push(
          {
            accountId: withdrawalAcc?.id || '',
            accountName: withdrawalAcc?.name || t.personalWithdrawal,
            accountCode: withdrawalAcc?.code || '3001',
            debit: amount,
            credit: 0,
          },
          {
            accountId: fromAcc?.id || '',
            accountName: fromAcc?.name || t.cashLabel,
            accountCode: fromAcc?.code || '1000',
            debit: 0,
            credit: amount,
          }
        );
      } else {
        // Transfer between accounts: Debit To, Credit From
        const toAcc = accounts.find((a) => a.id === transferToAccountId);
        const fromAcc = accounts.find((a) => a.id === transferFromAccountId);
        if (!toAcc || !fromAcc) return lines;
        lines.push(
          {
            accountId: toAcc.id,
            accountName: toAcc.name,
            accountCode: toAcc.code,
            debit: amount,
            credit: 0,
          },
          {
            accountId: fromAcc.id,
            accountName: fromAcc.name,
            accountCode: fromAcc.code,
            debit: 0,
            credit: amount,
          }
        );
      }
    }

    return lines;
  }, [
    activeTab, accounts, t,
    saleSubType, saleAmount, saleBranch, salePaymentMethod, saleApplyTax, saleDiscount,
    expenseAccountId, expenseAmount, expensePaymentMethod, expenseApplyTax, expenseDiscount,
    purchaseAccountId, purchaseAmount, purchasePaymentMethod, purchaseApplyTax, purchaseDiscount,
    settlementDirection, settlementPayableAccountId, settlementAmount, settlementPaymentMethod,
    transferSubType, transferAmount, transferBankAccountId, transferFromAccountId, transferToAccountId, transferWithdrawalPaymentMethod,
    saleTaxAmount, expenseTaxAmount, purchaseTaxAmount,
  ]);

  const previewLines = getPreviewLines();
  const totalDebit = previewLines.reduce((s, l) => s + l.debit, 0);
  const totalCredit = previewLines.reduce((s, l) => s + l.credit, 0);
  const isBalanced = Math.abs(totalDebit - totalCredit) < 0.01 && totalDebit > 0;

  // ────────────────────────────────────────────
  // VALIDATION
  // ────────────────────────────────────────────

  function validate(): string | null {
    if (!transactionDate) return t.valEnterDate;

    if (activeTab === 'sales') {
      const amount = parseFloat(saleAmount);
      if (!saleAmount || isNaN(amount) || amount <= 0) return t.valEnterValidAmount;
      if (saleSubType === 'BANK' && !salePaymentMethod) return t.valSelectPaymentMethod;
      if (saleSubType === 'PLATFORM' && !saleCustomerId) return t.valSelectCustomer;
      if (saleSubType === 'PLATFORM' && !saleInvoiceNumber.trim()) return t.valEnterInvoiceNumber;
      if (saleDiscountAmount > amount) return t.valDiscountExceedsAmount;
    }
    if (activeTab === 'expenses') {
      const amount = parseFloat(expenseAmount);
      if (!expenseAccountId) return t.valSelectExpenseAccount;
      if (!expenseAmount || isNaN(amount) || amount <= 0) return t.valEnterValidAmount;
      if (expenseDiscountAmount > amount) return t.valDiscountExceedsAmount;
    }
    if (activeTab === 'purchases') {
      const amount = parseFloat(purchaseAmount);
      if (!purchaseAccountId) return t.valSelectPurchaseAccount;
      if (!purchaseAmount || isNaN(amount) || amount <= 0) return t.valEnterValidAmount;
      if (purchasePaymentMethod === 'CREDIT' && !purchaseSupplierId) return t.valSelectSupplier;
      if (purchaseDiscountAmount > amount) return t.valDiscountExceedsAmount;
    }
    if (activeTab === 'settlement') {
      const amount = parseFloat(settlementAmount);
      if (!settlementAmount || isNaN(amount) || amount <= 0) return t.valEnterValidAmount;
      if (settlementDirection === 'COLLECTION' && !settlementCustomerId) return t.valSelectCustomer;
      if (settlementDirection === 'PAYMENT' && !settlementPayableAccountId) return t.valSelectPayableAccount;
      // Only require supplier if the payable account is the suppliers account (code starts with '20')
      if (settlementDirection === 'PAYMENT' && !settlementSupplierId) {
        const payableAcc = accounts.find((a) => a.id === settlementPayableAccountId);
        if (!payableAcc || payableAcc.code.startsWith('20')) {
          return t.valSelectSupplier;
        }
      }
    }
    if (activeTab === 'transfer') {
      const amount = parseFloat(transferAmount);
      if (!transferAmount || isNaN(amount) || amount <= 0) return t.valEnterValidAmount;
      if (transferSubType === 'DEPOSIT' && !transferBankAccountId) return t.valSelectBankAccount;
      if (transferSubType === 'TRANSFER') {
        if (!transferFromAccountId) return t.valSelectSourceAccount;
        if (!transferToAccountId) return t.valSelectDestinationAccount;
        if (transferFromAccountId === transferToAccountId) return t.valCannotTransferSameAccount;
      }
    }
    return null;
  }

  // ────────────────────────────────────────────
  // SAVE
  // ────────────────────────────────────────────

  async function handleSave() {
    const validationError = validate();
    if (validationError) {
      toast.error(validationError);
      return;
    }

    if (!isBalanced) {
      toast.error(t.entryUnbalancedMsg);
      return;
    }

    setSaving(true);

    try {
      let payload: any = {};
      const dateStr = new Date(transactionDate + 'T00:00:00').toISOString();

      if (activeTab === 'sales') {
        const amount = parseFloat(saleAmount);
        let type: JournalEntryType;
        let paymentMethod: PaymentMethod | undefined;

        if (saleSubType === 'CASH') {
          type = 'SALE_CASH';
        } else if (saleSubType === 'BANK') {
          type = 'SALE_BANK';
          paymentMethod = salePaymentMethod;
        } else {
          type = 'SALE_PLATFORM';
          paymentMethod = 'CREDIT';
        }

        payload = {
          type,
          date: dateStr,
          description: saleDescription || (saleSubType === 'CASH' ? t.saleCash : saleSubType === 'BANK' ? t.saleBank : t.salePlatform),
          amount,
          branch: saleBranch,
          paymentMethod,
          counterParty: saleSubType === 'PLATFORM' ? customers.find(c => c.id === saleCustomerId)?.name : undefined,
          invoiceNumber: saleSubType === 'PLATFORM' ? saleInvoiceNumber : undefined,
          applyTax: saleApplyTax,
          taxAmount: saleTaxAmount,
          discountAmount: saleDiscountAmount,
          customerId: saleSubType === 'PLATFORM' ? saleCustomerId : undefined,
        };
      }

      if (activeTab === 'expenses') {
        const amount = parseFloat(expenseAmount);
        let type: JournalEntryType;
        let paymentMethod: PaymentMethod;

        if (expensePaymentMethod === 'CASH') {
          type = 'EXPENSE_CASH';
          paymentMethod = 'CASH';
        } else if (expensePaymentMethod === 'SADAD') {
          type = 'EXPENSE_SADAD';
          paymentMethod = 'SADAD';
        } else {
          type = 'EXPENSE_BANK';
          paymentMethod = expensePaymentMethod === 'CARD' ? 'MADA' : 'TRANSFER';
        }

        payload = {
          type,
          date: dateStr,
          description: expenseDescription || t.expenseType,
          amount,
          targetAccountId: expenseAccountId,
          paymentMethod,
          applyTax: expenseApplyTax,
          taxAmount: expenseTaxAmount,
          discountAmount: expenseDiscountAmount,
          supplierId: expenseSupplierId || undefined,
        };
      }

      if (activeTab === 'purchases') {
        const amount = parseFloat(purchaseAmount);
        let type: JournalEntryType;
        let paymentMethod: PaymentMethod;

        if (purchasePaymentMethod === 'CASH') {
          type = 'PURCHASE_CASH';
          paymentMethod = 'CASH';
        } else if (purchasePaymentMethod === 'CREDIT') {
          type = 'PURCHASE_CREDIT';
          paymentMethod = 'CREDIT';
        } else {
          type = 'PURCHASE_BANK';
          paymentMethod = purchasePaymentMethod === 'CARD' ? 'MADA' : 'TRANSFER';
        }

        payload = {
          type,
          date: dateStr,
          description: purchaseDescription || t.purchase,
          amount,
          targetAccountId: purchaseAccountId,
          paymentMethod,
          counterParty: purchasePaymentMethod === 'CREDIT' ? suppliers.find(s => s.id === purchaseSupplierId)?.name : undefined,
          applyTax: purchaseApplyTax,
          taxAmount: purchaseTaxAmount,
          discountAmount: purchaseDiscountAmount,
          supplierId: purchasePaymentMethod === 'CREDIT' ? purchaseSupplierId : (purchaseSupplierId || undefined),
        };
      }

      if (activeTab === 'settlement') {
        const amount = parseFloat(settlementAmount);

        if (settlementDirection === 'COLLECTION') {
          const selectedCustomer = customers.find(c => c.id === settlementCustomerId);
          payload = {
            type: 'COLLECTION',
            date: dateStr,
            description: `${t.collectionFrom} ${selectedCustomer?.name || ''}`,
            amount,
            paymentMethod: settlementPaymentMethod === 'CASH' ? 'CASH' : 'TRANSFER',
            counterParty: selectedCustomer?.name,
            invoiceNumber: settlementInvoiceNumber || undefined,
            customerId: settlementCustomerId,
          };
        } else {
          const payableAcc = accounts.find((a) => a.id === settlementPayableAccountId);
          const selectedSupplier = suppliers.find(s => s.id === settlementSupplierId);
          // Only include supplier info when the payable account is supplier-related
          const isSupplierAccount = !payableAcc || payableAcc.code.startsWith('20');
          payload = {
            type: 'PAYMENT',
            date: dateStr,
            description: isSupplierAccount
              ? `${t.paymentFor} ${payableAcc?.name || ''} - ${selectedSupplier?.name || ''}`
              : `${t.paymentFor} ${payableAcc?.name || ''}`,
            amount,
            targetAccountId: settlementPayableAccountId,
            paymentMethod: settlementPaymentMethod === 'CASH' ? 'CASH' : 'TRANSFER',
            counterParty: isSupplierAccount ? selectedSupplier?.name : undefined,
            supplierId: isSupplierAccount ? settlementSupplierId || undefined : undefined,
          };
        }
      }

      if (activeTab === 'transfer') {
        const amount = parseFloat(transferAmount);
        const cashAcc = findAccountByCode('1000');

        if (transferSubType === 'DEPOSIT') {
          payload = {
            type: 'DEPOSIT',
            date: dateStr,
            description: transferDescription || t.depositInBank,
            amount,
            fromAccountId: cashAcc?.id || '',
            toAccountId: transferBankAccountId,
          };
        } else if (transferSubType === 'WITHDRAWAL') {
          let fromAccId = '';
          if (transferWithdrawalPaymentMethod === 'CASH') {
            fromAccId = cashAcc?.id || '';
          } else {
            fromAccId = findLeafBankAccount()?.id || '';
          }
          payload = {
            type: 'WITHDRAWAL',
            date: dateStr,
            description: transferDescription || t.personalWithdrawal,
            amount,
            fromAccountId: fromAccId,
          };
        } else {
          payload = {
            type: 'TRANSFER',
            date: dateStr,
            description: transferDescription || t.transferBetweenAccounts,
            amount,
            fromAccountId: transferFromAccountId,
            toAccountId: transferToAccountId,
          };
        }
      }

      const res = await fetch('/api/journal-entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || t.errorSavingEntry);
      }

      toast.success(t.entrySavedSuccess);
      clearForm();
    } catch (err: any) {
      toast.error(err.message || t.errorSavingEntry);
    } finally {
      setSaving(false);
    }
  }

  // ────────────────────────────────────────────
  // CLEAR FORM
  // ────────────────────────────────────────────

  function clearForm() {
    setTransactionDate(getTodayDate());
    // Sale
    setSaleAmount('');
    setSaleBranch('CHINA_TOWN');
    setSalePaymentMethod('MADA');
    setSaleCustomerId('');
    setSaleInvoiceNumber('');
    setSaleDescription('');
    setSaleApplyTax(false);
    setSaleDiscount('');
    // Expense
    setExpenseAccountId('');
    setExpenseAmount('');
    setExpensePaymentMethod('CASH');
    setExpenseDescription('');
    setExpenseApplyTax(false);
    setExpenseDiscount('');
    setExpenseSupplierId('');
    // Purchase
    setPurchaseAccountId('');
    setPurchaseAmount('');
    setPurchasePaymentMethod('CASH');
    setPurchaseSupplierId('');
    setPurchaseDescription('');
    setPurchaseApplyTax(false);
    setPurchaseDiscount('');
    // Settlement
    setSettlementPayableAccountId('');
    setSettlementAmount('');
    setSettlementPaymentMethod('CASH');
    setSettlementCustomerId('');
    setSettlementInvoiceNumber('');
    setSettlementSupplierId('');
    // Transfer
    setTransferAmount('');
    setTransferFromAccountId('');
    setTransferToAccountId('');
    setTransferBankAccountId('');
    setTransferWithdrawalPaymentMethod('CASH');
    setTransferDescription('');
  }

  // ────────────────────────────────────────────
  // RENDER: Date Field
  // ────────────────────────────────────────────

  function renderDateField() {
    return (
      <div className="space-y-2">
        <Label htmlFor="transaction-date" className="text-sm font-medium">
          {t.date}
        </Label>
        <Input
          id="transaction-date"
          type="date"
          value={transactionDate}
          onChange={(e) => setTransactionDate(e.target.value)}
          dir="ltr"
          className="w-full sm:w-48"
        />
      </div>
    );
  }

  // ────────────────────────────────────────────
  // RENDER: Tax & Discount Row
  // ────────────────────────────────────────────

  function renderTaxDiscount(
    applyTax: boolean,
    setApplyTax: (v: boolean) => void,
    taxAmount: number,
    discount: string,
    setDiscount: (v: string) => void,
    discountLabel: string = t.discount
  ) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
        <div className="flex items-center gap-3 pb-2">
          <Checkbox
            id="apply-tax"
            checked={applyTax}
            onCheckedChange={(checked) => setApplyTax(checked === true)}
          />
          <Label htmlFor="apply-tax" className="text-sm font-medium flex items-center gap-1.5 cursor-pointer">
            <Percent className="size-3.5" />
            {t.tax15}
          </Label>
          {applyTax && taxAmount > 0 && (
            <Badge variant="secondary" className="text-xs font-mono">
              <CurrencyAmount amount={taxAmount} symbolClassName="w-3.5 h-3.5" />
            </Badge>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="discount-amount" className="text-sm font-medium">
            {discountLabel}
          </Label>
          <Input
            id="discount-amount"
            type="number"
            min="0"
            step="0.01"
            placeholder="0.00"
            value={discount}
            onChange={(e) => setDiscount(e.target.value)}
            className="text-left font-mono"
            dir="ltr"
          />
        </div>
        <div />
      </div>
    );
  }

  // ────────────────────────────────────────────
  // RENDER: Sale Sub-Type Cards
  // ────────────────────────────────────────────

  function renderSaleSubTypeCards() {
    const subTypes: { key: SaleSubType; label: string; icon: React.ElementType }[] = [
      { key: 'CASH', label: t.saleCash, icon: ShoppingCart },
      { key: 'BANK', label: t.saleBank, icon: CreditCard },
      { key: 'PLATFORM', label: t.salePlatform, icon: Receipt },
    ];

    return (
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        {subTypes.map((st) => {
          const isSelected = saleSubType === st.key;
          const Icon = st.icon;
          return (
            <button
              key={st.key}
              type="button"
              onClick={() => setSaleSubType(st.key)}
              className={`relative flex flex-col items-center gap-2 rounded-xl border-2 p-4 transition-all duration-200 cursor-pointer ${
                isSelected
                  ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30 shadow-md'
                  : 'border-border hover:border-emerald-300 dark:hover:border-emerald-700'
              }`}
            >
              {isSelected && (
                <div className="absolute top-2 left-2">
                  <CheckCircle2 className="size-4 text-emerald-600" />
                </div>
              )}
              <Icon className={`size-6 ${isSelected ? 'text-emerald-600' : 'text-muted-foreground'}`} />
              <span className={`text-sm font-medium ${isSelected ? 'text-emerald-700 dark:text-emerald-400' : 'text-muted-foreground'}`}>
                {st.label}
              </span>
            </button>
          );
        })}
      </div>
    );
  }

  // ────────────────────────────────────────────
  // RENDER: Sales Form
  // ────────────────────────────────────────────

  function renderSalesForm() {
    return (
      <div className="space-y-5">
        {/* Date */}
        {renderDateField()}

        {/* Sub-type Cards */}
        {renderSaleSubTypeCards()}

        {/* Main Fields */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Amount */}
          <div className="space-y-2">
            <Label htmlFor="sale-amount" className="text-sm font-medium">
              {t.amount}
            </Label>
            <Input
              id="sale-amount"
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={saleAmount}
              onChange={(e) => setSaleAmount(e.target.value)}
              className="text-left font-mono"
              dir="ltr"
            />
          </div>

          {/* Branch - for CASH and BANK — must select a specific branch */}
          {(saleSubType === 'CASH' || saleSubType === 'BANK') && (
            <div className="space-y-2">
              <Label className="text-sm font-medium">{t.branch} *</Label>
              <Select value={saleBranch} onValueChange={(v) => setSaleBranch(v as Branch)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CHINA_TOWN">{getBranchLabel('CHINA_TOWN')}</SelectItem>
                  <SelectItem value="PALACE_INDIA">{getBranchLabel('PALACE_INDIA')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Payment Method - for BANK */}
          {saleSubType === 'BANK' && (
            <div className="space-y-2">
              <Label className="text-sm font-medium">{t.paymentMethod}</Label>
              <Select value={salePaymentMethod} onValueChange={(v) => setSalePaymentMethod(v as PaymentMethod)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="MADA">{getPaymentMethodLabel('MADA')}</SelectItem>
                  <SelectItem value="VISA">{getPaymentMethodLabel('VISA')}</SelectItem>
                  <SelectItem value="MASTERCARD">{getPaymentMethodLabel('MASTERCARD')}</SelectItem>
                  <SelectItem value="OTHER_CARD">{getPaymentMethodLabel('OTHER_CARD')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Customer Dropdown - for PLATFORM */}
          {saleSubType === 'PLATFORM' && (
            <div className="space-y-2">
              <Label className="text-sm font-medium">{t.customer}</Label>
              <Select value={saleCustomerId} onValueChange={setSaleCustomerId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t.selectCustomer} />
                </SelectTrigger>
                <SelectContent>
                  {customers.filter(c => c.isActive).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Invoice Number - for PLATFORM */}
          {saleSubType === 'PLATFORM' && (
            <div className="space-y-2">
              <Label htmlFor="sale-invoice" className="text-sm font-medium">
                {t.invoiceNumber}
              </Label>
              <Input
                id="sale-invoice"
                type="text"
                placeholder={t.invoiceNumber}
                value={saleInvoiceNumber}
                onChange={(e) => setSaleInvoiceNumber(e.target.value)}
              />
            </div>
          )}
        </div>

        {/* Tax & Discount */}
        <Separator />
        {renderTaxDiscount(saleApplyTax, setSaleApplyTax, saleTaxAmount, saleDiscount, setSaleDiscount, t.discountAllowed)}

        {/* Summary when tax/discount active */}
        {(saleApplyTax || saleDiscountAmount > 0) && (
          <div className="bg-emerald-50 dark:bg-emerald-950/20 rounded-lg p-3 space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t.baseAmount}</span>
              <span className="font-mono"><CurrencyAmount amount={parseFloat(saleAmount) || 0} symbolClassName="w-3.5 h-3.5" /></span>
            </div>
            {saleApplyTax && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t.tax15Label}</span>
                <span className="font-mono text-amber-600"><CurrencyAmount amount={saleTaxAmount} symbolClassName="w-3.5 h-3.5" /></span>
              </div>
            )}
            {saleDiscountAmount > 0 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t.discountLabel}</span>
                <span className="font-mono text-red-500">(<CurrencyAmount amount={saleDiscountAmount} symbolClassName="w-3.5 h-3.5" />)</span>
              </div>
            )}
            <Separator />
            <div className="flex justify-between font-bold">
              <span>{t.totalReceived}</span>
              <span className="font-mono text-emerald-700">
                <CurrencyAmount amount={(parseFloat(saleAmount) || 0) + saleTaxAmount - saleDiscountAmount} symbolClassName="w-3.5 h-3.5" />
              </span>
            </div>
          </div>
        )}

        {/* Description */}
        <div className="space-y-2">
          <Label htmlFor="sale-desc" className="text-sm font-medium">
            {t.description}
          </Label>
          <Textarea
            id="sale-desc"
            placeholder={t.transactionDescOptional}
            value={saleDescription}
            onChange={(e) => setSaleDescription(e.target.value)}
            rows={2}
          />
        </div>
      </div>
    );
  }

  // ────────────────────────────────────────────
  // RENDER: Expense Form
  // ────────────────────────────────────────────

  function renderExpenseForm() {
    return (
      <div className="space-y-5">
        {/* Date */}
        {renderDateField()}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Expense Account */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">{t.expenseAccount}</Label>
            <Select value={expenseAccountId} onValueChange={setExpenseAccountId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t.selectExpenseAccount} />
              </SelectTrigger>
              <SelectContent>
                {expenseAccounts.map((acc) => (
                  <SelectItem key={acc.id} value={acc.id}>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="inline-flex items-center px-1 py-0 rounded text-[9px] font-mono font-medium bg-muted text-muted-foreground" dir="ltr">{acc.code}</span>
                      <span>{acc.name}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Amount */}
          <div className="space-y-2">
            <Label htmlFor="expense-amount" className="text-sm font-medium">
              {t.amount}
            </Label>
            <Input
              id="expense-amount"
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={expenseAmount}
              onChange={(e) => setExpenseAmount(e.target.value)}
              className="text-left font-mono"
              dir="ltr"
            />
          </div>

          {/* Payment Method */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">{t.paymentMethod}</Label>
            <Select value={expensePaymentMethod} onValueChange={(v) => setExpensePaymentMethod(v as ExpensePaymentMethod)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="CASH">{t.cashSub}</SelectItem>
                <SelectItem value="SADAD">{t.bankSadad}</SelectItem>
                <SelectItem value="CARD">{t.bankCard}</SelectItem>
                <SelectItem value="TRANSFER">{t.bankTransfer}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Supplier (optional) */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">{t.supplierOptional}</Label>
            <Select value={expenseSupplierId} onValueChange={setExpenseSupplierId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t.selectSupplier} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">{t.noSupplier}</SelectItem>
                {suppliers.filter(s => s.isActive).map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Tax & Discount */}
        <Separator />
        {renderTaxDiscount(expenseApplyTax, setExpenseApplyTax, expenseTaxAmount, expenseDiscount, setExpenseDiscount, t.discountReceived)}

        {/* Summary */}
        {(expenseApplyTax || expenseDiscountAmount > 0) && (
          <div className="bg-red-50 dark:bg-red-950/20 rounded-lg p-3 space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t.baseAmount}</span>
              <span className="font-mono"><CurrencyAmount amount={parseFloat(expenseAmount) || 0} symbolClassName="w-3.5 h-3.5" /></span>
            </div>
            {expenseApplyTax && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t.tax15Label}</span>
                <span className="font-mono text-amber-600"><CurrencyAmount amount={expenseTaxAmount} symbolClassName="w-3.5 h-3.5" /></span>
              </div>
            )}
            {expenseDiscountAmount > 0 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t.discountReceivedLabel}</span>
                <span className="font-mono text-emerald-600">(<CurrencyAmount amount={expenseDiscountAmount} symbolClassName="w-3.5 h-3.5" />)</span>
              </div>
            )}
            <Separator />
            <div className="flex justify-between font-bold">
              <span>{t.totalPaid}</span>
              <span className="font-mono text-red-700">
                <CurrencyAmount amount={(parseFloat(expenseAmount) || 0) + expenseTaxAmount - expenseDiscountAmount} symbolClassName="w-3.5 h-3.5" />
              </span>
            </div>
          </div>
        )}

        {/* Description */}
        <div className="space-y-2">
          <Label htmlFor="expense-desc" className="text-sm font-medium">
            {t.description}
          </Label>
          <Textarea
            id="expense-desc"
            placeholder={t.expenseDescOptional}
            value={expenseDescription}
            onChange={(e) => setExpenseDescription(e.target.value)}
            rows={2}
          />
        </div>
      </div>
    );
  }

  // ────────────────────────────────────────────
  // RENDER: Purchase Form
  // ────────────────────────────────────────────

  function renderPurchaseForm() {
    return (
      <div className="space-y-5">
        {/* Date */}
        {renderDateField()}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Purchase Account */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">{t.purchaseAccount}</Label>
            <Select value={purchaseAccountId} onValueChange={setPurchaseAccountId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t.selectPurchaseAccount} />
              </SelectTrigger>
              <SelectContent>
                {purchaseAccounts.map((acc) => (
                  <SelectItem key={acc.id} value={acc.id}>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="inline-flex items-center px-1 py-0 rounded text-[9px] font-mono font-medium bg-muted text-muted-foreground" dir="ltr">{acc.code}</span>
                      <span>{acc.name}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Amount */}
          <div className="space-y-2">
            <Label htmlFor="purchase-amount" className="text-sm font-medium">
              {t.amount}
            </Label>
            <Input
              id="purchase-amount"
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={purchaseAmount}
              onChange={(e) => setPurchaseAmount(e.target.value)}
              className="text-left font-mono"
              dir="ltr"
            />
          </div>

          {/* Payment Method */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">{t.paymentMethod}</Label>
            <Select value={purchasePaymentMethod} onValueChange={(v) => setPurchasePaymentMethod(v as PurchasePaymentMethod)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="CASH">{t.cashSub}</SelectItem>
                <SelectItem value="TRANSFER">{t.bankTransfer}</SelectItem>
                <SelectItem value="CARD">{t.bankCard}</SelectItem>
                <SelectItem value="CREDIT">{t.creditSub}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Supplier Dropdown */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">
              {t.supplier} {purchasePaymentMethod === 'CREDIT' && <span className="text-red-500">*</span>}
            </Label>
            <Select value={purchaseSupplierId} onValueChange={setPurchaseSupplierId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t.selectSupplier} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">{t.noSupplier}</SelectItem>
                {suppliers.filter(s => s.isActive).map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Tax & Discount */}
        <Separator />
        {renderTaxDiscount(purchaseApplyTax, setPurchaseApplyTax, purchaseTaxAmount, purchaseDiscount, setPurchaseDiscount, t.discountReceived)}

        {/* Summary */}
        {(purchaseApplyTax || purchaseDiscountAmount > 0) && (
          <div className="bg-amber-50 dark:bg-amber-950/20 rounded-lg p-3 space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t.baseAmount}</span>
              <span className="font-mono"><CurrencyAmount amount={parseFloat(purchaseAmount) || 0} symbolClassName="w-3.5 h-3.5" /></span>
            </div>
            {purchaseApplyTax && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t.tax15Label}</span>
                <span className="font-mono text-amber-600"><CurrencyAmount amount={purchaseTaxAmount} symbolClassName="w-3.5 h-3.5" /></span>
              </div>
            )}
            {purchaseDiscountAmount > 0 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t.discountReceivedLabel}</span>
                <span className="font-mono text-emerald-600">(<CurrencyAmount amount={purchaseDiscountAmount} symbolClassName="w-3.5 h-3.5" />)</span>
              </div>
            )}
            <Separator />
            <div className="flex justify-between font-bold">
              <span>{t.totalPaid}</span>
              <span className="font-mono text-amber-700">
                <CurrencyAmount amount={(parseFloat(purchaseAmount) || 0) + purchaseTaxAmount - purchaseDiscountAmount} symbolClassName="w-3.5 h-3.5" />
              </span>
            </div>
          </div>
        )}

        {/* Description */}
        <div className="space-y-2">
          <Label htmlFor="purchase-desc" className="text-sm font-medium">
            {t.description}
          </Label>
          <Textarea
            id="purchase-desc"
            placeholder={t.purchaseDescOptional}
            value={purchaseDescription}
            onChange={(e) => setPurchaseDescription(e.target.value)}
            rows={2}
          />
        </div>
      </div>
    );
  }

  // ────────────────────────────────────────────
  // RENDER: Settlement Form
  // ────────────────────────────────────────────

  function renderSettlementForm() {
    return (
      <div className="space-y-6">
        {/* Date */}
        {renderDateField()}

        {/* Direction Selector */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setSettlementDirection('COLLECTION')}
            className={`flex items-center justify-center gap-2 rounded-xl border-2 p-4 transition-all duration-200 cursor-pointer ${
              settlementDirection === 'COLLECTION'
                ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30 shadow-md'
                : 'border-border hover:border-blue-300 dark:hover:border-blue-700'
            }`}
          >
            <ArrowRightLeft className={`size-5 ${settlementDirection === 'COLLECTION' ? 'text-blue-600' : 'text-muted-foreground'}`} />
            <span className={`text-sm font-medium ${settlementDirection === 'COLLECTION' ? 'text-blue-700 dark:text-blue-400' : 'text-muted-foreground'}`}>
              {t.collectionType}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setSettlementDirection('PAYMENT')}
            className={`flex items-center justify-center gap-2 rounded-xl border-2 p-4 transition-all duration-200 cursor-pointer ${
              settlementDirection === 'PAYMENT'
                ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30 shadow-md'
                : 'border-border hover:border-blue-300 dark:hover:border-blue-700'
            }`}
          >
            <ArrowUpDown className={`size-5 ${settlementDirection === 'PAYMENT' ? 'text-blue-600' : 'text-muted-foreground'}`} />
            <span className={`text-sm font-medium ${settlementDirection === 'PAYMENT' ? 'text-blue-700 dark:text-blue-400' : 'text-muted-foreground'}`}>
              {t.paymentType}
            </span>
          </button>
        </div>

        <Separator />

        {/* Collection Form */}
        {settlementDirection === 'COLLECTION' && (
          <div className="space-y-4">
            <h4 className="text-sm font-semibold text-blue-700 dark:text-blue-400">{t.collectionFromCustomers}</h4>

            {/* Customer balance info */}
            {settlementCustomerId && (() => {
              const sel = customers.find(c => c.id === settlementCustomerId);
              if (!sel) return null;
              return (
                <div className={`flex items-center justify-between p-3 rounded-lg border ${
                  sel.balance > 0
                    ? 'bg-orange-50 border-orange-200 dark:bg-orange-950/20 dark:border-orange-800'
                    : 'bg-emerald-50 border-emerald-200 dark:bg-emerald-950/20 dark:border-emerald-800'
                }`}>
                  <span className="text-sm font-medium">{sel.name}</span>
                  <span className={`text-sm font-bold ${sel.balance > 0 ? 'text-orange-600 dark:text-orange-400' : 'text-emerald-600 dark:text-emerald-400'}`} dir="ltr">
                    {sel.balance > 0 ? <>{t.due} <CurrencyAmount amount={sel.balance} symbolClassName="w-3.5 h-3.5" /></> : t.noDues}
                  </span>
                </div>
              );
            })()}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-sm font-medium">{t.customer}</Label>
                <Select value={settlementCustomerId} onValueChange={setSettlementCustomerId}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={t.selectCustomer} />
                  </SelectTrigger>
                  <SelectContent>
                    {customers.filter(c => c.isActive).map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        <span className="flex items-center gap-2">
                          <span>{c.name}</span>
                          {c.balance > 0 && (
                            <span className="text-xs text-orange-600 dark:text-orange-400 font-mono" dir="ltr">
                              (<CurrencyAmount amount={c.balance} symbolClassName="w-3 h-3" />)
                            </span>
                          )}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="coll-amount" className="text-sm font-medium">{t.amount}</Label>
                  {settlementCustomerId && (() => {
                    const sel = customers.find(c => c.id === settlementCustomerId);
                    if (sel && sel.balance > 0) {
                      return (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-xs text-orange-600 hover:text-orange-700 hover:bg-orange-50 dark:text-orange-400 dark:hover:bg-orange-950/30"
                          onClick={() => setSettlementAmount(String(sel.balance))}
                        >
                          {t.fullPayment}
                        </Button>
                      );
                    }
                    return null;
                  })()}
                </div>
                <Input
                  id="coll-amount"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={settlementAmount}
                  onChange={(e) => setSettlementAmount(e.target.value)}
                  className="text-left font-mono"
                  dir="ltr"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-medium">{t.receivingMethod}</Label>
                <Select value={settlementPaymentMethod} onValueChange={(v) => setSettlementPaymentMethod(v as SettlementPaymentMethod)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CASH">{t.cashSub}</SelectItem>
                    <SelectItem value="BANK">{t.bankSub}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="coll-invoice" className="text-sm font-medium">{t.invoiceNumber}</Label>
                <Input
                  id="coll-invoice"
                  type="text"
                  placeholder={t.invoiceNumberOptional}
                  value={settlementInvoiceNumber}
                  onChange={(e) => setSettlementInvoiceNumber(e.target.value)}
                />
              </div>
            </div>
          </div>
        )}

        {/* Payment Form */}
        {settlementDirection === 'PAYMENT' && (
          <div className="space-y-4">
            <h4 className="text-sm font-semibold text-blue-700 dark:text-blue-400">
              {showSupplierInSettlement ? t.paymentToSuppliers : t.paymentType}
            </h4>

            {/* Supplier balance info - only shown when supplier dropdown is visible */}
            {showSupplierInSettlement && settlementSupplierId && (() => {
              const sel = suppliers.find(s => s.id === settlementSupplierId);
              if (!sel) return null;
              return (
                <div className={`flex items-center justify-between p-3 rounded-lg border ${
                  sel.balance > 0
                    ? 'bg-orange-50 border-orange-200 dark:bg-orange-950/20 dark:border-orange-800'
                    : 'bg-emerald-50 border-emerald-200 dark:bg-emerald-950/20 dark:border-emerald-800'
                }`}>
                  <span className="text-sm font-medium">{sel.name}</span>
                  <span className={`text-sm font-bold ${sel.balance > 0 ? 'text-orange-600 dark:text-orange-400' : 'text-emerald-600 dark:text-emerald-400'}`} dir="ltr">
                    {sel.balance > 0 ? <>{t.due} <CurrencyAmount amount={sel.balance} symbolClassName="w-3.5 h-3.5" /></> : t.noDues}
                  </span>
                </div>
              );
            })()}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-sm font-medium">{t.payableAccount}</Label>
                <Select value={settlementPayableAccountId} onValueChange={setSettlementPayableAccountId}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={t.selectPayableAccount} />
                  </SelectTrigger>
                  <SelectContent>
                    {payableAccounts.map((acc) => (
                      <SelectItem key={acc.id} value={acc.id}>
                        <span className="inline-flex items-center gap-1.5">
                          <span className="inline-flex items-center px-1 py-0 rounded text-[9px] font-mono font-medium bg-muted text-muted-foreground" dir="ltr">{acc.code}</span>
                          <span>{acc.name}</span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {/* Supplier dropdown - only shown when payable account is supplier-related */}
              {showSupplierInSettlement && (
                <div className="space-y-2">
                  <Label className="text-sm font-medium">
                    {t.supplier} <span className="text-red-500">*</span>
                  </Label>
                  <Select value={settlementSupplierId} onValueChange={setSettlementSupplierId}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={t.selectSupplier} />
                    </SelectTrigger>
                    <SelectContent>
                      {suppliers.filter(s => s.isActive).map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          <span className="flex items-center gap-2">
                            <span>{s.name}</span>
                            {s.balance > 0 && (
                              <span className="text-xs text-orange-600 dark:text-orange-400 font-mono" dir="ltr">
                                (<CurrencyAmount amount={s.balance} symbolClassName="w-3 h-3" />)
                              </span>
                            )}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="pay-amount" className="text-sm font-medium">{t.amount}</Label>
                  {showSupplierInSettlement && settlementSupplierId && (() => {
                    const sel = suppliers.find(s => s.id === settlementSupplierId);
                    if (sel && sel.balance > 0) {
                      return (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-xs text-orange-600 hover:text-orange-700 hover:bg-orange-50 dark:text-orange-400 dark:hover:bg-orange-950/30"
                          onClick={() => setSettlementAmount(String(sel.balance))}
                        >
                          {t.fullPayment}
                        </Button>
                      );
                    }
                    return null;
                  })()}
                </div>
                <Input
                  id="pay-amount"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={settlementAmount}
                  onChange={(e) => setSettlementAmount(e.target.value)}
                  className="text-left font-mono"
                  dir="ltr"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-medium">{t.paymentMethodSettlement}</Label>
                <Select value={settlementPaymentMethod} onValueChange={(v) => setSettlementPaymentMethod(v as SettlementPaymentMethod)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CASH">{t.cashSub}</SelectItem>
                    <SelectItem value="BANK">{t.bankSub}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ────────────────────────────────────────────
  // RENDER: Transfer Form (NEW TAB)
  // ────────────────────────────────────────────

  function renderTransferForm() {
    return (
      <div className="space-y-6">
        {/* Date */}
        {renderDateField()}

        {/* Sub-type Selector */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <button
            type="button"
            onClick={() => setTransferSubType('DEPOSIT')}
            className={`flex flex-col items-center gap-2 rounded-xl border-2 p-4 transition-all duration-200 cursor-pointer ${
              transferSubType === 'DEPOSIT'
                ? 'border-purple-500 bg-purple-50 dark:bg-purple-950/30 shadow-md'
                : 'border-border hover:border-purple-300 dark:hover:border-purple-700'
            }`}
          >
            <Landmark className={`size-6 ${transferSubType === 'DEPOSIT' ? 'text-purple-600' : 'text-muted-foreground'}`} />
            <span className={`text-sm font-medium ${transferSubType === 'DEPOSIT' ? 'text-purple-700 dark:text-purple-400' : 'text-muted-foreground'}`}>
              {t.depositType}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setTransferSubType('WITHDRAWAL')}
            className={`flex flex-col items-center gap-2 rounded-xl border-2 p-4 transition-all duration-200 cursor-pointer ${
              transferSubType === 'WITHDRAWAL'
                ? 'border-purple-500 bg-purple-50 dark:bg-purple-950/30 shadow-md'
                : 'border-border hover:border-purple-300 dark:hover:border-purple-700'
            }`}
          >
            <Banknote className={`size-6 ${transferSubType === 'WITHDRAWAL' ? 'text-purple-600' : 'text-muted-foreground'}`} />
            <span className={`text-sm font-medium ${transferSubType === 'WITHDRAWAL' ? 'text-purple-700 dark:text-purple-400' : 'text-muted-foreground'}`}>
              {t.withdrawalType}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setTransferSubType('TRANSFER')}
            className={`flex flex-col items-center gap-2 rounded-xl border-2 p-4 transition-all duration-200 cursor-pointer ${
              transferSubType === 'TRANSFER'
                ? 'border-purple-500 bg-purple-50 dark:bg-purple-950/30 shadow-md'
                : 'border-border hover:border-purple-300 dark:hover:border-purple-700'
            }`}
          >
            <ArrowLeftRight className={`size-6 ${transferSubType === 'TRANSFER' ? 'text-purple-600' : 'text-muted-foreground'}`} />
            <span className={`text-sm font-medium ${transferSubType === 'TRANSFER' ? 'text-purple-700 dark:text-purple-400' : 'text-muted-foreground'}`}>
              {t.transferType}
            </span>
          </button>
        </div>

        <Separator />

        {/* DEPOSIT Form */}
        {transferSubType === 'DEPOSIT' && (
          <div className="space-y-4">
            <h4 className="text-sm font-semibold text-purple-700 dark:text-purple-400">{t.depositInBank}</h4>
            <p className="text-xs text-muted-foreground">{t.debitBankCreditCash}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-sm font-medium">{t.bankAccount}</Label>
                <Select value={transferBankAccountId} onValueChange={setTransferBankAccountId}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={t.selectBankAccount} />
                  </SelectTrigger>
                  <SelectContent>
                    {bankAccounts.map((acc) => (
                      <SelectItem key={acc.id} value={acc.id}>
                        <span className="inline-flex items-center gap-1.5">
                          <span className="inline-flex items-center px-1 py-0 rounded text-[9px] font-mono font-medium bg-muted text-muted-foreground" dir="ltr">{acc.code}</span>
                          <span>{acc.name}</span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="deposit-amount" className="text-sm font-medium">{t.amount}</Label>
                <Input
                  id="deposit-amount"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={transferAmount}
                  onChange={(e) => setTransferAmount(e.target.value)}
                  className="text-left font-mono"
                  dir="ltr"
                />
              </div>
            </div>
          </div>
        )}

        {/* WITHDRAWAL Form */}
        {transferSubType === 'WITHDRAWAL' && (
          <div className="space-y-4">
            <h4 className="text-sm font-semibold text-purple-700 dark:text-purple-400">{t.personalWithdrawalTitle}</h4>
            <p className="text-xs text-muted-foreground">{t.debitWithdrawalCreditCashOrBank}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="withdraw-amount" className="text-sm font-medium">{t.amount}</Label>
                <Input
                  id="withdraw-amount"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={transferAmount}
                  onChange={(e) => setTransferAmount(e.target.value)}
                  className="text-left font-mono"
                  dir="ltr"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-medium">{t.withdrawalMethod}</Label>
                <Select value={transferWithdrawalPaymentMethod} onValueChange={(v) => setTransferWithdrawalPaymentMethod(v as WithdrawalPaymentMethod)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CASH">{t.cashPayment}</SelectItem>
                    <SelectItem value="BANK_TRANSFER">{t.bankTransferLabel}</SelectItem>
                    <SelectItem value="BANK_SADAD">{t.bankSadadLabel}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        )}

        {/* TRANSFER Form */}
        {transferSubType === 'TRANSFER' && (
          <div className="space-y-4">
            <h4 className="text-sm font-semibold text-purple-700 dark:text-purple-400">{t.transferBetweenAccounts}</h4>
            <p className="text-xs text-muted-foreground">{t.debitDestCreditSource}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-sm font-medium">{t.fromAccountSource}</Label>
                <Select value={transferFromAccountId} onValueChange={setTransferFromAccountId}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={t.selectSourceAccount} />
                  </SelectTrigger>
                  <SelectContent>
                    {assetAccounts.map((acc) => (
                      <SelectItem key={acc.id} value={acc.id} disabled={acc.id === transferToAccountId}>
                        <span className="inline-flex items-center gap-1.5">
                          <span className="inline-flex items-center px-1 py-0 rounded text-[9px] font-mono font-medium bg-muted text-muted-foreground" dir="ltr">{acc.code}</span>
                          <span>{acc.name}</span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-medium">{t.toAccountDestination}</Label>
                <Select value={transferToAccountId} onValueChange={setTransferToAccountId}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={t.selectDestinationAccount} />
                  </SelectTrigger>
                  <SelectContent>
                    {assetAccounts.map((acc) => (
                      <SelectItem key={acc.id} value={acc.id} disabled={acc.id === transferFromAccountId}>
                        <span className="inline-flex items-center gap-1.5">
                          <span className="inline-flex items-center px-1 py-0 rounded text-[9px] font-mono font-medium bg-muted text-muted-foreground" dir="ltr">{acc.code}</span>
                          <span>{acc.name}</span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="transfer-amount" className="text-sm font-medium">{t.amount}</Label>
                <Input
                  id="transfer-amount"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={transferAmount}
                  onChange={(e) => setTransferAmount(e.target.value)}
                  className="text-left font-mono"
                  dir="ltr"
                />
              </div>
            </div>
          </div>
        )}

        {/* Description */}
        <div className="space-y-2">
          <Label htmlFor="transfer-desc" className="text-sm font-medium">
            {t.description}
          </Label>
          <Textarea
            id="transfer-desc"
            placeholder={t.transactionDescOptional}
            value={transferDescription}
            onChange={(e) => setTransferDescription(e.target.value)}
            rows={2}
          />
        </div>
      </div>
    );
  }

  // ────────────────────────────────────────────
  // RENDER: Preview Section
  // ────────────────────────────────────────────

  function renderPreview() {
    if (previewLines.length === 0) {
      return (
        <div className="text-center py-8 text-muted-foreground">
          <Receipt className="size-10 mx-auto mb-2 opacity-30" />
          <p className="text-sm">{t.enterTransactionData}</p>
        </div>
      );
    }

    return (
      <div className="space-y-3">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-right text-xs">{t.code}</TableHead>
              <TableHead className="text-right text-xs">{t.account}</TableHead>
              <TableHead className="text-center text-xs">{t.debit}</TableHead>
              <TableHead className="text-center text-xs">{t.credit_account}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {previewLines.map((line) => (
              <TableRow key={line.accountId || line.accountCode}>
                <TableCell className="font-mono text-xs py-2">{line.accountCode}</TableCell>
                <TableCell className="text-sm py-2">{line.accountName}</TableCell>
                <TableCell className="text-center font-mono text-sm py-2">
                  {line.debit > 0 ? formatNumber(line.debit) : '-'}
                </TableCell>
                <TableCell className="text-center font-mono text-sm py-2">
                  {line.credit > 0 ? formatNumber(line.credit) : '-'}
                </TableCell>
              </TableRow>
            ))}
            {/* Totals Row */}
            <TableRow className="border-t-2 border-foreground/20 font-bold">
              <TableCell colSpan={2} className="text-sm py-2">{t.total}</TableCell>
              <TableCell className="text-center font-mono text-sm py-2">
                {formatNumber(totalDebit)}
              </TableCell>
              <TableCell className="text-center font-mono text-sm py-2">
                {formatNumber(totalCredit)}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>

        {/* Balance Indicator */}
        <div className={`flex items-center justify-center gap-2 rounded-lg p-3 text-sm font-medium ${
          isBalanced
            ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400'
            : 'bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400'
        }`}>
          {isBalanced ? (
            <>
              <CheckCircle2 className="size-4" />
              {t.balanced}
            </>
          ) : (
            <>
              <span>{t.difference} {formatNumber(Math.abs(totalDebit - totalCredit))}</span>
            </>
          )}
        </div>
      </div>
    );
  }

  // ────────────────────────────────────────────
  // RENDER: Main Component
  // ────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="size-8 animate-spin text-emerald-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">{t.transactionsTitle}</h2>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-5 h-auto gap-1 p-1">
          <TabsTrigger
            value="sales"
            className="data-[state=active]:bg-emerald-100 data-[state=active]:text-emerald-800 dark:data-[state=active]:bg-emerald-950/50 dark:data-[state=active]:text-emerald-300 text-xs sm:text-sm py-2"
          >
            {t.salesOperations}
          </TabsTrigger>
          <TabsTrigger
            value="expenses"
            className="data-[state=active]:bg-red-100 data-[state=active]:text-red-800 dark:data-[state=active]:bg-red-950/50 dark:data-[state=active]:text-red-300 text-xs sm:text-sm py-2"
          >
            {t.expenses}
          </TabsTrigger>
          <TabsTrigger
            value="purchases"
            className="data-[state=active]:bg-amber-100 data-[state=active]:text-amber-800 dark:data-[state=active]:bg-amber-950/50 dark:data-[state=active]:text-amber-300 text-xs sm:text-sm py-2"
          >
            {t.purchases}
          </TabsTrigger>
          <TabsTrigger
            value="settlement"
            className="data-[state=active]:bg-blue-100 data-[state=active]:text-blue-800 dark:data-[state=active]:bg-blue-950/50 dark:data-[state=active]:text-blue-300 text-xs sm:text-sm py-2"
          >
            {t.paymentAndCollection}
          </TabsTrigger>
          <TabsTrigger
            value="transfer"
            className="data-[state=active]:bg-purple-100 data-[state=active]:text-purple-800 dark:data-[state=active]:bg-purple-950/50 dark:data-[state=active]:text-purple-300 text-xs sm:text-sm py-2"
          >
            {t.withdrawalDepositTransfer}
          </TabsTrigger>
        </TabsList>

        {/* ── Sales Tab ── */}
        <TabsContent value="sales">
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 mt-4">
            <Card className="lg:col-span-3">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <ShoppingCart className="size-5 text-emerald-600" />
                    {t.salesOperations}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs gap-1 text-muted-foreground hover:text-emerald-700"
                    onClick={() => openImportDialog(getCurrentImportType())}
                  >
                    <Upload className="size-3.5" />
                    {t.import}
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {renderSalesForm()}
              </CardContent>
            </Card>
            <Card className="lg:col-span-2">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Receipt className="size-5 text-emerald-600" />
                  {t.entryPreview}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {renderPreview()}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── Expenses Tab ── */}
        <TabsContent value="expenses">
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 mt-4">
            <Card className="lg:col-span-3">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <CreditCard className="size-5 text-red-600" />
                    {t.expenses}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs gap-1 text-muted-foreground hover:text-red-700"
                    onClick={() => openImportDialog(getCurrentImportType())}
                  >
                    <Upload className="size-3.5" />
                    {t.import}
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {renderExpenseForm()}
              </CardContent>
            </Card>
            <Card className="lg:col-span-2">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Receipt className="size-5 text-red-600" />
                  {t.entryPreview}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {renderPreview()}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── Purchases Tab ── */}
        <TabsContent value="purchases">
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 mt-4">
            <Card className="lg:col-span-3">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <ShoppingCart className="size-5 text-amber-600" />
                    {t.purchases}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs gap-1 text-muted-foreground hover:text-amber-700"
                    onClick={() => openImportDialog(getCurrentImportType())}
                  >
                    <Upload className="size-3.5" />
                    {t.import}
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {renderPurchaseForm()}
              </CardContent>
            </Card>
            <Card className="lg:col-span-2">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Receipt className="size-5 text-amber-600" />
                  {t.entryPreview}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {renderPreview()}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── Settlement Tab ── */}
        <TabsContent value="settlement">
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 mt-4">
            <Card className="lg:col-span-3">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <ArrowRightLeft className="size-5 text-blue-600" />
                    {t.paymentAndCollection}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs gap-1 text-muted-foreground hover:text-blue-700"
                    onClick={() => openImportDialog(getCurrentImportType())}
                  >
                    <Upload className="size-3.5" />
                    {t.import}
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {renderSettlementForm()}
              </CardContent>
            </Card>
            <Card className="lg:col-span-2">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Receipt className="size-5 text-blue-600" />
                  {t.entryPreview}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {renderPreview()}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── Transfer Tab (NEW) ── */}
        <TabsContent value="transfer">
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 mt-4">
            <Card className="lg:col-span-3">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <ArrowLeftRight className="size-5 text-purple-600" />
                    {t.withdrawalDepositTransfer}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs gap-1 text-muted-foreground hover:text-purple-700"
                    onClick={() => openImportDialog(getCurrentImportType())}
                  >
                    <Upload className="size-3.5" />
                    {t.import}
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {renderTransferForm()}
              </CardContent>
            </Card>
            <Card className="lg:col-span-2">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Receipt className="size-5 text-purple-600" />
                  {t.entryPreview}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {renderPreview()}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* ── Action Buttons ── */}
      <div className="flex items-center gap-3 pt-2">
        <Button
          onClick={handleSave}
          disabled={saving || !isBalanced}
          className="bg-emerald-600 hover:bg-emerald-700 text-white min-w-[120px]"
        >
          {saving ? (
            <>
              <Loader2 className="size-4 animate-spin ml-2" />
              {t.saving}
            </>
          ) : (
            <>
              <Save className="size-4 ml-2" />
              {t.saveEntry}
            </>
          )}
        </Button>
        <Button
          variant="outline"
          onClick={clearForm}
          disabled={saving}
        >
          <X className="size-4 ml-2" />
          {t.clear}
        </Button>
        <Button
          variant="secondary"
          onClick={() => openImportDialog(getCurrentImportType())}
          className="gap-1.5 mr-auto"
        >
          <Upload className="size-4" />
          {t.importTransactions}
        </Button>
      </div>

      {/* ── Import Dialog ── */}
      <ImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        transactionType={importType}
        transactionLabel={importLabel}
      />
    </div>
  );
}
