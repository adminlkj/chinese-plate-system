import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { createTransaction } from '@/lib/accounting-engine';
import {
  normalizeBranch,
  normalizeTax,
  normalizeSaleBankPaymentMethod,
  normalizeExpensePaymentMethod,
  normalizePurchasePaymentMethod,
  normalizeSettlementPaymentMethod,
  normalizeWithdrawalMethod,
} from '@/lib/import-specs';
import type { JournalEntryType, PaymentMethod, Branch } from '@/lib/types';
import { requireAuth, checkWriteAccess } from '@/lib/api-auth';
import { resolveBranchIdOrNull, getDefaultBranchId } from '@/lib/branch-resolver';

// POST /api/journal-entries/import - Bulk import transactions
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(); if (!auth.authenticated) return auth.response;
    const writeCheck = checkWriteAccess(auth, 'journal'); if (!writeCheck.authenticated) return writeCheck.response;
    const body = await request.json();
    const { type, rows } = body as { type: string; rows: Record<string, string>[] };

    if (!type || !rows || !Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ error: 'نوع العملية والبيانات مطلوبة' }, { status: 400 });
    }

    // Pre-fetch all accounts, customers, and suppliers for lookup
    const allAccounts = await db.account.findMany({ select: { id: true, code: true, name: true, type: true, isActive: true, parentId: true } });
    const allCustomers = await db.customer.findMany({ select: { id: true, name: true, nameEn: true, isActive: true } });
    const allSuppliers = await db.supplier.findMany({ select: { id: true, name: true, nameEn: true, isActive: true } });

    // Default branch fallback for rows that don't specify a branch
    let defaultBranchId: string | null = null;
    try {
      defaultBranchId = await getDefaultBranchId();
    } catch {
      defaultBranchId = null;
    }

    const results: { row: number; success: boolean; entryNumber?: string; error?: string }[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2; // +2 because row 1 is header

      try {
        const payload = await buildTransactionPayload(type, row, allAccounts, allCustomers, allSuppliers, defaultBranchId);
        const entry = await createTransaction(payload);
        results.push({ row: rowNum, success: true, entryNumber: entry.entryNumber });
      } catch (err: any) {
        results.push({ row: rowNum, success: false, error: err.message || 'خطأ غير معروف' });
      }
    }

    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;

    return NextResponse.json({
      success: true,
      total: rows.length,
      successCount,
      failCount,
      results,
    });
  } catch (error: any) {
    console.error('Error importing transactions:', error);
    return NextResponse.json({ error: 'فشل في استيراد العمليات' }, { status: 500 });
  }
}

// Build a createTransaction payload from a row of imported data
async function buildTransactionPayload(
  type: string,
  row: Record<string, string>,
  allAccounts: { id: string; code: string; name: string; type: string; isActive: boolean; parentId: string | null }[],
  allCustomers: { id: string; name: string; nameEn: string | null; isActive: boolean }[],
  allSuppliers: { id: string; name: string; nameEn: string | null; isActive: boolean }[],
  defaultBranchId: string | null,
): Promise<{
  type: JournalEntryType;
  date: Date;
  description: string;
  amount: number;
  branch?: string;
  paymentMethod?: PaymentMethod;
  counterParty?: string;
  invoiceNumber?: string;
  targetAccountId?: string;
  bankAccountId?: string;
  applyTax?: boolean;
  taxAmount?: number;
  discountAmount?: number;
  customerId?: string;
  supplierId?: string;
  fromAccountId?: string;
  toAccountId?: string;
}> {
  // ─── Parse common fields ──────────────────
  const dateStr = getRequired(row, 'date', 'التاريخ');
  const date = parseDate(dateStr);
  const amount = parseAmount(getRequired(row, 'amount', 'المبلغ'));
  const discount = parseOptionalAmount(row['discount'] || row['الخصم'] || '0');
  const description = (row['description'] || row['الوصف'] || '').trim();
  const applyTax = normalizeTax(row['applyTax'] || row['ضريبة 15%'] || row['الضريبة'] || 'لا');
  const taxAmount = applyTax ? Math.round(amount * 0.15 * 100) / 100 : 0;

  switch (type) {
    // ─── Sales ─────────────────────────────
    case 'SALE_CASH': {
      const branchRaw = normalizeBranch(row['branch'] || row['الفرع'] || '');
      const branchId = branchRaw ? await resolveBranchIdOrNull(branchRaw) : (defaultBranchId || undefined);
      return {
        type: 'SALE_CASH',
        date,
        description: description || 'بيع نقدي',
        amount,
        branch: branchId as any,
        applyTax,
        taxAmount,
        discountAmount: discount,
      };
    }

    case 'SALE_BANK': {
      const branchRaw = normalizeBranch(row['branch'] || row['الفرع'] || '');
      const branchId = branchRaw ? await resolveBranchIdOrNull(branchRaw) : (defaultBranchId || undefined);
      const pmRaw = getRequired(row, 'paymentMethod', 'طريقة الدفع');
      const paymentMethod = normalizeSaleBankPaymentMethod(pmRaw) as PaymentMethod;
      return {
        type: 'SALE_BANK',
        date,
        description: description || 'بيع بنكي',
        amount,
        branch: branchId as any,
        paymentMethod,
        applyTax,
        taxAmount,
        discountAmount: discount,
      };
    }

    case 'SALE_PLATFORM': {
      const customerName = getRequired(row, 'customerName', 'اسم العميل');
      const customer = findEntity(customerName, allCustomers, 'العميل');
      const invoiceNumber = getRequired(row, 'invoiceNumber', 'رقم الفاتورة');
      return {
        type: 'SALE_PLATFORM',
        date,
        description: description || `بيع منصات آجل - ${customerName}`,
        amount,
        paymentMethod: 'CREDIT',
        counterParty: customerName,
        invoiceNumber,
        customerId: customer.id,
        applyTax,
        taxAmount,
        discountAmount: discount,
      };
    }

    // ─── Expenses ──────────────────────────
    case 'EXPENSE_CASH': {
      const accountCode = getRequired(row, 'accountCode', 'كود الحساب');
      const account = findAccount(accountCode, allAccounts);
      return {
        type: 'EXPENSE_CASH',
        date,
        description: description || 'مصروفات نقدي',
        amount,
        targetAccountId: account.id,
        applyTax,
        taxAmount,
        discountAmount: discount,
      };
    }

    case 'EXPENSE_BANK': {
      const accountCode = getRequired(row, 'accountCode', 'كود الحساب');
      const account = findAccount(accountCode, allAccounts);
      const pmRaw = getRequired(row, 'paymentMethod', 'طريقة الدفع');
      const normalizedPm = normalizeExpensePaymentMethod(pmRaw);

      // Map to correct JournalEntryType based on payment method
      let entryType: JournalEntryType;
      let paymentMethod: PaymentMethod;
      if (normalizedPm === 'SADAD') {
        entryType = 'EXPENSE_SADAD';
        paymentMethod = 'SADAD';
      } else if (normalizedPm === 'CASH') {
        entryType = 'EXPENSE_CASH';
        paymentMethod = 'CASH';
      } else {
        entryType = 'EXPENSE_BANK';
        paymentMethod = normalizedPm === 'CARD' ? 'MADA' : 'TRANSFER';
      }

      const supplierName = (row['supplierName'] || row['اسم المورد'] || '').trim();
      let supplierId: string | undefined;
      if (supplierName) {
        const supplier = findEntity(supplierName, allSuppliers, 'المورد');
        supplierId = supplier.id;
      }

      return {
        type: entryType,
        date,
        description: description || 'مصروفات',
        amount,
        targetAccountId: account.id,
        paymentMethod,
        applyTax,
        taxAmount,
        discountAmount: discount,
        supplierId,
      };
    }

    case 'EXPENSE_SADAD': {
      const accountCode = getRequired(row, 'accountCode', 'كود الحساب');
      const account = findAccount(accountCode, allAccounts);
      const supplierName = (row['supplierName'] || row['اسم المورد'] || '').trim();
      let supplierId: string | undefined;
      if (supplierName) {
        const supplier = findEntity(supplierName, allSuppliers, 'المورد');
        supplierId = supplier.id;
      }
      return {
        type: 'EXPENSE_SADAD',
        date,
        description: description || 'مصروفات سداد',
        amount,
        targetAccountId: account.id,
        paymentMethod: 'SADAD',
        applyTax,
        taxAmount,
        discountAmount: discount,
        supplierId,
      };
    }

    // ─── Purchases ─────────────────────────
    case 'PURCHASE_CASH': {
      const accountCode = getRequired(row, 'accountCode', 'كود الحساب');
      const account = findAccount(accountCode, allAccounts);
      return {
        type: 'PURCHASE_CASH',
        date,
        description: description || 'مشتريات نقدي',
        amount,
        targetAccountId: account.id,
        paymentMethod: 'CASH',
        applyTax,
        taxAmount,
        discountAmount: discount,
      };
    }

    case 'PURCHASE_BANK': {
      const accountCode = getRequired(row, 'accountCode', 'كود الحساب');
      const account = findAccount(accountCode, allAccounts);
      const pmRaw = getRequired(row, 'paymentMethod', 'طريقة الدفع');
      const normalizedPm = normalizePurchasePaymentMethod(pmRaw);

      let entryType: JournalEntryType;
      let paymentMethod: PaymentMethod;
      if (normalizedPm === 'CREDIT') {
        entryType = 'PURCHASE_CREDIT';
        paymentMethod = 'CREDIT';
      } else if (normalizedPm === 'CASH') {
        entryType = 'PURCHASE_CASH';
        paymentMethod = 'CASH';
      } else {
        entryType = 'PURCHASE_BANK';
        paymentMethod = normalizedPm === 'CARD' ? 'MADA' : 'TRANSFER';
      }

      const supplierName = (row['supplierName'] || row['اسم المورد'] || '').trim();
      let supplierId: string | undefined;
      if (supplierName) {
        const supplier = findEntity(supplierName, allSuppliers, 'المورد');
        supplierId = supplier.id;
      }

      return {
        type: entryType,
        date,
        description: description || 'مشتريات',
        amount,
        targetAccountId: account.id,
        paymentMethod,
        applyTax,
        taxAmount,
        discountAmount: discount,
        supplierId,
      };
    }

    case 'PURCHASE_CREDIT': {
      const accountCode = getRequired(row, 'accountCode', 'كود الحساب');
      const account = findAccount(accountCode, allAccounts);
      const supplierName = getRequired(row, 'supplierName', 'اسم المورد');
      const supplier = findEntity(supplierName, allSuppliers, 'المورد');
      return {
        type: 'PURCHASE_CREDIT',
        date,
        description: description || `مشتريات آجل - ${supplierName}`,
        amount,
        targetAccountId: account.id,
        paymentMethod: 'CREDIT',
        counterParty: supplierName,
        supplierId: supplier.id,
        applyTax,
        taxAmount,
        discountAmount: discount,
      };
    }

    // ─── Settlements ───────────────────────
    case 'COLLECTION': {
      const customerName = getRequired(row, 'customerName', 'اسم العميل');
      const customer = findEntity(customerName, allCustomers, 'العميل');
      const pmRaw = getRequired(row, 'paymentMethod', 'طريقة الدفع');
      const paymentMethod = normalizeSettlementPaymentMethod(pmRaw);
      const invoiceNumber = (row['invoiceNumber'] || row['رقم الفاتورة'] || '').trim();
      return {
        type: 'COLLECTION',
        date,
        description: description || `تحصيل من ${customerName}`,
        amount,
        paymentMethod: paymentMethod === 'BANK' ? 'TRANSFER' : 'CASH',
        counterParty: customerName,
        invoiceNumber: invoiceNumber || undefined,
        customerId: customer.id,
      };
    }

    case 'PAYMENT': {
      const supplierName = getRequired(row, 'supplierName', 'اسم المورد');
      const supplier = findEntity(supplierName, allSuppliers, 'المورد');
      const payableAccountCode = getRequired(row, 'payableAccountCode', 'كود حساب الدائن');
      const payableAccount = findAccount(payableAccountCode, allAccounts);
      const pmRaw = getRequired(row, 'paymentMethod', 'طريقة الدفع');
      const paymentMethod = normalizeSettlementPaymentMethod(pmRaw);
      return {
        type: 'PAYMENT',
        date,
        description: description || `سداد للمورد ${supplierName}`,
        amount,
        targetAccountId: payableAccount.id,
        paymentMethod: paymentMethod === 'BANK' ? 'TRANSFER' : 'CASH',
        counterParty: supplierName,
        supplierId: supplier.id,
      };
    }

    // ─── Transfers ─────────────────────────
    case 'DEPOSIT': {
      const bankAccountCode = getRequired(row, 'bankAccountCode', 'كود الحساب البنكي');
      const bankAccount = findAccount(bankAccountCode, allAccounts);
      return {
        type: 'DEPOSIT',
        date,
        description: description || 'إيداع في البنك',
        amount,
        toAccountId: bankAccount.id,
      };
    }

    case 'WITHDRAWAL': {
      const methodRaw = getRequired(row, 'withdrawalMethod', 'طريقة السحب');
      const method = normalizeWithdrawalMethod(methodRaw);
      let fromAccountId = '';
      if (method === 'CASH') {
        const cashAcc = allAccounts.find(a => a.code === '1000' && a.isActive);
        fromAccountId = cashAcc?.id || '';
      } else {
        // Find first active leaf bank account under 1010 (parent), fallback to 1010 itself
        const bankParent = allAccounts.find(a => a.code === '1010');
        const bankAcc = bankParent
          ? allAccounts.find(a => a.parentId === bankParent.id && a.isActive) || bankParent
          : allAccounts.find(a => a.code.startsWith('101') && a.isActive);
        fromAccountId = bankAcc?.id || '';
      }
      return {
        type: 'WITHDRAWAL',
        date,
        description: description || 'مسحوبات شخصية',
        amount,
        fromAccountId,
      };
    }

    case 'TRANSFER': {
      const fromAccountCode = getRequired(row, 'fromAccountCode', 'من حساب');
      const toAccountCode = getRequired(row, 'toAccountCode', 'إلى حساب');
      const fromAccount = findAccount(fromAccountCode, allAccounts);
      const toAccount = findAccount(toAccountCode, allAccounts);
      if (fromAccount.id === toAccount.id) {
        throw new Error('لا يمكن التحويل بين نفس الحساب');
      }
      return {
        type: 'TRANSFER',
        date,
        description: description || 'تحويل بين الحسابات',
        amount,
        fromAccountId: fromAccount.id,
        toAccountId: toAccount.id,
      };
    }

    default:
      throw new Error(`نوع العملية غير معروف: ${type}`);
  }
}

// ─── Helper functions ─────────────────────────────────────

function getRequired(row: Record<string, string>, key: string, labelAr: string): string {
  const value = (row[key] || '').trim();
  if (!value) {
    throw new Error(`الحقل "${labelAr}" إجباري ولا يمكن أن يكون فارغاً`);
  }
  return value;
}

function parseDate(value: string): Date {
  // Support multiple date formats
  const v = value.trim();

  // Try YYYY-MM-DD
  const isoMatch = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    const date = new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
    if (!isNaN(date.getTime())) return date;
  }

  // Try DD/MM/YYYY
  const dmyMatch = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmyMatch) {
    const [, d, m, y] = dmyMatch;
    const date = new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
    if (!isNaN(date.getTime())) return date;
  }

  // Try MM/DD/YYYY
  const mdyMatch = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdyMatch) {
    const [, m, d, y] = mdyMatch;
    const date = new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
    if (!isNaN(date.getTime())) return date;
  }

  // Fallback: try native Date parsing
  const fallback = new Date(v);
  if (!isNaN(fallback.getTime())) return fallback;

  throw new Error(`صيغة التاريخ غير صحيحة: "${v}" - استخدم YYYY-MM-DD`);
}

function parseAmount(value: string): number {
  const num = parseFloat(value.replace(/,/g, ''));
  if (isNaN(num) || num <= 0) {
    throw new Error(`المبلغ غير صحيح: "${value}" - يجب أن يكون رقماً موجباً`);
  }
  return Math.round(num * 100) / 100;
}

function parseOptionalAmount(value: string): number {
  if (!value || !value.trim()) return 0;
  const num = parseFloat(value.replace(/,/g, ''));
  if (isNaN(num) || num < 0) return 0;
  return Math.round(num * 100) / 100;
}

function findAccount(code: string, accounts: { id: string; code: string; name: string; type: string; isActive: boolean; parentId: string | null }[]) {
  const account = accounts.find(a => a.code === code && a.isActive);
  if (!account) {
    throw new Error(`الحساب بكود "${code}" غير موجود أو غير نشط في شجرة الحسابات`);
  }
  return account;
}

function findEntity(
  name: string,
  entities: { id: string; name: string; nameEn: string | null; isActive: boolean }[],
  label: string,
) {
  const entity = entities.find(e =>
    e.isActive && (
      e.name === name ||
      e.nameEn === name ||
      e.name.includes(name) ||
      (e.nameEn && e.nameEn.includes(name))
    )
  );
  if (!entity) {
    throw new Error(`${label} "${name}" غير موجود في النظام - يجب إضافته أولاً`);
  }
  return entity;
}
