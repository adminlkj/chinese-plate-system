// Import Column Specifications for each Transaction Type
// Defines what columns are needed, their order, descriptions, and whether they're required

export interface ImportColumnSpec {
  key: string;           // Internal key name
  labelAr: string;       // Arabic label for column header
  labelEn: string;       // English label
  required: boolean;     // Whether this field is mandatory
  description: string;   // Description/instructions for this column
  acceptedValues?: string[]; // List of accepted values (for dropdowns)
  defaultValue?: string; // Default value if empty
  width?: number;        // Column width for Excel template
}

export interface ImportTypeSpec {
  type: string;              // Transaction type key (e.g., 'SALE_CASH')
  typeLabelAr: string;       // Arabic label for the transaction type
  columns: ImportColumnSpec[]; // Ordered column specifications
}

// ─── Common column definitions ────────────────────────────

const DATE_COLUMN: ImportColumnSpec = {
  key: 'date',
  labelAr: 'التاريخ',
  labelEn: 'Date',
  required: true,
  description: 'تاريخ العملية بصيغة YYYY-MM-DD (مثال: 2025-01-15)',
  width: 15,
};

const AMOUNT_COLUMN: ImportColumnSpec = {
  key: 'amount',
  labelAr: 'المبلغ',
  labelEn: 'Amount',
  required: true,
  description: 'مبلغ العملية (رقم موجب، مثال: 1500.75)',
  width: 15,
};

const BRANCH_COLUMN: ImportColumnSpec = {
  key: 'branch',
  labelAr: 'الفرع',
  labelEn: 'Branch',
  required: false,
  description: 'اسم الفرع: CHINA_TOWN أو PALACE_INDIA - أو بالعربي: الصين أو قصر الهند',
  acceptedValues: ['CHINA_TOWN', 'PALACE_INDIA', 'الصين', 'قصر الهند'],
  defaultValue: 'CHINA_TOWN',
  width: 18,
};

const TAX_COLUMN: ImportColumnSpec = {
  key: 'applyTax',
  labelAr: 'ضريبة 15%',
  labelEn: 'Tax 15%',
  required: false,
  description: 'تطبيق الضريبة: نعم أو لا (أو true/false أو 1/0)',
  acceptedValues: ['نعم', 'لا', 'true', 'false', '1', '0'],
  defaultValue: 'لا',
  width: 12,
};

const DISCOUNT_COLUMN: ImportColumnSpec = {
  key: 'discount',
  labelAr: 'الخصم',
  labelEn: 'Discount',
  required: false,
  description: 'مبلغ الخصم (رقم موجب، مثال: 50.00) - اتركه فارغاً إذا لا يوجد خصم',
  defaultValue: '0',
  width: 12,
};

const DESCRIPTION_COLUMN: ImportColumnSpec = {
  key: 'description',
  labelAr: 'الوصف',
  labelEn: 'Description',
  required: false,
  description: 'وصف أو ملاحظات عن العملية - اختياري',
  width: 25,
};

const CUSTOMER_COLUMN: ImportColumnSpec = {
  key: 'customerName',
  labelAr: 'اسم العميل',
  labelEn: 'Customer Name',
  required: true,
  description: 'اسم العميل كما هو مسجل في النظام (يجب أن يكون العميل موجوداً مسبقاً)',
  width: 20,
};

const SUPPLIER_COLUMN: ImportColumnSpec = {
  key: 'supplierName',
  labelAr: 'اسم المورد',
  labelEn: 'Supplier Name',
  required: true,
  description: 'اسم المورد كما هو مسجل في النظام (يجب أن يكون المورد موجوداً مسبقاً)',
  width: 20,
};

const SUPPLIER_OPTIONAL_COLUMN: ImportColumnSpec = {
  ...SUPPLIER_COLUMN,
  required: false,
  description: 'اسم المورد كما هو مسجل في النظام - اختياري',
};

const EXPENSE_ACCOUNT_COLUMN: ImportColumnSpec = {
  key: 'accountCode',
  labelAr: 'كود الحساب',
  labelEn: 'Account Code',
  required: true,
  description: 'كود حساب المصروف/المشتريات من شجرة الحسابات (مثال: 5001 للأجور)',
  width: 15,
};

const INVOICE_NUMBER_COLUMN: ImportColumnSpec = {
  key: 'invoiceNumber',
  labelAr: 'رقم الفاتورة',
  labelEn: 'Invoice Number',
  required: true,
  description: 'رقم الفاتورة المرتبطة بالعملية',
  width: 18,
};

const INVOICE_NUMBER_OPTIONAL_COLUMN: ImportColumnSpec = {
  ...INVOICE_NUMBER_COLUMN,
  required: false,
  description: 'رقم الفاتورة - اختياري',
};

const PAYMENT_METHOD_SALE_BANK: ImportColumnSpec = {
  key: 'paymentMethod',
  labelAr: 'طريقة الدفع',
  labelEn: 'Payment Method',
  required: true,
  description: 'طريقة الدفع البنكي: MADA أو VISA أو MASTERCARD أو OTHER_CARD أو TRANSFER',
  acceptedValues: ['MADA', 'VISA', 'MASTERCARD', 'OTHER_CARD', 'TRANSFER', 'مدى', 'فيزا', 'ماستركارد', 'تحويل'],
  width: 18,
};

const PAYMENT_METHOD_CASH_BANK: ImportColumnSpec = {
  key: 'paymentMethod',
  labelAr: 'طريقة الدفع',
  labelEn: 'Payment Method',
  required: true,
  description: 'طريقة الدفع: CASH (نقدي) أو BANK (بنكي)',
  acceptedValues: ['CASH', 'BANK', 'نقدي', 'بنكي'],
  width: 15,
};

const PAYMENT_METHOD_EXPENSE: ImportColumnSpec = {
  key: 'paymentMethod',
  labelAr: 'طريقة الدفع',
  labelEn: 'Payment Method',
  required: true,
  description: 'طريقة الدفع: CASH (نقدي) أو SADAD (سداد) أو CARD (بطاقة) أو TRANSFER (تحويل)',
  acceptedValues: ['CASH', 'SADAD', 'CARD', 'TRANSFER', 'نقدي', 'سداد', 'بطاقة', 'تحويل'],
  width: 18,
};

const PAYMENT_METHOD_PURCHASE: ImportColumnSpec = {
  key: 'paymentMethod',
  labelAr: 'طريقة الدفع',
  labelEn: 'Payment Method',
  required: true,
  description: 'طريقة الدفع: CASH (نقدي) أو CARD (بطاقة) أو TRANSFER (تحويل) أو CREDIT (آجل)',
  acceptedValues: ['CASH', 'CARD', 'TRANSFER', 'CREDIT', 'نقدي', 'بطاقة', 'تحويل', 'آجل'],
  width: 18,
};

const BANK_ACCOUNT_COLUMN: ImportColumnSpec = {
  key: 'bankAccountCode',
  labelAr: 'كود الحساب البنكي',
  labelEn: 'Bank Account Code',
  required: true,
  description: 'كود الحساب البنكي للإيداع (مثال: 1010 للبنك الافتراضي)',
  width: 18,
};

const WITHDRAWAL_METHOD_COLUMN: ImportColumnSpec = {
  key: 'withdrawalMethod',
  labelAr: 'طريقة السحب',
  labelEn: 'Withdrawal Method',
  required: true,
  description: 'طريقة السحب: CASH (نقدي) أو BANK_TRANSFER (تحويل بنكي) أو BANK_SADAD (سداد)',
  acceptedValues: ['CASH', 'BANK_TRANSFER', 'BANK_SADAD', 'نقدي', 'تحويل بنكي', 'سداد'],
  width: 18,
};

const FROM_ACCOUNT_COLUMN: ImportColumnSpec = {
  key: 'fromAccountCode',
  labelAr: 'من حساب (كود)',
  labelEn: 'From Account Code',
  required: true,
  description: 'كود حساب المصدر للتحويل (مثال: 1000 للنقدية)',
  width: 18,
};

const TO_ACCOUNT_COLUMN: ImportColumnSpec = {
  key: 'toAccountCode',
  labelAr: 'إلى حساب (كود)',
  labelEn: 'To Account Code',
  required: true,
  description: 'كود حساب الوجهة للتحويل (مثال: 1010 للبنك)',
  width: 18,
};

const PAYABLE_ACCOUNT_COLUMN: ImportColumnSpec = {
  key: 'payableAccountCode',
  labelAr: 'كود حساب الدائن',
  labelEn: 'Payable Account Code',
  required: true,
  description: 'كود حساب الدائن للسداد (مثال: 2000 للموردين)',
  width: 18,
};

// ─── All Transaction Type Specifications ──────────────────

export const IMPORT_SPECS: Record<string, ImportTypeSpec> = {
  // ─── Sales ────────────────────────────────
  SALE_CASH: {
    type: 'SALE_CASH',
    typeLabelAr: 'بيع نقدي',
    columns: [
      DATE_COLUMN,
      AMOUNT_COLUMN,
      BRANCH_COLUMN,
      TAX_COLUMN,
      DISCOUNT_COLUMN,
      DESCRIPTION_COLUMN,
    ],
  },

  SALE_BANK: {
    type: 'SALE_BANK',
    typeLabelAr: 'بيع بنكي',
    columns: [
      DATE_COLUMN,
      AMOUNT_COLUMN,
      PAYMENT_METHOD_SALE_BANK,
      BRANCH_COLUMN,
      TAX_COLUMN,
      DISCOUNT_COLUMN,
      DESCRIPTION_COLUMN,
    ],
  },

  SALE_PLATFORM: {
    type: 'SALE_PLATFORM',
    typeLabelAr: 'بيع منصات (آجل)',
    columns: [
      DATE_COLUMN,
      CUSTOMER_COLUMN,
      AMOUNT_COLUMN,
      INVOICE_NUMBER_COLUMN,
      TAX_COLUMN,
      DISCOUNT_COLUMN,
      DESCRIPTION_COLUMN,
    ],
  },

  // ─── Expenses ─────────────────────────────
  EXPENSE_CASH: {
    type: 'EXPENSE_CASH',
    typeLabelAr: 'مصروفات نقدي',
    columns: [
      DATE_COLUMN,
      EXPENSE_ACCOUNT_COLUMN,
      AMOUNT_COLUMN,
      TAX_COLUMN,
      DISCOUNT_COLUMN,
      DESCRIPTION_COLUMN,
    ],
  },

  EXPENSE_BANK: {
    type: 'EXPENSE_BANK',
    typeLabelAr: 'مصروفات بنكي',
    columns: [
      DATE_COLUMN,
      EXPENSE_ACCOUNT_COLUMN,
      AMOUNT_COLUMN,
      PAYMENT_METHOD_EXPENSE,
      TAX_COLUMN,
      DISCOUNT_COLUMN,
      SUPPLIER_OPTIONAL_COLUMN,
      DESCRIPTION_COLUMN,
    ],
  },

  EXPENSE_SADAD: {
    type: 'EXPENSE_SADAD',
    typeLabelAr: 'مصروفات سداد',
    columns: [
      DATE_COLUMN,
      EXPENSE_ACCOUNT_COLUMN,
      AMOUNT_COLUMN,
      TAX_COLUMN,
      DISCOUNT_COLUMN,
      SUPPLIER_OPTIONAL_COLUMN,
      DESCRIPTION_COLUMN,
    ],
  },

  // ─── Purchases ────────────────────────────
  PURCHASE_CASH: {
    type: 'PURCHASE_CASH',
    typeLabelAr: 'مشتريات نقدي',
    columns: [
      DATE_COLUMN,
      EXPENSE_ACCOUNT_COLUMN,
      AMOUNT_COLUMN,
      TAX_COLUMN,
      DISCOUNT_COLUMN,
      DESCRIPTION_COLUMN,
    ],
  },

  PURCHASE_BANK: {
    type: 'PURCHASE_BANK',
    typeLabelAr: 'مشتريات بنكي',
    columns: [
      DATE_COLUMN,
      EXPENSE_ACCOUNT_COLUMN,
      AMOUNT_COLUMN,
      PAYMENT_METHOD_PURCHASE,
      TAX_COLUMN,
      DISCOUNT_COLUMN,
      DESCRIPTION_COLUMN,
    ],
  },

  PURCHASE_CREDIT: {
    type: 'PURCHASE_CREDIT',
    typeLabelAr: 'مشتريات آجل',
    columns: [
      DATE_COLUMN,
      EXPENSE_ACCOUNT_COLUMN,
      AMOUNT_COLUMN,
      SUPPLIER_COLUMN,
      TAX_COLUMN,
      DISCOUNT_COLUMN,
      DESCRIPTION_COLUMN,
    ],
  },

  // ─── Settlements ──────────────────────────
  COLLECTION: {
    type: 'COLLECTION',
    typeLabelAr: 'تحصيل من عميل',
    columns: [
      DATE_COLUMN,
      CUSTOMER_COLUMN,
      AMOUNT_COLUMN,
      PAYMENT_METHOD_CASH_BANK,
      INVOICE_NUMBER_OPTIONAL_COLUMN,
      DESCRIPTION_COLUMN,
    ],
  },

  PAYMENT: {
    type: 'PAYMENT',
    typeLabelAr: 'سداد للمورد',
    columns: [
      DATE_COLUMN,
      SUPPLIER_COLUMN,
      PAYABLE_ACCOUNT_COLUMN,
      AMOUNT_COLUMN,
      PAYMENT_METHOD_CASH_BANK,
      DESCRIPTION_COLUMN,
    ],
  },

  // ─── Transfers ────────────────────────────
  DEPOSIT: {
    type: 'DEPOSIT',
    typeLabelAr: 'إيداع',
    columns: [
      DATE_COLUMN,
      BANK_ACCOUNT_COLUMN,
      AMOUNT_COLUMN,
      DESCRIPTION_COLUMN,
    ],
  },

  WITHDRAWAL: {
    type: 'WITHDRAWAL',
    typeLabelAr: 'سحب',
    columns: [
      DATE_COLUMN,
      AMOUNT_COLUMN,
      WITHDRAWAL_METHOD_COLUMN,
      DESCRIPTION_COLUMN,
    ],
  },

  TRANSFER: {
    type: 'TRANSFER',
    typeLabelAr: 'تحويل بين حسابات',
    columns: [
      DATE_COLUMN,
      FROM_ACCOUNT_COLUMN,
      TO_ACCOUNT_COLUMN,
      AMOUNT_COLUMN,
      DESCRIPTION_COLUMN,
    ],
  },
};

// Get the spec for a transaction type
export function getImportSpec(type: string): ImportTypeSpec | undefined {
  return IMPORT_SPECS[type];
}

// Get all transaction types grouped by category
export function getImportTypesByCategory(): Record<string, { type: string; labelAr: string }[]> {
  return {
    sales: [
      { type: 'SALE_CASH', labelAr: 'بيع نقدي' },
      { type: 'SALE_BANK', labelAr: 'بيع بنكي' },
      { type: 'SALE_PLATFORM', labelAr: 'بيع منصات (آجل)' },
    ],
    expenses: [
      { type: 'EXPENSE_CASH', labelAr: 'مصروفات نقدي' },
      { type: 'EXPENSE_BANK', labelAr: 'مصروفات بنكي' },
      { type: 'EXPENSE_SADAD', labelAr: 'مصروفات سداد' },
    ],
    purchases: [
      { type: 'PURCHASE_CASH', labelAr: 'مشتريات نقدي' },
      { type: 'PURCHASE_BANK', labelAr: 'مشتريات بنكي' },
      { type: 'PURCHASE_CREDIT', labelAr: 'مشتريات آجل' },
    ],
    settlements: [
      { type: 'COLLECTION', labelAr: 'تحصيل من عميل' },
      { type: 'PAYMENT', labelAr: 'سداد للمورد' },
    ],
    transfers: [
      { type: 'DEPOSIT', labelAr: 'إيداع' },
      { type: 'WITHDRAWAL', labelAr: 'سحب' },
      { type: 'TRANSFER', labelAr: 'تحويل بين حسابات' },
    ],
  };
}

// Map tab name to transaction types available for import
export function getImportTypesForTab(tab: string): { type: string; labelAr: string }[] {
  const categories = getImportTypesByCategory();
  const tabMap: Record<string, string> = {
    sales: 'sales',
    expenses: 'expenses',
    purchases: 'purchases',
    settlement: 'settlements',
    transfer: 'transfers',
  };
  return categories[tabMap[tab]] || [];
}

// Normalize branch value
export function normalizeBranch(value: string): string {
  const v = (value || '').trim();
  if (['CHINA_TOWN', 'الصين'].includes(v)) return 'CHINA_TOWN';
  if (['PALACE_INDIA', 'قصر الهند'].includes(v)) return 'PALACE_INDIA';
  if (['NONE', 'عام', ''].includes(v)) return 'CHINA_TOWN';
  return 'CHINA_TOWN';
}

// Normalize tax boolean
export function normalizeTax(value: string): boolean {
  const v = (value || '').trim().toLowerCase();
  return ['نعم', 'true', '1', 'yes'].includes(v);
}

// Normalize payment method for sale bank
export function normalizeSaleBankPaymentMethod(value: string): string {
  const v = (value || '').trim();
  const map: Record<string, string> = {
    'مدى': 'MADA',
    'فيزا': 'VISA',
    'ماستركارد': 'MASTERCARD',
    'تحويل': 'TRANSFER',
  };
  return map[v] || v.toUpperCase();
}

// Normalize payment method for expense
export function normalizeExpensePaymentMethod(value: string): string {
  const v = (value || '').trim();
  const map: Record<string, string> = {
    'نقدي': 'CASH',
    'سداد': 'SADAD',
    'بطاقة': 'CARD',
    'تحويل': 'TRANSFER',
  };
  return map[v] || v.toUpperCase();
}

// Normalize payment method for purchase
export function normalizePurchasePaymentMethod(value: string): string {
  const v = (value || '').trim();
  const map: Record<string, string> = {
    'نقدي': 'CASH',
    'بطاقة': 'CARD',
    'تحويل': 'TRANSFER',
    'آجل': 'CREDIT',
  };
  return map[v] || v.toUpperCase();
}

// Normalize payment method for settlement (CASH/BANK)
export function normalizeSettlementPaymentMethod(value: string): string {
  const v = (value || '').trim();
  const map: Record<string, string> = {
    'نقدي': 'CASH',
    'بنكي': 'BANK',
    'بنك': 'BANK',
  };
  return map[v] || v.toUpperCase();
}

// Normalize withdrawal method
export function normalizeWithdrawalMethod(value: string): string {
  const v = (value || '').trim();
  const map: Record<string, string> = {
    'نقدي': 'CASH',
    'تحويل بنكي': 'BANK_TRANSFER',
    'سداد': 'BANK_SADAD',
  };
  return map[v] || v.toUpperCase();
}
