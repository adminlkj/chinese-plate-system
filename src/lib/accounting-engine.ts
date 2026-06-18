// Accounting Engine - Core Double-Entry Bookkeeping Logic
// ALL financial write operations are wrapped in Prisma $transaction() for atomicity
// Transaction Header model groups related JournalEntries under one business event
import { db } from './db';
import { PrismaClient } from '@prisma/client';
import { AccountType, Branch, JournalEntryType, EntryStatus, PaymentMethod, NORMAL_BALANCE, TAX_RATE, TransactionWithEntries } from './types';
import { toNumber, round2 } from './decimal';
import { resolveBranchId, getDefaultBranchId } from './branch-resolver';

// Transaction type for passing Prisma transaction context
export type PrismaTransaction = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

// Generate next entry number
export async function generateEntryNumber(tx?: PrismaTransaction): Promise<string> {
  const client = tx || db;
  const lastEntry = await client.journalEntry.findFirst({
    orderBy: { entryNumber: 'desc' },
    select: { entryNumber: true },
  });

  if (!lastEntry) return 'JE-0001';

  const num = parseInt(lastEntry.entryNumber.replace('JE-', ''));
  if (isNaN(num)) throw new Error(`Corrupted entry number: ${lastEntry.entryNumber}`);
  return `JE-${String(num + 1).padStart(4, '0')}`;
}

// Generate next transaction number (TXN-0001, TXN-0002, etc.)
export async function generateTransactionNumber(tx?: PrismaTransaction): Promise<string> {
  const client = tx || db;
  const lastTxn = await client.transaction.findFirst({
    orderBy: { transactionNumber: 'desc' },
    select: { transactionNumber: true },
  });

  if (!lastTxn) return 'TXN-0001';

  const num = parseInt(lastTxn.transactionNumber.replace('TXN-', ''));
  if (isNaN(num)) throw new Error(`Corrupted entry number: ${lastTxn.transactionNumber}`);
  return `TXN-${String(num + 1).padStart(4, '0')}`;
}

// Generate next transaction group number (kept for backward compatibility)
export async function generateGroupId(tx?: PrismaTransaction): Promise<string> {
  return generateTransactionNumber(tx);
}

// Get account balance from all posted transactions (opening balance is recorded via journal entries)
export async function getAccountBalance(accountId: string, tx?: PrismaTransaction): Promise<number> {
  const client = tx || db;
  const result = await client.journalLine.aggregate({
    where: {
      accountId,
      journalEntry: { status: 'POSTED' },
    },
    _sum: {
      debit: true,
      credit: true,
    },
  }) as any;

  const account = await client.account.findUnique({
    where: { id: accountId },
    select: { type: true },
  }) as any;

  if (!account) return 0;

  const totalDebit = toNumber(result._sum.debit);
  const totalCredit = toNumber(result._sum.credit);
  const normalBalance = NORMAL_BALANCE[account.type as AccountType];

  if (normalBalance === 'DEBIT') {
    return round2(totalDebit - totalCredit);
  } else {
    return round2(totalCredit - totalDebit);
  }
}

// Get all account balances in a single optimized query
// All accounts (including 2600 Tax Payable) are regular accounts with balances from journal lines
// Tax Payable (2600) receives actual journal lines during VAT settlement (إقفال)
export async function getAllAccountBalances(tx?: PrismaTransaction): Promise<Map<string, number>> {
  const client = tx || db;
  const accounts = await client.account.findMany({
    select: { id: true, type: true, code: true },
  });

  // Single query to get all posted journal line sums grouped by account
  const postedSums = await client.journalLine.groupBy({
    by: ['accountId'],
    where: {
      journalEntry: { status: 'POSTED' },
    },
    _sum: {
      debit: true,
      credit: true,
    },
  }) as any[];

  // Create a map of accountId -> { debit, credit }
  const sumsMap = new Map<string, { debit: number; credit: number }>(postedSums.map((s: any) => [s.accountId, { debit: toNumber(s._sum.debit), credit: toNumber(s._sum.credit) }]));

  // Calculate balance for each account
  const balances = new Map<string, number>();
  for (const account of accounts) {
    const sums = sumsMap.get(account.id) || { debit: 0, credit: 0 };
    const normalBalance = NORMAL_BALANCE[account.type as AccountType];
    const balance = normalBalance === 'DEBIT'
      ? round2(sums.debit - sums.credit)
      : round2(sums.credit - sums.debit);
    balances.set(account.id, balance);
  }

  return balances;
}

// Get all child account IDs recursively
export async function getChildAccountIds(accountId: string, tx?: PrismaTransaction): Promise<string[]> {
  const client = tx || db;
  const ids: string[] = [accountId];
  const children = await client.account.findMany({
    where: { parentId: accountId },
    select: { id: true },
  });

  for (const child of children) {
    const childIds = await getChildAccountIds(child.id, client);
    ids.push(...childIds);
  }

  return ids;
}

// Get account balance for a group of accounts (parent + children)
export async function getGroupBalance(accountId: string, tx?: PrismaTransaction): Promise<number> {
  const allIds = await getChildAccountIds(accountId, tx);
  let totalBalance = 0;

  for (const id of allIds) {
    totalBalance += await getAccountBalance(id, tx);
  }

  return totalBalance;
}

// Validate that debits equal credits
export function validateBalancedEntry(
  lines: { debit: number; credit: number }[]
): boolean {
  const totalDebit = round2(lines.reduce((sum, l) => round2(sum + l.debit), 0));
  const totalCredit = round2(lines.reduce((sum, l) => round2(sum + l.credit), 0));
  return Math.abs(totalDebit - totalCredit) < 0.005;
}

// Update the current balance of an account (must be called within a transaction)
export async function updateAccountBalance(accountId: string, tx: PrismaTransaction): Promise<void> {
  const balance = await getAccountBalance(accountId, tx);
  await tx.account.update({
    where: { id: accountId },
    data: { currentBalance: balance },
  });
}

// Recalculate all account balances within a single transaction (optimized with batch query)
// All accounts including 2600 (Tax Payable) use regular journal line balances
export async function recalculateAllBalances(): Promise<void> {
  await db.$transaction(async (tx) => {
    const accounts = await tx.account.findMany({
      select: { id: true, type: true, code: true },
    });

    // Single query to get all posted journal line sums grouped by account
    const postedSums = await tx.journalLine.groupBy({
      by: ['accountId'],
      where: {
        journalEntry: { status: 'POSTED' },
      },
      _sum: {
        debit: true,
        credit: true,
      },
    }) as any[];

    // Create a map of accountId -> { debit, credit }
    const sumsMap = new Map<string, { debit: number; credit: number }>(postedSums.map((s: any) => [s.accountId, { debit: toNumber(s._sum.debit), credit: toNumber(s._sum.credit) }]));

    // Update all account balances using the batch data
    for (const account of accounts) {
      const sums = sumsMap.get(account.id) || { debit: 0, credit: 0 };
      const normalBalance = NORMAL_BALANCE[account.type as AccountType];
      const balance = normalBalance === 'DEBIT'
        ? round2(sums.debit - sums.credit)
        : round2(sums.credit - sums.debit);

      await tx.account.update({
        where: { id: account.id },
        data: { currentBalance: balance },
      });
    }
  });
}

// Helper: Map JournalEntryType to Transaction type and subType
function mapTransactionType(entryType: JournalEntryType): { type: string; subType: string | null } {
  switch (entryType) {
    case 'SALE_CASH': return { type: 'SALE', subType: 'CASH' };
    case 'SALE_BANK': return { type: 'SALE', subType: 'BANK' };
    case 'SALE_PLATFORM': return { type: 'SALE', subType: 'PLATFORM' };
    case 'SALE_RETURN_CASH': return { type: 'SALE_RETURN', subType: 'RETURN_CASH' };
    case 'SALE_RETURN_BANK': return { type: 'SALE_RETURN', subType: 'RETURN_BANK' };
    case 'SALE_RETURN_PLATFORM': return { type: 'SALE_RETURN', subType: 'RETURN_PLATFORM' };
    case 'EXPENSE_CASH': return { type: 'EXPENSE', subType: 'CASH' };
    case 'EXPENSE_BANK': return { type: 'EXPENSE', subType: 'BANK' };
    case 'EXPENSE_SADAD': return { type: 'EXPENSE', subType: 'SADAD' };
    case 'PURCHASE_CASH': return { type: 'PURCHASE', subType: 'CASH' };
    case 'PURCHASE_BANK': return { type: 'PURCHASE', subType: 'BANK' };
    case 'PURCHASE_CREDIT': return { type: 'PURCHASE', subType: 'CREDIT' };
    case 'PURCHASE_RETURN_CASH': return { type: 'PURCHASE_RETURN', subType: 'RETURN_CASH' };
    case 'PURCHASE_RETURN_BANK': return { type: 'PURCHASE_RETURN', subType: 'RETURN_BANK' };
    case 'PURCHASE_RETURN_CREDIT': return { type: 'PURCHASE_RETURN', subType: 'RETURN_CREDIT' };
    case 'COLLECTION': return { type: 'COLLECTION', subType: null };
    case 'PAYMENT': return { type: 'PAYMENT', subType: null };
    case 'DEPOSIT': return { type: 'DEPOSIT', subType: null };
    case 'WITHDRAWAL': return { type: 'WITHDRAWAL', subType: null };
    case 'TRANSFER': return { type: 'TRANSFER', subType: null };
    case 'MANUAL': return { type: 'MANUAL', subType: null };
    case 'OPENING_BALANCE': return { type: 'OPENING_BALANCE', subType: null };
    case 'YEAR_END_CLOSING': return { type: 'YEAR_END_CLOSING', subType: null };
    default: return { type: 'MANUAL', subType: null };
  }
}

// Helper: Determine groupRole from Transaction type
function mapGroupRole(type: string): 'PRIMARY' | 'SETTLEMENT' | 'ADJUSTMENT' {
  if (['COLLECTION', 'PAYMENT'].includes(type)) return 'SETTLEMENT';
  return 'PRIMARY';
}

// Helper: Get account ID or throw error if account not found
// Prevents orphan journal lines with empty accountId
function requireAccountId(account: { id: string } | null, accountName: string): string {
  if (!account) throw new Error(`حساب النظام "${accountName}" غير موجود. يجب تهيئة شجرة الحسابات أولاً.`);
  return account.id;
}

// Helper: Find the appropriate leaf sales account for a given branch.
// IMPORTANT: Never post to 4000 (parent/summary account) — always use a leaf account.
// Each branch must have its own sales sub-account under 4000 (المبيعات).
// For platform sales, the SALE_PLATFORM case uses account 4300 directly.
async function findSalesAccount(tx: PrismaTransaction, branchId?: string): Promise<{ id: string; code: string } | null> {
  // Look up the sales sub-account by branchId field on the Account model
  const parentSales = await tx.account.findFirst({ where: { code: '4000' }, select: { id: true } });
  if (!parentSales) {
    throw new Error('حساب المبيعات الرئيسي (4000) غير موجود. يجب تهيئة شجرة الحسابات أولاً.');
  }

  // Resolve branchId — fall back to default branch if not provided
  const effectiveBranchId = branchId || await getDefaultBranchId();

  // Find a child revenue account matching the branchId (exclude platform sales 4300)
  const branchAccount = await tx.account.findFirst({
    where: {
      parentId: parentSales.id,
      branchId: effectiveBranchId,
      type: 'REVENUE',
      code: { not: '4300' },
      isActive: true,
    },
    select: { id: true, code: true },
  });

  if (branchAccount) return branchAccount;

  // If no branch-specific account found, throw an error — every branch needs its own sales account
  throw new Error(`لا يوجد حساب مبيعات للفرع المحدد. يجب إنشاء حساب مبيعات فرعي تحت حساب المبيعات الرئيسي (4000) وربطه بالفرع.`);
}

// Helper: Find the default bank account (first active leaf under 1010).
// IMPORTANT: Never post to 1010 (parent/summary account) — always use a leaf account.
// Falls back to 1010 directly if no children exist (backward compat with old DB).
async function findDefaultBankAccount(tx: PrismaTransaction): Promise<{ id: string; code: string; name: string } | null> {
  const parentBank = await tx.account.findFirst({ where: { code: '1010' }, select: { id: true } });
  if (!parentBank) return null;

  // Try to find the first active leaf child (e.g., 1011 الراجحي الرئيسي)
  const leafBank = await tx.account.findFirst({
    where: {
      parentId: parentBank.id,
      type: 'ASSET',
      isActive: true,
    },
    orderBy: { code: 'asc' },
    select: { id: true, code: true, name: true },
  });

  if (leafBank) return leafBank;

  // Fallback: return the parent itself (old DB without children)
  return await tx.account.findFirst({ where: { code: '1010' }, select: { id: true, code: true, name: true } });
}

// Helper: Find the platform customers account (1102).
// IMPORTANT: Never post to 1100 (parent/summary account) — always use a leaf account.
// Falls back to 1100 directly if no children exist (backward compat with old DB).
async function findPlatformCustomersAccount(tx: PrismaTransaction): Promise<{ id: string; code: string } | null> {
  // Try 1102 (عملاء منصات) first
  const platformAcc = await tx.account.findFirst({
    where: { code: '1102', isActive: true },
    select: { id: true, code: true },
  });
  if (platformAcc) return platformAcc;

  // Fallback: find any active child under 1100
  const parentCustomers = await tx.account.findFirst({ where: { code: '1100' }, select: { id: true } });
  if (parentCustomers) {
    const childAcc = await tx.account.findFirst({
      where: { parentId: parentCustomers.id, type: 'ASSET', isActive: true },
      select: { id: true, code: true },
    });
    if (childAcc) return childAcc;
  }

  // Last resort: return 1100 itself (old DB without children)
  return await tx.account.findFirst({ where: { code: '1100' }, select: { id: true, code: true } });
}

// Helper: Find the local suppliers account (2001).
// IMPORTANT: Never post to 2000 (parent/summary account) — always use a leaf account.
// Falls back to 2000 directly if no children exist (backward compat with old DB).
async function findLocalSuppliersAccount(tx: PrismaTransaction): Promise<{ id: string; code: string } | null> {
  // Try 2001 (موردين محليين) first
  const localAcc = await tx.account.findFirst({
    where: { code: '2001', isActive: true },
    select: { id: true, code: true },
  });
  if (localAcc) return localAcc;

  // Fallback: find any active child under 2000
  const parentSuppliers = await tx.account.findFirst({ where: { code: '2000' }, select: { id: true } });
  if (parentSuppliers) {
    const childAcc = await tx.account.findFirst({
      where: { parentId: parentSuppliers.id, type: 'LIABILITY', isActive: true },
      select: { id: true, code: true },
    });
    if (childAcc) return childAcc;
  }

  // Last resort: return 2000 itself (old DB without children)
  return await tx.account.findFirst({ where: { code: '2000' }, select: { id: true, code: true } });
}

// Create a transaction with header + journal entry atomically
// WRAPPED IN $transaction for atomicity
// FIRST creates a Transaction header, THEN creates JournalEntry linked to it
// If an external `tx` is provided, it will be used instead of starting a new transaction
// This allows createTransaction to participate in an existing transaction context
export async function createTransaction(params: {
  type: JournalEntryType;
  date: Date;
  description: string;
  amount: number;
  branchId?: string;
  /** @deprecated use branchId — legacy branch code, will be resolved to branchId */
  branch?: Branch;
  paymentMethod?: PaymentMethod;
  counterParty?: string;
  invoiceNumber?: string;
  reference?: string;
  // For specific accounts
  targetAccountId?: string;
  bankAccountId?: string;
  // Tax and discount
  applyTax?: boolean;
  taxAmount?: number;
  discountAmount?: number;
  // Customer/Supplier links
  customerId?: string;
  supplierId?: string;
  // For deposit/withdrawal/transfer
  fromAccountId?: string;
  toAccountId?: string;
  // For manual entries
  lines?: { accountId: string; debit: number; credit: number; description?: string }[];
  // Entry status - DRAFT entries do NOT affect account balances
  status?: 'DRAFT' | 'POSTED';
  // Transaction grouping (backward compat)
  groupId?: string;
  groupRole?: 'PRIMARY' | 'SETTLEMENT' | 'ADJUSTMENT';
  // Parent transaction link (e.g., COLLECTION -> original SALE)
  parentTransactionId?: string;
  // External transaction client - if provided, uses this instead of starting a new transaction
  tx?: PrismaTransaction;
}) {
  const executeInTransaction = async (tx: PrismaTransaction) => {
    // Resolve branchId — accept either branchId (UUID) or legacy branch code
    // Falls back to the default active branch if neither is provided
    const branchId = params.branchId
      ? params.branchId
      : params.branch
        ? await resolveBranchId(params.branch)
        : await getDefaultBranchId();

    const entryNumber = await generateEntryNumber(tx);
    const transactionNumber = await generateTransactionNumber(tx);

    // Map to Transaction type/subType
    const { type: txnType, subType: txnSubType } = mapTransactionType(params.type);

    // Determine group role
    const groupRole = params.groupRole || mapGroupRole(txnType);

    // Get or create current fiscal period
    // First check if the entry date falls within any existing period
    let period = await tx.fiscalPeriod.findFirst({
      where: {
        startDate: { lte: params.date },
        endDate: { gte: params.date },
      },
      orderBy: { startDate: 'desc' },
    });

    if (period && period.status === 'CLOSED') {
      throw new Error(`لا يمكن ترحيل قيد إلى فترة مغلقة (${period.name}). يرجى إعادة فتح الفترة أو اختيار تاريخ مختلف`);
    }

    if (!period) {
      // Fall back to any OPEN period
      period = await tx.fiscalPeriod.findFirst({
        where: { status: 'OPEN' },
      });
    }

    if (!period) {
      period = await tx.fiscalPeriod.create({
        data: {
          name: 'الفترة الحالية',
          startDate: new Date(new Date().getFullYear(), 0, 1),
          endDate: new Date(new Date().getFullYear(), 11, 31),
          status: 'OPEN',
        },
      });
    }

    let lines: { accountId: string; debit: number; credit: number; description?: string }[] = [];

    // Get key accounts
    // IMPORTANT: Use leaf accounts, never parent/summary accounts (1010, 1100, 2000)
    // The helper functions find the correct leaf sub-account with fallback for backward compat
    const defaultBank = params.bankAccountId
      ? await tx.account.findUnique({ where: { id: params.bankAccountId } })
      : await findDefaultBankAccount(tx);

    const cashAccount = await tx.account.findFirst({ where: { code: '1000' } });
    // Use platform customers (1102) instead of parent 1100 for AR postings
    const platformCustomersAccount = await findPlatformCustomersAccount(tx);
    // Keep reference to parent 1100 for balance display only (never post to it)
    const customersAccount = platformCustomersAccount; // For posting: always use leaf account
    // Use local suppliers (2001) instead of parent 2000 for AP postings
    const localSuppliersAccount = await findLocalSuppliersAccount(tx);
    // Keep reference to parent 2000 for balance display only (never post to it)
    const suppliersAccount = localSuppliersAccount; // For posting: always use leaf account
    const outputTaxAccount = await tx.account.findFirst({ where: { code: '2100' } });
    const inputTaxAccount = await tx.account.findFirst({ where: { code: '1200' } });
    const discountAllowedAccount = await tx.account.findFirst({ where: { code: '5800' } });
    const discountReceivedAccount = await tx.account.findFirst({ where: { code: '4400' } });
    const withdrawalAccount = await tx.account.findFirst({ where: { code: '3001' } });
    const cogsAccount = await tx.account.findFirst({ where: { code: '5950' } });
    const inventoryAccount = await tx.account.findFirst({ where: { code: '1300' } });

    // Calculate tax and discount
    const taxAmount = params.applyTax ? (params.taxAmount ?? round2((params.amount ?? 0) * TAX_RATE)) : 0;
    const discountAmount = round2(params.discountAmount ?? 0);

    // Calculate netAmount (base + tax - discount) for the Transaction header
    // For MANUAL/OPENING_BALANCE entries, amount may not be provided — will be recalculated from lines after they're built
    let netAmount = round2((params.amount ?? 0) + taxAmount - discountAmount);

    // Validate amount is positive (reject zero or negative amounts)
    if (params.type !== 'MANUAL' && params.type !== 'OPENING_BALANCE' && !(params as any).isCOGS && !(params as any).isCOGSReturn && params.amount <= 0) {
      throw new Error('يجب أن يكون مبلغ العملية أكبر من صفر');
    }

    // Handle COGS entry separately — Debit COGS, Credit Inventory
    if ((params as any).isCOGS) {
      lines.push(
        { accountId: requireAccountId(cogsAccount, 'تكلفة البضاعة المباعة 5950'), debit: params.amount, credit: 0, description: 'تكلفة بضاعة مباعة' },
        { accountId: requireAccountId(inventoryAccount, 'المخزون 1300'), debit: 0, credit: params.amount, description: 'تخفيض المخزون' },
      );
    } else if ((params as any).isCOGSReturn) {
      // Handle COGS reversal on return — Debit Inventory, Credit COGS (reverse of original COGS entry)
      lines.push(
        { accountId: requireAccountId(inventoryAccount, 'المخزون 1300'), debit: params.amount, credit: 0, description: 'إعادة المخزون - عكس تكلفة البضاعة المباعة' },
        { accountId: requireAccountId(cogsAccount, 'تكلفة البضاعة المباعة 5950'), debit: 0, credit: params.amount, description: 'عكس تكلفة بضاعة مباعة - مرتجع' },
      );
    } else {
    switch (params.type) {
      case 'SALE_CASH': {
        // IMPORTANT: Use leaf accounts only — never post to 4000 (parent/summary)
        const salesAccount = await findSalesAccount(tx, branchId);
        const cashReceived = round2(params.amount + taxAmount - discountAmount);
        lines.push(
          { accountId: requireAccountId(cashAccount, 'النقدية 1000'), debit: cashReceived, credit: 0, description: 'مبيعات نقدي' },
        );
        if (discountAmount > 0) {
          lines.push({ accountId: requireAccountId(discountAllowedAccount, 'الخصم المسموح 5800'), debit: discountAmount, credit: 0, description: 'خصم مسموح به' });
        }
        lines.push(
          { accountId: requireAccountId(salesAccount, 'المبيعات'), debit: 0, credit: params.amount, description: 'إيراد مبيعات' },
        );
        if (taxAmount > 0) {
          lines.push({ accountId: requireAccountId(outputTaxAccount, 'ضريبة المخرجات 2100'), debit: 0, credit: taxAmount, description: 'ضريبة مخرجات' });
        }
        break;
      }

      case 'SALE_BANK': {
        // IMPORTANT: Use leaf accounts only — never post to 4000 (parent/summary)
        const salesAccount = await findSalesAccount(tx, branchId);
        const bankReceived = round2(params.amount + taxAmount - discountAmount);
        lines.push(
          { accountId: requireAccountId(defaultBank, 'البنك 1010'), debit: bankReceived, credit: 0, description: `مبيعات بنكي - ${params.paymentMethod || ''}` },
        );
        if (discountAmount > 0) {
          lines.push({ accountId: requireAccountId(discountAllowedAccount, 'الخصم المسموح 5800'), debit: discountAmount, credit: 0, description: 'خصم مسموح به' });
        }
        lines.push(
          { accountId: requireAccountId(salesAccount, 'المبيعات'), debit: 0, credit: params.amount, description: 'إيراد مبيعات' },
        );
        if (taxAmount > 0) {
          lines.push({ accountId: requireAccountId(outputTaxAccount, 'ضريبة المخرجات 2100'), debit: 0, credit: taxAmount, description: 'ضريبة مخرجات' });
        }
        break;
      }

      case 'SALE_PLATFORM': {
        const platformSales = await tx.account.findFirst({ where: { code: '4300' } });
        const arAmount = round2(params.amount + taxAmount - discountAmount);
        lines.push(
          { accountId: requireAccountId(customersAccount, 'العملاء 1100'), debit: arAmount, credit: 0, description: `مبيعات منصات - ${params.counterParty || ''}` },
        );
        if (discountAmount > 0) {
          lines.push({ accountId: requireAccountId(discountAllowedAccount, 'الخصم المسموح 5800'), debit: discountAmount, credit: 0, description: 'خصم مسموح به' });
        }
        lines.push(
          { accountId: requireAccountId(platformSales, 'مبيعات المنصات 4300'), debit: 0, credit: params.amount, description: 'إيراد مبيعات منصات' },
        );
        if (taxAmount > 0) {
          lines.push({ accountId: requireAccountId(outputTaxAccount, 'ضريبة المخرجات 2100'), debit: 0, credit: taxAmount, description: 'ضريبة مخرجات' });
        }
        break;
      }

      // ─── SALE RETURN entries (reverse of SALE) ───
      case 'SALE_RETURN_CASH': {
        // Reverse of SALE_CASH — must use the same leaf account logic
        const salesAccount = await findSalesAccount(tx, branchId);
        const cashRefunded = round2(params.amount + taxAmount - discountAmount);
        // Reverse: credit cash (money goes out), debit sales (reduce revenue)
        lines.push(
          { accountId: requireAccountId(salesAccount, 'المبيعات'), debit: params.amount, credit: 0, description: 'مرتجع مبيعات - خصم إيراد' },
        );
        if (taxAmount > 0) {
          lines.push({ accountId: requireAccountId(outputTaxAccount, 'ضريبة المخرجات 2100'), debit: taxAmount, credit: 0, description: 'مرتجع ضريبة مخرجات' });
        }
        if (discountAmount > 0) {
          lines.push({ accountId: requireAccountId(discountAllowedAccount, 'الخصم المسموح 5800'), debit: 0, credit: discountAmount, description: 'عكس خصم مسموح به' });
        }
        lines.push(
          { accountId: requireAccountId(cashAccount, 'النقدية 1000'), debit: 0, credit: cashRefunded, description: 'سداد مرتجع نقدي' },
        );
        break;
      }

      case 'SALE_RETURN_BANK': {
        // Reverse of SALE_BANK — must use the same leaf account logic
        const salesAccount = await findSalesAccount(tx, branchId);
        const bankRefunded = round2(params.amount + taxAmount - discountAmount);
        lines.push(
          { accountId: requireAccountId(salesAccount, 'المبيعات'), debit: params.amount, credit: 0, description: 'مرتجع مبيعات - خصم إيراد' },
        );
        if (taxAmount > 0) {
          lines.push({ accountId: requireAccountId(outputTaxAccount, 'ضريبة المخرجات 2100'), debit: taxAmount, credit: 0, description: 'مرتجع ضريبة مخرجات' });
        }
        if (discountAmount > 0) {
          lines.push({ accountId: requireAccountId(discountAllowedAccount, 'الخصم المسموح 5800'), debit: 0, credit: discountAmount, description: 'عكس خصم مسموح به' });
        }
        lines.push(
          { accountId: requireAccountId(defaultBank, 'البنك 1010'), debit: 0, credit: bankRefunded, description: `سداد مرتجع بنكي - ${params.paymentMethod || ''}` },
        );
        break;
      }

      case 'SALE_RETURN_PLATFORM': {
        const platformSales = await tx.account.findFirst({ where: { code: '4300' } });
        const arRefundAmount = round2(params.amount + taxAmount - discountAmount);
        lines.push(
          { accountId: requireAccountId(platformSales, 'مبيعات المنصات 4300'), debit: params.amount, credit: 0, description: 'مرتجع مبيعات منصات - خصم إيراد' },
        );
        if (taxAmount > 0) {
          lines.push({ accountId: requireAccountId(outputTaxAccount, 'ضريبة المخرجات 2100'), debit: taxAmount, credit: 0, description: 'مرتجع ضريبة مخرجات' });
        }
        if (discountAmount > 0) {
          lines.push({ accountId: requireAccountId(discountAllowedAccount, 'الخصم المسموح 5800'), debit: 0, credit: discountAmount, description: 'عكس خصم مسموح به' });
        }
        lines.push(
          { accountId: requireAccountId(customersAccount, 'العملاء 1100'), debit: 0, credit: arRefundAmount, description: `عكس ذمم مدينة - مرتجع ${params.counterParty || ''}` },
        );
        break;
      }

      case 'EXPENSE_CASH': {
        if (!params.targetAccountId) throw new Error('يجب تحديد حساب المصروف');
        const totalExpense = round2(params.amount + taxAmount - discountAmount);
        lines.push(
          { accountId: params.targetAccountId, debit: params.amount, credit: 0, description: params.description },
        );
        if (taxAmount > 0) {
          lines.push({ accountId: requireAccountId(inputTaxAccount, 'ضريبة المدخلات 1200'), debit: taxAmount, credit: 0, description: 'ضريبة مدخلات' });
        }
        if (discountAmount > 0) {
          lines.push({ accountId: requireAccountId(discountReceivedAccount, 'الخصم المكتسب 4400'), debit: 0, credit: discountAmount, description: 'خصم مكتسب' });
        }
        lines.push(
          { accountId: requireAccountId(cashAccount, 'النقدية 1000'), debit: 0, credit: totalExpense, description: 'سداد مصروفات نقدي' },
        );
        break;
      }

      case 'EXPENSE_BANK': {
        if (!params.targetAccountId) throw new Error('يجب تحديد حساب المصروف');
        const totalExpense = round2(params.amount + taxAmount - discountAmount);
        lines.push(
          { accountId: params.targetAccountId, debit: params.amount, credit: 0, description: params.description },
        );
        if (taxAmount > 0) {
          lines.push({ accountId: requireAccountId(inputTaxAccount, 'ضريبة المدخلات 1200'), debit: taxAmount, credit: 0, description: 'ضريبة مدخلات' });
        }
        if (discountAmount > 0) {
          lines.push({ accountId: requireAccountId(discountReceivedAccount, 'الخصم المكتسب 4400'), debit: 0, credit: discountAmount, description: 'خصم مكتسب' });
        }
        lines.push(
          { accountId: requireAccountId(defaultBank, 'البنك 1010'), debit: 0, credit: totalExpense, description: `سداد مصروفات بنكي - ${params.paymentMethod || ''}` },
        );
        break;
      }

      case 'EXPENSE_SADAD': {
        if (!params.targetAccountId) throw new Error('يجب تحديد حساب المصروف');
        const totalExpense = round2(params.amount + taxAmount - discountAmount);
        lines.push(
          { accountId: params.targetAccountId, debit: params.amount, credit: 0, description: params.description },
        );
        if (taxAmount > 0) {
          lines.push({ accountId: requireAccountId(inputTaxAccount, 'ضريبة المدخلات 1200'), debit: taxAmount, credit: 0, description: 'ضريبة مدخلات' });
        }
        if (discountAmount > 0) {
          lines.push({ accountId: requireAccountId(discountReceivedAccount, 'الخصم المكتسب 4400'), debit: 0, credit: discountAmount, description: 'خصم مكتسب' });
        }
        lines.push(
          { accountId: requireAccountId(defaultBank, 'البنك 1010'), debit: 0, credit: totalExpense, description: 'سداد مصروفات سداد' },
        );
        break;
      }

      case 'PURCHASE_CASH': {
        if (!params.targetAccountId) throw new Error('يجب تحديد حساب المشتريات');
        const totalPaid = round2(params.amount + taxAmount - discountAmount);
        lines.push(
          { accountId: params.targetAccountId, debit: params.amount, credit: 0, description: params.description },
        );
        if (taxAmount > 0) {
          lines.push({ accountId: requireAccountId(inputTaxAccount, 'ضريبة المدخلات 1200'), debit: taxAmount, credit: 0, description: 'ضريبة مدخلات' });
        }
        if (discountAmount > 0) {
          lines.push({ accountId: requireAccountId(discountReceivedAccount, 'الخصم المكتسب 4400'), debit: 0, credit: discountAmount, description: 'خصم مكتسب' });
        }
        lines.push(
          { accountId: requireAccountId(cashAccount, 'النقدية 1000'), debit: 0, credit: totalPaid, description: 'سداد مشتريات نقدي' },
        );
        break;
      }

      case 'PURCHASE_BANK': {
        if (!params.targetAccountId) throw new Error('يجب تحديد حساب المشتريات');
        const totalPaid = round2(params.amount + taxAmount - discountAmount);
        lines.push(
          { accountId: params.targetAccountId, debit: params.amount, credit: 0, description: params.description },
        );
        if (taxAmount > 0) {
          lines.push({ accountId: requireAccountId(inputTaxAccount, 'ضريبة المدخلات 1200'), debit: taxAmount, credit: 0, description: 'ضريبة مدخلات' });
        }
        if (discountAmount > 0) {
          lines.push({ accountId: requireAccountId(discountReceivedAccount, 'الخصم المكتسب 4400'), debit: 0, credit: discountAmount, description: 'خصم مكتسب' });
        }
        lines.push(
          { accountId: requireAccountId(defaultBank, 'البنك 1010'), debit: 0, credit: totalPaid, description: `سداد مشتريات بنكي - ${params.paymentMethod || ''}` },
        );
        break;
      }

      case 'PURCHASE_CREDIT': {
        if (!params.targetAccountId) throw new Error('يجب تحديد حساب المشتريات');
        lines.push(
          { accountId: params.targetAccountId, debit: params.amount, credit: 0, description: params.description },
        );
        if (taxAmount > 0) {
          lines.push({ accountId: requireAccountId(inputTaxAccount, 'ضريبة المدخلات 1200'), debit: taxAmount, credit: 0, description: 'ضريبة مدخلات' });
        }
        if (discountAmount > 0) {
          lines.push({ accountId: requireAccountId(discountReceivedAccount, 'الخصم المكتسب 4400'), debit: 0, credit: discountAmount, description: 'خصم مكتسب' });
        }
        const totalOwed = round2(params.amount + taxAmount - discountAmount);
        lines.push(
          { accountId: requireAccountId(suppliersAccount, 'الموردين 2000'), debit: 0, credit: totalOwed, description: 'مشتريات آجل' },
        );
        break;
      }

      // ─── PURCHASE RETURN entries (reverse of PURCHASE) ───
      case 'PURCHASE_RETURN_CASH': {
        // Reverse of PURCHASE_CASH:
        // PURCHASE: Debit expense/asset, Debit input tax, Credit discount received, Credit cash
        // RETURN:   Credit expense/asset (reduce purchase), Credit output tax (return input tax), Debit cash (get refund)
        // With discount: Debit discount received (reverse it)
        if (!params.targetAccountId) throw new Error('يجب تحديد حساب المشتريات');
        const cashRefund = round2(params.amount + taxAmount - discountAmount);
        lines.push(
          { accountId: params.targetAccountId, debit: 0, credit: params.amount, description: 'مرتجع مشتريات - تقليل المشتريات' },
        );
        if (taxAmount > 0) {
          lines.push({ accountId: requireAccountId(inputTaxAccount, 'ضريبة المدخلات 1200'), debit: 0, credit: taxAmount, description: 'مرتجع ضريبة مدخلات' });
        }
        if (discountAmount > 0) {
          lines.push({ accountId: requireAccountId(discountReceivedAccount, 'الخصم المكتسب 4400'), debit: discountAmount, credit: 0, description: 'عكس خصم مكتسب' });
        }
        lines.push(
          { accountId: requireAccountId(cashAccount, 'النقدية 1000'), debit: cashRefund, credit: 0, description: 'استرداد مرتجع نقدي' },
        );
        break;
      }

      case 'PURCHASE_RETURN_BANK': {
        // Same as PURCHASE_RETURN_CASH but refund goes to bank instead of cash
        if (!params.targetAccountId) throw new Error('يجب تحديد حساب المشتريات');
        const bankRefund = round2(params.amount + taxAmount - discountAmount);
        lines.push(
          { accountId: params.targetAccountId, debit: 0, credit: params.amount, description: 'مرتجع مشتريات - تقليل المشتريات' },
        );
        if (taxAmount > 0) {
          lines.push({ accountId: requireAccountId(inputTaxAccount, 'ضريبة المدخلات 1200'), debit: 0, credit: taxAmount, description: 'مرتجع ضريبة مدخلات' });
        }
        if (discountAmount > 0) {
          lines.push({ accountId: requireAccountId(discountReceivedAccount, 'الخصم المكتسب 4400'), debit: discountAmount, credit: 0, description: 'عكس خصم مكتسب' });
        }
        lines.push(
          { accountId: requireAccountId(defaultBank, 'البنك 1010'), debit: bankRefund, credit: 0, description: `استرداد مرتجع بنكي - ${params.paymentMethod || ''}` },
        );
        break;
      }

      case 'PURCHASE_RETURN_CREDIT': {
        // Same as PURCHASE_RETURN_CASH but reduces AP instead of getting cash/bank refund
        if (!params.targetAccountId) throw new Error('يجب تحديد حساب المشتريات');
        const apReduction = round2(params.amount + taxAmount - discountAmount);
        lines.push(
          { accountId: params.targetAccountId, debit: 0, credit: params.amount, description: 'مرتجع مشتريات - تقليل المشتريات' },
        );
        if (taxAmount > 0) {
          lines.push({ accountId: requireAccountId(inputTaxAccount, 'ضريبة المدخلات 1200'), debit: 0, credit: taxAmount, description: 'مرتجع ضريبة مدخلات' });
        }
        if (discountAmount > 0) {
          lines.push({ accountId: requireAccountId(discountReceivedAccount, 'الخصم المكتسب 4400'), debit: discountAmount, credit: 0, description: 'عكس خصم مكتسب' });
        }
        lines.push(
          { accountId: requireAccountId(suppliersAccount, 'الموردين 2000'), debit: apReduction, credit: 0, description: 'تقليل ذمم دائنة - مرتجع مشتريات آجل' },
        );
        break;
      }

      case 'COLLECTION': {
        const bankOrCash = params.paymentMethod === 'CASH' ? cashAccount : defaultBank;
        lines = [
          { accountId: requireAccountId(bankOrCash, 'البنك/النقدية'), debit: params.amount, credit: 0, description: `تحصيل من ${params.counterParty || 'عميل'}` },
          { accountId: requireAccountId(customersAccount, 'العملاء 1100'), debit: 0, credit: params.amount, description: `تحصيل ذمم مدينة - ${params.counterParty || ''}` },
        ];
        break;
      }

      case 'PAYMENT': {
        const bankOrCash2 = params.paymentMethod === 'CASH' ? cashAccount : defaultBank;
        lines = [
          { accountId: params.targetAccountId || requireAccountId(suppliersAccount, 'الموردين 2000'), debit: params.amount, credit: 0, description: `سداد ${params.description}` },
          { accountId: requireAccountId(bankOrCash2, 'البنك/النقدية'), debit: 0, credit: params.amount, description: `سداد ذمم دائنة - ${params.counterParty || ''}` },
        ];
        break;
      }

      case 'DEPOSIT': {
        lines = [
          { accountId: params.toAccountId || requireAccountId(defaultBank, 'البنك 1010'), debit: params.amount, credit: 0, description: 'إيداع في الحساب' },
          { accountId: params.fromAccountId || requireAccountId(cashAccount, 'النقدية 1000'), debit: 0, credit: params.amount, description: 'سحب من النقدية' },
        ];
        break;
      }

      case 'WITHDRAWAL': {
        const fromAccount = await tx.account.findUnique({ where: { id: params.fromAccountId || '' } });
        lines = [
          { accountId: requireAccountId(withdrawalAccount, 'المسحوبات 3001'), debit: params.amount, credit: 0, description: params.description || 'مسحوبات شخصية' },
          { accountId: params.fromAccountId || requireAccountId(cashAccount, 'النقدية 1000'), debit: 0, credit: params.amount, description: `سحب من ${fromAccount?.name || 'النقدية'}` },
        ];
        break;
      }

      case 'TRANSFER': {
        if (!params.toAccountId) throw new Error('يجب تحديد حساب التحويل إليه');
        if (!params.fromAccountId) throw new Error('يجب تحديد حساب التحويل منه');
        const toAcc = await tx.account.findUnique({ where: { id: params.toAccountId } });
        const fromAcc = await tx.account.findUnique({ where: { id: params.fromAccountId } });
        lines = [
          { accountId: requireAccountId(toAcc, 'حساب التحويل إليه'), debit: params.amount, credit: 0, description: `تحويل من ${fromAcc?.name || ''}` },
          { accountId: requireAccountId(fromAcc, 'حساب التحويل منه'), debit: 0, credit: params.amount, description: `تحويل إلى ${toAcc?.name || ''}` },
        ];
        break;
      }

      case 'MANUAL': {
        lines = params.lines || [];
        break;
      }

      case 'OPENING_BALANCE': {
        lines = params.lines || [];
        break;
      }

      default: {
        throw new Error(`نوع القيد غير صالح: "${params.type}". الأنواع المدعومة: SALE_CASH, SALE_BANK, SALE_PLATFORM, SALE_RETURN_CASH, SALE_RETURN_BANK, SALE_RETURN_PLATFORM, EXPENSE_CASH, EXPENSE_BANK, EXPENSE_SADAD, PURCHASE_CASH, PURCHASE_BANK, PURCHASE_CREDIT, PURCHASE_RETURN_CASH, PURCHASE_RETURN_BANK, PURCHASE_RETURN_CREDIT, COLLECTION, PAYMENT, DEPOSIT, WITHDRAWAL, TRANSFER, MANUAL, OPENING_BALANCE, YEAR_END_CLOSING`);
      }
    }
    } // end of else block

    // BLOCK: Prevent posting to parent accounts (accounts with children)
    // Parent/summary accounts must never receive direct journal entries.
    // Only leaf accounts should be posted to, to maintain trial balance integrity.
    for (const line of lines) {
      const accountHasChildren = await tx.account.findFirst({
        where: { parentId: line.accountId },
        select: { id: true },
      });
      if (accountHasChildren) {
        const parentAccount = await tx.account.findUnique({
          where: { id: line.accountId },
          select: { code: true, name: true },
        });
        throw new Error(
          `لا يمكن الترحيل إلى حساب أب (${parentAccount?.code || ''} - ${parentAccount?.name || ''}). ` +
          `يجب الترحيل إلى أحد الحسابات الفرعية فقط.`
        );
      }
    }

    // Validate no negative debit/credit values in lines
    for (const line of lines) {
      if (line.debit < 0 || line.credit < 0) {
        throw new Error('لا يمكن أن تكون قيمة المدين أو الدائن سالبة - يجب أن تكون قيمًا موجبة أو صفر');
      }
    }

    // For MANUAL/OPENING_BALANCE entries, recalculate netAmount from lines since params.amount may be 0/undefined
    if ((params.type === 'MANUAL' || params.type === 'OPENING_BALANCE') && netAmount === 0 && lines.length > 0) {
      netAmount = round2(lines.reduce((s, l) => round2(s + l.debit), 0));
    }

    // Validate balanced entry
    const td = round2(lines.reduce((s, l) => round2(s + l.debit), 0));
    const tc = round2(lines.reduce((s, l) => round2(s + l.credit), 0));
    if (Math.abs(td - tc) >= 0.005) {
      throw new Error(`القيد غير متوازن - المدين: ${td} والدائن: ${tc}`);
    }
    // Validate no empty accountIds
    for (const line of lines) {
      if (!line.accountId || line.accountId.trim() === '') {
        throw new Error('جميع بنود القيد يجب أن يكون لها حساب محدد');
      }
    }

    // Determine entry status:
    // - OPENING_BALANCE and all transaction types (non-MANUAL) must always be POSTED
    // - MANUAL entries can be created as DRAFT if specified
    // - DRAFT entries do NOT affect account balances
    const entryStatus: 'DRAFT' | 'POSTED' =
      params.type === 'MANUAL' && params.status === 'DRAFT'
        ? 'DRAFT'
        : 'POSTED';

    // 1. FIRST create the Transaction header record
    const transaction = await tx.transaction.create({
      data: {
        transactionNumber,
        type: txnType,
        subType: txnSubType,
        date: params.date,
        description: params.description,
        referenceCode: params.reference,
        branchId,
        customerId: params.customerId,
        supplierId: params.supplierId,
        totalAmount: params.amount,
        taxAmount,
        discountAmount,
        netAmount,
        status: entryStatus,
        paymentMethod: params.paymentMethod,
        counterParty: params.counterParty,
        invoiceNumber: params.invoiceNumber,
        parentTransactionId: params.parentTransactionId,
      },
    });

    // 2. THEN create the JournalEntry linked to that Transaction via transactionId
    const entry = await tx.journalEntry.create({
      data: {
        entryNumber,
        date: params.date,
        description: params.description,
        type: params.type,
        status: entryStatus,
        reference: params.reference,
        branchId,
        paymentMethod: params.paymentMethod,
        counterParty: params.counterParty,
        invoiceNumber: params.invoiceNumber,
        amount: params.amount,
        taxAmount,
        discountAmount,
        totalAmount: netAmount,
        customerId: params.customerId,
        supplierId: params.supplierId,
        periodId: period.id,
        groupId: transaction.transactionNumber, // backward compat: groupId = transactionNumber
        groupRole,
        transactionId: transaction.id, // link to Transaction header
        lines: {
          create: lines.map(l => ({
            accountId: l.accountId,
            debit: l.debit,
            credit: l.credit,
            description: l.description,
          })),
        },
      },
      include: { lines: { include: { account: true } } },
    });

    // Only update account balances for POSTED entries
    // DRAFT entries must have ZERO impact on account balances
    if (entryStatus === 'POSTED') {
      for (const line of entry.lines) {
        await updateAccountBalance(line.accountId, tx);
      }
    }

    return entry;
  };

  // If an external transaction client is provided, use it directly (no new transaction)
  // This avoids nested transactions and timeout issues
  if (params.tx) {
    return await executeInTransaction(params.tx);
  }

  // Otherwise, start a new transaction with an increased timeout
  return await db.$transaction(executeInTransaction, {
    maxWait: 10000,
    timeout: 20000,
  });
}

// Cancel a journal entry - WRAPPED IN $transaction for atomicity
// Also updates the Transaction status and cancels all other JEs in the same Transaction
export async function cancelJournalEntry(entryId: string): Promise<void> {
  await db.$transaction(async (tx) => {
    const entry = await tx.journalEntry.findUnique({
      where: { id: entryId },
      include: { lines: true },
    }) as any;

    if (!entry) throw new Error('القيد غير موجود');
    if (entry.status === 'CANCELLED') throw new Error('القيد ملغي بالفعل');

    // Cancel this journal entry
    await tx.journalEntry.update({
      where: { id: entryId },
      data: { status: 'CANCELLED' },
    });

    // Collect all affected account IDs for balance recalculation
    const affectedAccountIds = new Set<string>(entry.lines.map((l: any) => l.accountId));

    // If this entry belongs to a Transaction, cancel all other JEs in the same Transaction
    if (entry.transactionId) {
      // Cancel the Transaction header
      await tx.transaction.update({
        where: { id: entry.transactionId },
        data: { status: 'CANCELLED' },
      });

      // Find all other JEs in the same Transaction
      const siblingEntries = await tx.journalEntry.findMany({
        where: {
          transactionId: entry.transactionId,
          id: { not: entryId },
          status: { not: 'CANCELLED' },
        },
        include: { lines: true },
      });

      // Cancel all sibling JEs
      for (const sibling of siblingEntries) {
        await tx.journalEntry.update({
          where: { id: sibling.id },
          data: { status: 'CANCELLED' },
        });
        // Collect affected accounts from siblings too
        for (const line of sibling.lines) {
          affectedAccountIds.add(line.accountId);
        }
      }
    }

    // Recalculate all affected account balances
    for (const accountId of affectedAccountIds) {
      await updateAccountBalance(accountId, tx);
    }
  });
}

// Post a draft entry - WRAPPED IN $transaction for atomicity
// Also updates the Transaction status if all JEs in the Transaction are POSTED
export async function postJournalEntry(entryId: string): Promise<void> {
  await db.$transaction(async (tx) => {
    const entry = await tx.journalEntry.findUnique({
      where: { id: entryId },
      include: { lines: true },
    });

    if (!entry) throw new Error('القيد غير موجود');
    if (entry.status !== 'DRAFT') throw new Error('لا يمكن ترحيل قيد غير مسودة');

    await tx.journalEntry.update({
      where: { id: entryId },
      data: { status: 'POSTED' },
    });

    for (const line of entry.lines) {
      await updateAccountBalance(line.accountId, tx);
    }

    // Check if all JEs in the Transaction are now POSTED
    if (entry.transactionId) {
      const allEntries = await tx.journalEntry.findMany({
        where: { transactionId: entry.transactionId },
        select: { status: true },
      });

      const allPosted = allEntries.every(e => e.status === 'POSTED');
      if (allPosted) {
        await tx.transaction.update({
          where: { id: entry.transactionId },
          data: { status: 'POSTED' },
        });
      }
    }
  });
}

// Unpost a posted entry (return to draft) - WRAPPED IN $transaction for atomicity
// Also sets Transaction status to DRAFT
// If the entry is linked to a POS invoice, reverts the invoice to DRAFT and restores stock
export async function unpostJournalEntry(entryId: string): Promise<void> {
  await db.$transaction(async (tx) => {
    const entry = await tx.journalEntry.findUnique({
      where: { id: entryId },
      include: { lines: true },
    });

    if (!entry) throw new Error('القيد غير موجود');
    if (entry.status !== 'POSTED') throw new Error('لا يمكن إرجاع قيد غير مرحّل لمسودة');

    await tx.journalEntry.update({
      where: { id: entryId },
      data: { status: 'DRAFT' },
    });

    // Recalculate balances for all affected accounts (since this entry no longer counts)
    for (const line of entry.lines) {
      await updateAccountBalance(line.accountId, tx);
    }

    // Update Transaction status based on sibling entry statuses
    if (entry.transactionId) {
      const allEntries = await tx.journalEntry.findMany({
        where: { transactionId: entry.transactionId },
        select: { status: true },
      });

      const anyPosted = allEntries.some(e => e.status === 'POSTED');
      const allCancelled = allEntries.every(e => e.status === 'CANCELLED');

      if (allCancelled) {
        // All entries are cancelled → Transaction is cancelled
        await tx.transaction.update({
          where: { id: entry.transactionId },
          data: { status: 'CANCELLED' },
        });
      } else if (anyPosted) {
        // Some entries are still POSTED → keep Transaction as POSTED
        // Don't change Transaction status since other entries are still live
      } else {
        // No entries are POSTED, some are DRAFT → Transaction is DRAFT
        await tx.transaction.update({
          where: { id: entry.transactionId },
          data: { status: 'DRAFT' },
        });
      }
    }

    // ─── POS Invoice cascade: revert invoice status & restore stock ───
    // When a journal entry linked to a POS invoice is unposted, the POS invoice
    // should revert to DRAFT and stock should be restored (reverse the stock
    // decrement that happened during finalization).
    if (entry.invoiceNumber && entry.invoiceNumber.startsWith('POS-')) {
      const posInvoice = await tx.pOSInvoice.findUnique({
        where: { invoiceNumber: entry.invoiceNumber },
        include: {
          items: { include: { product: true } },
        },
      });

      if (posInvoice && posInvoice.status === 'FINALIZED') {
        // Revert POS invoice status to DRAFT
        await tx.pOSInvoice.update({
          where: { id: posInvoice.id },
          data: { status: 'DRAFT' },
        });

        // Restore stock for each invoice item (reverse the stock decrement)
        for (const item of posInvoice.items) {
          if (item.productId) {
            const qty = toNumber(item.quantity);
            // Increment product stock back
            await tx.product.update({
              where: { id: item.productId },
              data: { currentStock: { increment: qty } },
            });
          }
        }

        // Delete stock transactions linked to this POS invoice
        // (referenceType='POS_INVOICE', referenceId=invoiceId)
        await tx.stockTransaction.deleteMany({
          where: {
            referenceType: 'POS_INVOICE',
            referenceId: posInvoice.id,
          },
        });
      }
    }
  });
}

// Cancel ALL accounting entries for a POS invoice by invoiceNumber
// This is needed because multi-payment invoices create separate Transactions per payment method
// but only one transactionId is stored on the POSInvoice.
// This function finds and cancels ALL Transactions/JEs linked to the same invoiceNumber.
export async function cancelInvoiceAccounting(invoiceNumber: string): Promise<{ cancelledCount: number }> {
  return await db.$transaction(async (tx) => {
    // Find all Transactions with this invoiceNumber that are not already cancelled
    const transactions = await tx.transaction.findMany({
      where: {
        invoiceNumber,
        status: { not: 'CANCELLED' },
      },
      select: { id: true },
    });

    if (transactions.length === 0) {
      return { cancelledCount: 0 };
    }

    const transactionIds = transactions.map(t => t.id);

    // Find all active JEs in these Transactions
    const entries = await tx.journalEntry.findMany({
      where: {
        transactionId: { in: transactionIds },
        status: { not: 'CANCELLED' },
      },
      include: { lines: true },
    });

    // Collect all affected account IDs
    const affectedAccountIds = new Set<string>();

    // Cancel all JEs
    for (const entry of entries) {
      await tx.journalEntry.update({
        where: { id: entry.id },
        data: { status: 'CANCELLED' },
      });
      for (const line of entry.lines) {
        affectedAccountIds.add(line.accountId);
      }
    }

    // Cancel all Transaction headers
    for (const tid of transactionIds) {
      await tx.transaction.update({
        where: { id: tid },
        data: { status: 'CANCELLED' },
      });
    }

    // Recalculate all affected account balances
    for (const accountId of affectedAccountIds) {
      await updateAccountBalance(accountId, tx);
    }

    return { cancelledCount: entries.length };
  });
}

// Get customer receivables - based on Transaction records
export async function getCustomerReceivables(customerId: string): Promise<{
  totalSales: number;
  totalCollections: number;
  balance: number;
  transactions: TransactionWithEntries[];
}> {
  // Get all POSTED SALE_PLATFORM (credit) transactions for this customer
  // Only credit/platform sales create receivables — cash/bank sales are paid immediately
  const saleTransactions = await db.transaction.findMany({
    where: {
      customerId,
      type: 'SALE',
      subType: 'PLATFORM', // Only آجل (credit) sales create receivables
      status: 'POSTED',
    },
    include: {
      journalEntries: {
        include: {
          lines: { include: { account: true } },
        },
      },
      customer: true,
    },
    orderBy: { date: 'desc' },
  });

  // Get all POSTED SALE_RETURN_PLATFORM transactions for this customer (reduce receivables)
  const saleReturnTransactions = await db.transaction.findMany({
    where: {
      customerId,
      type: 'SALE_RETURN',
      subType: 'RETURN_PLATFORM',
      status: 'POSTED',
    },
    include: {
      journalEntries: {
        include: {
          lines: { include: { account: true } },
        },
      },
      customer: true,
    },
    orderBy: { date: 'desc' },
  });

  // Get all POSTED COLLECTION transactions for this customer
  const collectionTransactions = await db.transaction.findMany({
    where: {
      customerId,
      type: 'COLLECTION',
      status: 'POSTED',
    },
    include: {
      journalEntries: {
        include: {
          lines: { include: { account: true } },
        },
      },
      customer: true,
    },
    orderBy: { date: 'desc' },
  });

  const totalSales = saleTransactions.reduce((sum, t) => sum + toNumber(t.netAmount), 0);
  const totalReturns = saleReturnTransactions.reduce((sum, t) => sum + toNumber(t.netAmount), 0);
  const totalCollections = collectionTransactions.reduce((sum, t) => sum + toNumber(t.totalAmount), 0);

  // Combine all transactions (sales, returns, collections)
  const allTransactions = [...saleTransactions, ...saleReturnTransactions, ...collectionTransactions]
    .sort((a, b) => b.date.getTime() - a.date.getTime());

  const transactions: TransactionWithEntries[] = allTransactions.map(t => ({
    id: t.id,
    transactionNumber: t.transactionNumber,
    type: t.type,
    subType: t.subType || undefined,
    date: t.date.toISOString(),
    description: t.description,
    referenceCode: t.referenceCode || undefined,
    branchId: t.branchId,
    customerId: t.customerId || undefined,
    supplierId: t.supplierId || undefined,
    totalAmount: toNumber(t.totalAmount),
    taxAmount: toNumber(t.taxAmount),
    discountAmount: toNumber(t.discountAmount),
    netAmount: toNumber(t.netAmount),
    status: t.status as EntryStatus,
    paymentMethod: (t.paymentMethod as PaymentMethod) || undefined,
    counterParty: t.counterParty || undefined,
    invoiceNumber: t.invoiceNumber || undefined,
    parentTransactionId: t.parentTransactionId || undefined,
    customerName: t.customer?.name,
    journalEntries: t.journalEntries.map(je => ({
      id: je.id,
      entryNumber: je.entryNumber,
      date: je.date.toISOString(),
      description: je.description,
      type: je.type as JournalEntryType,
      status: je.status as EntryStatus,
      reference: je.reference || undefined,
      branchId: je.branchId,
      paymentMethod: (je.paymentMethod as PaymentMethod) || undefined,
      counterParty: je.counterParty || undefined,
      invoiceNumber: je.invoiceNumber || undefined,
      amount: toNumber(je.amount),
      taxAmount: toNumber(je.taxAmount),
      discountAmount: toNumber(je.discountAmount),
      totalAmount: toNumber(je.totalAmount),
      customerId: je.customerId || undefined,
      supplierId: je.supplierId || undefined,
      groupId: je.groupId || undefined,
      groupRole: je.groupRole || undefined,
      customerName: t.customer?.name,
      lines: je.lines.map(l => ({
        id: l.id,
        accountId: l.accountId,
        accountCode: l.account.code,
        accountName: l.account.name,
        debit: toNumber(l.debit),
        credit: toNumber(l.credit),
        description: l.description || undefined,
      })),
      createdAt: je.createdAt.toISOString(),
    })),
    createdAt: t.createdAt.toISOString(),
  }));

  return {
    totalSales,
    totalCollections,
    balance: totalSales - totalReturns - totalCollections,
    transactions,
  };
}

// Get supplier payables - based on Transaction records
export async function getSupplierPayables(supplierId: string): Promise<{
  totalPurchases: number;
  totalReturns: number;
  totalPayments: number;
  balance: number;
  transactions: TransactionWithEntries[];
}> {
  // Get all POSTED PURCHASE_CREDIT (آجل) transactions for this supplier
  // Only credit purchases create payables — cash/bank purchases are paid immediately
  const purchaseTransactions = await db.transaction.findMany({
    where: {
      supplierId,
      type: 'PURCHASE',
      subType: 'CREDIT', // Only آجل (credit) purchases create payables
      status: 'POSTED',
    },
    include: {
      journalEntries: {
        include: {
          lines: { include: { account: true } },
        },
      },
      supplier: true,
    },
    orderBy: { date: 'desc' },
  });

  // Get all POSTED PAYMENT transactions for this supplier
  const paymentTransactions = await db.transaction.findMany({
    where: {
      supplierId,
      type: 'PAYMENT',
      status: 'POSTED',
    },
    include: {
      journalEntries: {
        include: {
          lines: { include: { account: true } },
        },
      },
      supplier: true,
    },
    orderBy: { date: 'desc' },
  });

  // Get all POSTED PURCHASE_RETURN transactions for this supplier
  const returnTransactions = await db.transaction.findMany({
    where: {
      supplierId,
      type: 'PURCHASE_RETURN',
      status: 'POSTED',
    },
    include: {
      journalEntries: {
        include: {
          lines: { include: { account: true } },
        },
      },
      supplier: true,
    },
    orderBy: { date: 'desc' },
  });

  const totalPurchases = purchaseTransactions.reduce((sum, t) => sum + toNumber(t.netAmount), 0);
  const totalPayments = paymentTransactions.reduce((sum, t) => sum + toNumber(t.totalAmount), 0);
  const totalReturns = returnTransactions.reduce((sum, t) => sum + toNumber(t.netAmount), 0);

  // Combine all transactions
  const allTransactions = [...purchaseTransactions, ...paymentTransactions, ...returnTransactions]
    .sort((a, b) => b.date.getTime() - a.date.getTime());

  const transactions: TransactionWithEntries[] = allTransactions.map(t => ({
    id: t.id,
    transactionNumber: t.transactionNumber,
    type: t.type,
    subType: t.subType || undefined,
    date: t.date.toISOString(),
    description: t.description,
    referenceCode: t.referenceCode || undefined,
    branchId: t.branchId,
    customerId: t.customerId || undefined,
    supplierId: t.supplierId || undefined,
    totalAmount: toNumber(t.totalAmount),
    taxAmount: toNumber(t.taxAmount),
    discountAmount: toNumber(t.discountAmount),
    netAmount: toNumber(t.netAmount),
    status: t.status as EntryStatus,
    paymentMethod: (t.paymentMethod as PaymentMethod) || undefined,
    counterParty: t.counterParty || undefined,
    invoiceNumber: t.invoiceNumber || undefined,
    parentTransactionId: t.parentTransactionId || undefined,
    supplierName: t.supplier?.name,
    journalEntries: t.journalEntries.map(je => ({
      id: je.id,
      entryNumber: je.entryNumber,
      date: je.date.toISOString(),
      description: je.description,
      type: je.type as JournalEntryType,
      status: je.status as EntryStatus,
      reference: je.reference || undefined,
      branchId: je.branchId,
      paymentMethod: (je.paymentMethod as PaymentMethod) || undefined,
      counterParty: je.counterParty || undefined,
      invoiceNumber: je.invoiceNumber || undefined,
      amount: toNumber(je.amount),
      taxAmount: toNumber(je.taxAmount),
      discountAmount: toNumber(je.discountAmount),
      totalAmount: toNumber(je.totalAmount),
      customerId: je.customerId || undefined,
      supplierId: je.supplierId || undefined,
      groupId: je.groupId || undefined,
      groupRole: je.groupRole || undefined,
      supplierName: t.supplier?.name,
      lines: je.lines.map(l => ({
        id: l.id,
        accountId: l.accountId,
        accountCode: l.account.code,
        accountName: l.account.name,
        debit: toNumber(l.debit),
        credit: toNumber(l.credit),
        description: l.description || undefined,
      })),
      createdAt: je.createdAt.toISOString(),
    })),
    createdAt: t.createdAt.toISOString(),
  }));

  return {
    totalPurchases,
    totalReturns,
    totalPayments,
    balance: totalPurchases - totalReturns - totalPayments,
    transactions,
  };
}

// Get trial balance data
// IMPORTANT: The trial balance MUST include ALL accounts that have journal line activity,
// regardless of whether they are parent or leaf accounts. Excluding parent accounts
// that have direct journal lines would cause the trial balance to be imbalanced
// (total debits ≠ total credits), which violates the fundamental rule of double-entry bookkeeping.
export async function getTrialBalance(dateFrom?: Date, dateTo?: Date) {
  // AUDIT-9-18 (Phase 18): Replaced `include: { journalLines: {...} }` (which loads
  // EVERY journal line for EVERY account into Node memory) with a single
  // `db.journalLine.groupBy({ by: ['accountId'], _sum: { debit, credit } })`.
  // For a DB with 100k+ journal lines across 200 accounts, this changes the
  // payload from ~100k rows → ~200 aggregated rows. Same response shape.
  const [accounts, lineAgg] = await Promise.all([
    db.account.findMany({
      where: { isActive: true },
      orderBy: { code: 'asc' },
      select: { id: true, code: true, name: true, type: true, parentId: true },
    }),
    db.journalLine.groupBy({
      by: ['accountId'],
      _sum: { debit: true, credit: true },
      where: {
        journalEntry: {
          status: 'POSTED',
          ...(dateFrom || dateTo ? {
            date: {
              ...(dateFrom ? { gte: dateFrom } : {}),
              ...(dateTo ? { lte: dateTo } : {}),
            },
          } : {}),
        },
      },
    }),
  ]);

  // Build lookup map of accountId → { totalDebit, totalCredit }
  const balanceMap = new Map<string, { totalDebit: number; totalCredit: number }>();
  for (const row of lineAgg) {
    balanceMap.set(row.accountId, {
      totalDebit: toNumber(row._sum.debit),
      totalCredit: toNumber(row._sum.credit),
    });
  }

  // Identify parent accounts (accounts that have children)
  const parentIds = new Set(accounts.filter(a => a.parentId).map(a => a.parentId!));

  return accounts
    .filter(a => {
      // Always include leaf accounts (accounts that are not parents)
      if (!parentIds.has(a.id)) return true;
      // Include parent accounts ONLY if they have direct journal line activity.
      // Parent accounts without activity are pure summary accounts and should
      // not appear in the trial balance to avoid double-counting with their children.
      const hasActivity = balanceMap.has(a.id);
      return hasActivity;
    })
    .map(account => {
      const normalBalance = NORMAL_BALANCE[account.type as AccountType];
      const totals = balanceMap.get(account.id) || { totalDebit: 0, totalCredit: 0 };
      const totalDebit = totals.totalDebit;
      const totalCredit = totals.totalCredit;

      let netBalance: number;
      if (normalBalance === 'DEBIT') {
        netBalance = totalDebit - totalCredit;
      } else {
        netBalance = totalCredit - totalDebit;
      }

      let trialDebit = 0;
      let trialCredit = 0;
      if (netBalance >= 0) {
        if (normalBalance === 'DEBIT') trialDebit = netBalance;
        else trialCredit = netBalance;
      } else {
        if (normalBalance === 'DEBIT') trialCredit = Math.abs(netBalance);
        else trialDebit = Math.abs(netBalance);
      }

      // Determine the actual balance nature (debit or credit side)
      const balanceNature = netBalance >= 0 ? normalBalance : (normalBalance === 'DEBIT' ? 'CREDIT' : 'DEBIT');
      const isAbnormal = netBalance < 0;

      return {
        accountCode: account.code,
        accountName: account.name,
        accountType: account.type as AccountType,
        totalDebit: trialDebit,
        totalCredit: trialCredit,
        netBalance,
        normalSide: normalBalance,
        balanceNature,
        isAbnormal,
      };
    });
}

// Get ledger entries for a specific account
export async function getLedger(
  accountId: string,
  dateFrom?: Date,
  dateTo?: Date
) {
  const account = await db.account.findUnique({ where: { id: accountId } });
  if (!account) throw new Error('الحساب غير موجود');

  const lines = await db.journalLine.findMany({
    where: {
      accountId,
      journalEntry: {
        status: 'POSTED',
        ...(dateFrom || dateTo ? {
          date: {
            ...(dateFrom ? { gte: dateFrom } : {}),
            ...(dateTo ? { lte: dateTo } : {}),
          },
        } : {}),
      },
    },
    include: { journalEntry: true },
    orderBy: { journalEntry: { date: 'asc' } },
  });

  let balance = 0;
  const normalBalance = NORMAL_BALANCE[account.type as AccountType];

  return lines.map(line => {
    const debit = toNumber(line.debit);
    const credit = toNumber(line.credit);
    if (normalBalance === 'DEBIT') {
      balance += debit - credit;
    } else {
      balance += credit - debit;
    }
    return {
      date: line.journalEntry.date.toISOString(),
      entryNumber: line.journalEntry.entryNumber,
      description: line.journalEntry.description,
      debit,
      credit,
      balance,
      type: line.journalEntry.type as JournalEntryType,
      reference: line.journalEntry.reference,
      groupId: line.journalEntry.groupId,
    };
  });
}

// Get income statement data
export async function getIncomeStatement(dateFrom?: Date, dateTo?: Date) {
  // IMPORTANT: Include ALL active accounts, not just leaf accounts.
  // Prisma's include: { journalLines } only fetches lines where accountId matches
  // the account's own id — it does NOT recursively include children's lines.
  // The previous leaf-only filter incorrectly excluded parent accounts that had
  // journal lines posted directly to them, causing missing expense/revenue data.
  // Each account only counts its OWN journal lines, so there is no double-counting.
  //
  // AUDIT-9-18 (Phase 18): Replaced `include: { journalLines: {...} }` (loads every
  // journal line for every revenue/expense account into memory) with a single
  // `db.journalLine.groupBy({ by: ['accountId'], _sum: { debit, credit } })`.
  // Same response shape; ~1000x less data transferred from DB for large datasets.

  const journalEntryWhere = {
    status: 'POSTED' as const,
    ...(dateFrom || dateTo ? {
      date: {
        ...(dateFrom ? { gte: dateFrom } : {}),
        ...(dateTo ? { lte: dateTo } : {}),
      },
    } : {}),
  };

  const [revenueAccounts, expenseAccounts, revenueLineAgg, expenseLineAgg] = await Promise.all([
    db.account.findMany({
      where: { type: 'REVENUE', isActive: true },
      select: { id: true, code: true, name: true },
    }),
    db.account.findMany({
      where: { type: 'EXPENSE', isActive: true },
      select: { id: true, code: true, name: true },
    }),
    db.journalLine.groupBy({
      by: ['accountId'],
      _sum: { debit: true, credit: true },
      where: {
        account: { type: 'REVENUE', isActive: true },
        journalEntry: journalEntryWhere,
      },
    }),
    db.journalLine.groupBy({
      by: ['accountId'],
      _sum: { debit: true, credit: true },
      where: {
        account: { type: 'EXPENSE', isActive: true },
        journalEntry: journalEntryWhere,
      },
    }),
  ]);

  const revenueMap = new Map<string, { debit: number; credit: number }>();
  for (const row of revenueLineAgg) {
    revenueMap.set(row.accountId, {
      debit: toNumber(row._sum.debit),
      credit: toNumber(row._sum.credit),
    });
  }
  const expenseMap = new Map<string, { debit: number; credit: number }>();
  for (const row of expenseLineAgg) {
    expenseMap.set(row.accountId, {
      debit: toNumber(row._sum.debit),
      credit: toNumber(row._sum.credit),
    });
  }

  const revenue = revenueAccounts
    .map(account => {
      const totals = revenueMap.get(account.id) || { debit: 0, credit: 0 };
      return {
        accountCode: account.code,
        accountName: account.name,
        amount: totals.credit - totals.debit,
      };
    });

  const expenses = expenseAccounts
    .map(account => {
      const totals = expenseMap.get(account.id) || { debit: 0, credit: 0 };
      return {
        accountCode: account.code,
        accountName: account.name,
        amount: totals.debit - totals.credit,
      };
    });

  const totalRevenue = revenue.reduce((sum, r) => sum + r.amount, 0);
  const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);

  // Separate COGS from other expenses for proper income statement format:
  // Revenue - COGS = Gross Profit - Other Expenses = Net Income
  const cogsAccounts = expenses.filter(e => e.accountCode === '5950');
  const otherExpenses = expenses.filter(e => e.accountCode !== '5950');
  const totalCOGS = cogsAccounts.reduce((sum, e) => sum + e.amount, 0);
  const totalOtherExpenses = otherExpenses.reduce((sum, e) => sum + e.amount, 0);
  const grossProfit = totalRevenue - totalCOGS;

  return {
    revenue,
    totalRevenue,
    cogs: cogsAccounts,
    totalCOGS,
    grossProfit,
    otherExpenses,
    totalOtherExpenses,
    expenses,
    totalExpenses,
    netIncome: totalRevenue - totalExpenses,
  };
}

// Get dashboard data - uses Transaction-based data where appropriate
export async function getDashboardData() {
  const allAccounts = await db.account.findMany({ where: { isActive: true } });

  // Batch: get all balances in a single query
  const balances = await getAllAccountBalances();

  let totalRevenue = 0, totalExpenses = 0, totalAssets = 0, totalLiabilities = 0;
  let cashBalance = 0, accountsReceivable = 0, accountsPayable = 0;

  for (const account of allAccounts) {
    const balance = balances.get(account.id) || 0;
    switch (account.type) {
      case 'REVENUE': totalRevenue += balance; break;
      case 'EXPENSE': totalExpenses += balance; break;
      case 'ASSET': totalAssets += balance; break;
      case 'LIABILITY': totalLiabilities += balance; break;
    }
    if (['1000', '1010', '1020'].includes(account.code)) cashBalance += balance;
    if (account.code === '1100') accountsReceivable = balance;
    if (account.code === '2000') accountsPayable = balance;
  }

  // Use Transaction-based data for recent transactions when available,
  // fall back to JournalEntry-based queries for legacy data
  const transactionCount = await db.transaction.count();
  let recentTransactionsList: {
    id: string; entryNumber: string; date: string;
    description: string; type: JournalEntryType;
    status: EntryStatus; branchId: string;
    paymentMethod: PaymentMethod; counterParty: string | null;
    invoiceNumber: string | null; amount: number;
    taxAmount: number; discountAmount: number;
    totalAmount: number;
    groupId: string | null;
    lines: { id: string; accountId: string; accountCode: string; accountName: string; debit: number; credit: number; description: string | null }[];
    createdAt: string;
  }[] = [];

  if (transactionCount > 0) {
    // Transaction-based query (new data)
    const recentTxns = await db.transaction.findMany({
      where: { status: 'POSTED' },
      include: {
        journalEntries: {
          include: {
            lines: { include: { account: true } },
          },
        },
        customer: true,
        supplier: true,
      },
      orderBy: { date: 'desc' },
      take: 10,
    });

    recentTransactionsList = recentTxns.flatMap(t =>
      t.journalEntries.map(e => ({
        id: e.id, entryNumber: e.entryNumber, date: e.date.toISOString(),
        description: e.description, type: e.type as JournalEntryType,
        status: e.status as EntryStatus, branchId: e.branchId,
        paymentMethod: e.paymentMethod as PaymentMethod, counterParty: e.counterParty,
        invoiceNumber: e.invoiceNumber, amount: toNumber(e.amount),
        taxAmount: toNumber(e.taxAmount), discountAmount: toNumber(e.discountAmount),
        totalAmount: toNumber(e.totalAmount),
        groupId: e.groupId,
        lines: e.lines.map(l => ({
          id: l.id, accountId: l.accountId, accountCode: l.account.code,
          accountName: l.account.name, debit: toNumber(l.debit), credit: toNumber(l.credit),
          description: l.description,
        })),
        createdAt: e.createdAt.toISOString(),
      }))
    );
  } else {
    // Legacy fallback - query JournalEntries directly
    const recentEntries = await db.journalEntry.findMany({
      where: { status: 'POSTED' },
      include: { lines: { include: { account: true } } },
      orderBy: { date: 'desc' },
      take: 10,
    });

    recentTransactionsList = recentEntries.map(e => ({
      id: e.id, entryNumber: e.entryNumber, date: e.date.toISOString(),
      description: e.description, type: e.type as JournalEntryType,
      status: e.status as EntryStatus, branchId: e.branchId,
      paymentMethod: e.paymentMethod as PaymentMethod, counterParty: e.counterParty,
      invoiceNumber: e.invoiceNumber, amount: toNumber(e.amount),
      taxAmount: toNumber(e.taxAmount), discountAmount: toNumber(e.discountAmount),
      totalAmount: toNumber(e.totalAmount),
      groupId: e.groupId,
      lines: e.lines.map(l => ({
        id: l.id, accountId: l.accountId, accountCode: l.account.code,
        accountName: l.account.name, debit: toNumber(l.debit), credit: toNumber(l.credit),
        description: l.description,
      })),
      createdAt: e.createdAt.toISOString(),
    }));
  }

  const chinaTownSales = await db.account.findFirst({ where: { code: '4100' }, select: { id: true, code: true } });
  const palaceIndiaSales = await db.account.findFirst({ where: { code: '4200' }, select: { id: true, code: true } });
  const platformSales = await db.account.findFirst({ where: { code: '4300' }, select: { id: true, code: true } });

  const revenueByBranch = [
    { branch: 'China Town', amount: chinaTownSales ? (balances.get(chinaTownSales.id) || 0) : 0 },
    { branch: 'Palace India', amount: palaceIndiaSales ? (balances.get(palaceIndiaSales.id) || 0) : 0 },
    { branch: 'منصات', amount: platformSales ? (balances.get(platformSales.id) || 0) : 0 },
  ];

  // Expense breakdown: use Transaction-based data when available, account balances as fallback.
  // AUDIT-9-18 (Phase 18): Replaced `findMany` (loads ALL expense transactions into memory
  // for in-memory reduce) with a single `groupBy({ by: ['description'], _sum: { netAmount } })`.
  // Same response shape; O(unique-descriptions) instead of O(all-transactions).
  const expensesByCategory: { category: string; amount: number }[] = [];

  if (transactionCount > 0) {
    const expenseAgg = await db.transaction.groupBy({
      by: ['description'],
      _sum: { netAmount: true },
      where: { type: 'EXPENSE', status: 'POSTED' },
    });
    for (const row of expenseAgg) {
      const netAmt = toNumber(row._sum.netAmount);
      if (netAmt > 0 && row.description) {
        expensesByCategory.push({ category: row.description, amount: netAmt });
      }
    }
  }

  // Also include expense accounts that have balances but no Transaction record (legacy data)
  const expenseAccounts = allAccounts.filter(a => a.type === 'EXPENSE');
  for (const acc of expenseAccounts) {
    const bal = balances.get(acc.id) || 0;
    if (bal > 0 && !expensesByCategory.find(e => e.category === acc.name)) {
      expensesByCategory.push({ category: acc.name, amount: bal });
    }
  }

  return {
    totalRevenue, totalExpenses, netIncome: totalRevenue - totalExpenses,
    totalAssets, totalLiabilities, cashBalance, accountsReceivable, accountsPayable,
    recentTransactions: recentTransactionsList,
    revenueByBranch, expensesByCategory, monthlyRevenue: [],
  };
}

// Year-end closing: close revenue and expense accounts into Retained Earnings
// This is essential for the balance sheet to balance correctly
export async function performYearEndClosing(params: {
  closingDate: Date;
  retainedEarningsAccountId?: string; // defaults to account 3100
}): Promise<{ closedRevenue: number; closedExpenses: number; netIncome: number; retainedEarningsUpdate: number }> {
  return await db.$transaction(async (tx) => {
    // Year-end closing is a system-level entry — use the default active branch
    const branchId = await getDefaultBranchId();

    // Get all revenue and expense accounts
    const revenueAccounts = await tx.account.findMany({
      where: { type: 'REVENUE', isActive: true },
      select: { id: true, code: true, name: true, currentBalance: true },
    });

    const expenseAccounts = await tx.account.findMany({
      where: { type: 'EXPENSE', isActive: true },
      select: { id: true, code: true, name: true, currentBalance: true },
    });

    // Get retained earnings account (3100)
    const retainedEarnings = params.retainedEarningsAccountId
      ? await tx.account.findUnique({ where: { id: params.retainedEarningsAccountId } })
      : await tx.account.findFirst({ where: { code: '3100' } });

    if (!retainedEarnings) {
      throw new Error('حساب الأرباح المحتجزة (3100) غير موجود. يجب تهيئة شجرة الحسابات أولاً.');
    }

    const entryNumber = await generateEntryNumber(tx);
    const transactionNumber = await generateTransactionNumber(tx);

    // Get or create fiscal period
    let period = await tx.fiscalPeriod.findFirst({ where: { status: 'OPEN' } });
    if (!period) {
      period = await tx.fiscalPeriod.create({
        data: {
          name: 'الفترة الحالية',
          startDate: new Date(new Date().getFullYear(), 0, 1),
          endDate: new Date(new Date().getFullYear(), 11, 31),
          status: 'OPEN',
        },
      });
    }

    // Build closing entry lines
    const lines: { accountId: string; debit: number; credit: number; description?: string }[] = [];
    let totalRevenueClosed = 0;
    let totalExpensesClosed = 0;

    // Close revenue accounts: debit each revenue account to zero, credit Retained Earnings
    for (const account of revenueAccounts) {
      // Get actual balance from journal lines (not cached currentBalance)
      const balance = await getAccountBalance(account.id, tx);
      if (Math.abs(balance) > 0.01) {
        // Revenue has credit normal balance → to close it, we debit it
        lines.push({
          accountId: account.id,
          debit: balance, // debit to zero out the credit balance
          credit: 0,
          description: `إقفال ${account.name}`,
        });
        totalRevenueClosed += balance;
      }
    }

    // Close expense accounts: credit each expense account to zero, debit Retained Earnings
    for (const account of expenseAccounts) {
      const balance = await getAccountBalance(account.id, tx);
      if (Math.abs(balance) > 0.01) {
        // Expense has debit normal balance → to close it, we credit it
        lines.push({
          accountId: account.id,
          debit: 0,
          credit: balance, // credit to zero out the debit balance
          description: `إقفال ${account.name}`,
        });
        totalExpensesClosed += balance;
      }
    }

    // Net income = total revenue - total expenses
    const netIncome = totalRevenueClosed - totalExpensesClosed;

    // Retained Earnings entry: if net income is positive (profit), credit RE; if negative (loss), debit RE
    if (Math.abs(netIncome) > 0.01) {
      if (netIncome > 0) {
        // Profit → credit Retained Earnings
        lines.push({
          accountId: retainedEarnings.id,
          debit: 0,
          credit: netIncome,
          description: `ترحيل صافي الربح إلى الأرباح المحتجزة`,
        });
      } else {
        // Loss → debit Retained Earnings
        lines.push({
          accountId: retainedEarnings.id,
          debit: Math.abs(netIncome),
          credit: 0,
          description: `ترحيل صافي الخسارة إلى الأرباح المحتجزة`,
        });
      }
    }

    // Validate balanced entry
    const td = lines.reduce((s, l) => s + l.debit, 0);
    const tc = lines.reduce((s, l) => s + l.credit, 0);
    if (Math.abs(td - tc) >= 0.01) {
      throw new Error(`قيد الإقفال غير متوازن - المدين: ${td} والدائن: ${tc}`);
    }

    if (lines.length === 0) {
      return { closedRevenue: 0, closedExpenses: 0, netIncome: 0, retainedEarningsUpdate: 0 };
    }

    // Create Transaction header
    const transaction = await tx.transaction.create({
      data: {
        transactionNumber,
        type: 'YEAR_END_CLOSING',
        subType: null,
        date: params.closingDate,
        description: `قيد إقفال سنوي - ترحيل الأرباح المحتجزة`,
        branchId,
        totalAmount: totalExpensesClosed,
        taxAmount: 0,
        discountAmount: 0,
        netAmount: netIncome,
        status: 'POSTED',
      },
    });

    // Create Journal Entry
    const entry = await tx.journalEntry.create({
      data: {
        entryNumber,
        date: params.closingDate,
        description: `قيد إقفال سنوي - ترحيل الأرباح المحتجزة`,
        type: 'YEAR_END_CLOSING',
        status: 'POSTED',
        branchId,
        amount: netIncome,
        taxAmount: 0,
        discountAmount: 0,
        totalAmount: netIncome,
        periodId: period.id,
        groupId: transaction.transactionNumber,
        groupRole: 'PRIMARY',
        transactionId: transaction.id,
        lines: {
          create: lines.map(l => ({
            accountId: l.accountId,
            debit: l.debit,
            credit: l.credit,
            description: l.description,
          })),
        },
      },
      include: { lines: { include: { account: true } } },
    });

    // Update all affected account balances
    for (const line of entry.lines) {
      await updateAccountBalance(line.accountId, tx);
    }

    return {
      closedRevenue: totalRevenueClosed,
      closedExpenses: totalExpensesClosed,
      netIncome,
      retainedEarningsUpdate: netIncome,
    };
  }, {
    maxWait: 10000,
    timeout: 30000,
  });
}
