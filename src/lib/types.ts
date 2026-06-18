// Accounting System Types

export type AccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';

export type Branch = string;

export type JournalEntryType =
  | 'SALE_CASH'
  | 'SALE_BANK'
  | 'SALE_PLATFORM'
  | 'SALE_RETURN_CASH'
  | 'SALE_RETURN_BANK'
  | 'SALE_RETURN_PLATFORM'
  | 'EXPENSE_CASH'
  | 'EXPENSE_BANK'
  | 'EXPENSE_SADAD'
  | 'PURCHASE_CASH'
  | 'PURCHASE_BANK'
  | 'PURCHASE_CREDIT'
  | 'PURCHASE_RETURN_CASH'
  | 'PURCHASE_RETURN_BANK'
  | 'PURCHASE_RETURN_CREDIT'
  | 'COLLECTION'
  | 'PAYMENT'
  | 'DEPOSIT'
  | 'WITHDRAWAL'
  | 'TRANSFER'
  | 'MANUAL'
  | 'OPENING_BALANCE'
  | 'YEAR_END_CLOSING';

export type EntryStatus = 'DRAFT' | 'POSTED' | 'CANCELLED' | 'RETURNED';

export type PaymentMethod = 'CASH' | 'MADA' | 'VISA' | 'MASTERCARD' | 'OTHER_CARD' | 'SADAD' | 'TRANSFER' | 'CREDIT';

export type PeriodStatus = 'OPEN' | 'CLOSED';

// VAT rate constant
export const TAX_RATE = 0.15; // 15% Saudi VAT

// English number formatting helper - ALWAYS use English digits
// Handles null/undefined/NaN safely to prevent crashes in CurrencyAmount and reports
export function formatNumber(n: number | null | undefined, decimals: number = 2): string {
  const value = typeof n === 'number' && Number.isFinite(n) ? n : 0;
  return value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

// Format amount with currency symbol text (fallback for non-React contexts like toasts)
export function formatCurrency(n: number | null | undefined): string {
  return formatNumber(n);
}

// Format with explicit SAR symbol for contexts that need text
export function formatCurrencyWithSymbol(n: number | null | undefined): string {
  return formatNumber(n) + ' ر.س';
}

export interface AccountWithBalance {
  id: string;
  code: string;
  name: string;
  nameEn?: string;
  type: AccountType;
  parentId?: string;
  branchId: string;
  level: number;
  openingBalance: number;
  currentBalance: number;
  isActive: boolean;
  isSystem: boolean;
  description?: string;
  children?: AccountWithBalance[];
}

export interface JournalEntryWithLines {
  id: string;
  entryNumber: string;
  date: string;
  description: string;
  type: JournalEntryType;
  status: EntryStatus;
  reference?: string;
  branchId: string;
  paymentMethod?: PaymentMethod;
  counterParty?: string;
  invoiceNumber?: string;
  amount: number;
  taxAmount?: number;
  discountAmount?: number;
  totalAmount?: number;
  customerId?: string;
  supplierId?: string;
  groupId?: string;
  groupRole?: string;
  transactionId?: string;
  transactionNumber?: string; // TXN-0001 - the Transaction header number
  transactionType?: string; // SALE, PURCHASE, etc.
  transactionSubType?: string; // CASH, BANK, PLATFORM, etc.
  customerName?: string;
  supplierName?: string;
  lines: JournalLineWithAccount[];
  createdAt: string;
}

export interface JournalLineWithAccount {
  id: string;
  accountId: string;
  accountCode: string;
  accountName: string;
  debit: number;
  credit: number;
  description?: string;
}

export interface TrialBalanceItem {
  accountCode: string;
  accountName: string;
  accountType: AccountType;
  totalDebit: number;
  totalCredit: number;
  netBalance: number;
}

export interface LedgerEntry {
  date: string;
  entryNumber: string;
  description: string;
  debit: number;
  credit: number;
  balance: number;
  type: JournalEntryType;
  reference?: string;
  groupId?: string;
}

export interface IncomeStatementData {
  revenue: { accountCode: string; accountName: string; amount: number }[];
  totalRevenue: number;
  expenses: { accountCode: string; accountName: string; amount: number }[];
  totalExpenses: number;
  netIncome: number;
}

export interface CashFlowData {
  operatingActivities: { description: string; amount: number }[];
  totalOperating: number;
  investingActivities: { description: string; amount: number }[];
  totalInvesting: number;
  financingActivities: { description: string; amount: number }[];
  totalFinancing: number;
  netCashFlow: number;
}

export interface DashboardData {
  totalRevenue: number;
  totalExpenses: number;
  netIncome: number;
  totalAssets: number;
  totalLiabilities: number;
  cashBalance: number;
  accountsReceivable: number;
  accountsPayable: number;
  recentTransactions: JournalEntryWithLines[];
  revenueByBranch: { branch: string; amount: number }[];
  expensesByCategory: { category: string; amount: number }[];
  monthlyRevenue: { month: string; amount: number }[];
}

// Account type labels (Arabic)
export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  ASSET: 'أصول',
  LIABILITY: 'التزامات',
  EQUITY: 'حقوق ملكية',
  REVENUE: 'إيرادات',
  EXPENSE: 'مصروفات',
};

export const BRANCH_LABELS: Record<string, string> = {
  CHINA_TOWN: 'China Town',
  PALACE_INDIA: 'Palace India',
};

export const ENTRY_TYPE_LABELS: Record<JournalEntryType, string> = {
  SALE_CASH: 'بيع نقدي',
  SALE_BANK: 'بيع بنكي',
  SALE_PLATFORM: 'بيع منصات (آجل)',
  SALE_RETURN_CASH: 'مرتجع بيع نقدي',
  SALE_RETURN_BANK: 'مرتجع بيع بنكي',
  SALE_RETURN_PLATFORM: 'مرتجع بيع منصات',
  EXPENSE_CASH: 'مصروفات نقدي',
  EXPENSE_BANK: 'مصروفات بنكي',
  EXPENSE_SADAD: 'مصروفات سداد',
  PURCHASE_CASH: 'مشتريات نقدي',
  PURCHASE_BANK: 'مشتريات بنكي',
  PURCHASE_CREDIT: 'مشتريات آجل',
  PURCHASE_RETURN_CASH: 'مرتجع مشتريات نقدي',
  PURCHASE_RETURN_BANK: 'مرتجع مشتريات بنكي',
  PURCHASE_RETURN_CREDIT: 'مرتجع مشتريات آجل',
  COLLECTION: 'تحصيل',
  PAYMENT: 'سداد',
  DEPOSIT: 'إيداع',
  WITHDRAWAL: 'سحب',
  TRANSFER: 'تحويل',
  MANUAL: 'قيد يدوي',
  OPENING_BALANCE: 'رصيد افتتاحي',
  YEAR_END_CLOSING: 'قيد إقفال سنوي',
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: 'نقدي',
  MADA: 'مدى',
  VISA: 'فيزا',
  MASTERCARD: 'ماستركارد',
  OTHER_CARD: 'بطاقة أخرى',
  SADAD: 'سداد',
  TRANSFER: 'تحويل',
  CREDIT: 'آجل',
};

export const STATUS_LABELS: Record<EntryStatus, string> = {
  DRAFT: 'مسودة',
  POSTED: 'مرحّل',
  CANCELLED: 'ملغي',
  RETURNED: 'مرتجع',
};

// Normal balance for each account type
export const NORMAL_BALANCE: Record<AccountType, 'DEBIT' | 'CREDIT'> = {
  ASSET: 'DEBIT',
  LIABILITY: 'CREDIT',
  EQUITY: 'CREDIT',
  REVENUE: 'CREDIT',
  EXPENSE: 'DEBIT',
};

// Customer type labels
export const CUSTOMER_TYPE_LABELS: Record<string, string> = {
  PLATFORM: 'منصة / آجل',
  CASH: 'نقدي',
  WALK_IN: 'عابر',
  REGULAR: 'دائم',
};

// Group role labels
export const GROUP_ROLE_LABELS: Record<string, string> = {
  PRIMARY: 'عملية رئيسية',
  SETTLEMENT: 'تسوية',
  ADJUSTMENT: 'تعديل',
};

// Transaction type labels (Arabic) - high-level types
export const TRANSACTION_TYPE_LABELS: Record<string, string> = {
  SALE: 'مبيعات',
  SALE_RETURN: 'مرتجع مبيعات',
  PURCHASE: 'مشتريات',
  PURCHASE_RETURN: 'مرتجع مشتريات',
  EXPENSE: 'مصروفات',
  COLLECTION: 'تحصيل',
  PAYMENT: 'سداد',
  DEPOSIT: 'إيداع',
  WITHDRAWAL: 'سحب',
  TRANSFER: 'تحويل',
  OPENING_BALANCE: 'رصيد افتتاحي',
  YEAR_END_CLOSING: 'إقفال سنوي',
  MANUAL: 'قيد يدوي',
};

// Transaction sub-type labels (Arabic) - payment method breakdown
export const TRANSACTION_SUBTYPE_LABELS: Record<string, string> = {
  CASH: 'نقدي',
  BANK: 'بنكي',
  PLATFORM: 'منصات (آجل)',
  SADAD: 'سداد',
  CREDIT: 'آجل',
  RETURN_CREDIT: 'مرتجع آجل',
  RETURN_CASH: 'مرتجع نقدي',
  RETURN_BANK: 'مرتجع بنكي',
  RETURN_PLATFORM: 'مرتجع منصات',
};

// Transaction with its journal entries
export interface TransactionWithEntries {
  id: string;
  transactionNumber: string;
  type: string;
  subType?: string;
  date: string;
  description: string;
  referenceCode?: string;
  branchId: string;
  customerId?: string;
  supplierId?: string;
  totalAmount: number;
  taxAmount: number;
  discountAmount: number;
  netAmount: number;
  status: EntryStatus;
  paymentMethod?: PaymentMethod;
  counterParty?: string;
  invoiceNumber?: string;
  parentTransactionId?: string;
  customerName?: string;
  supplierName?: string;
  journalEntries: JournalEntryWithLines[];
  createdAt: string;
}
