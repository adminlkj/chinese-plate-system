// Default Chart of Accounts Seed Data
// Professional Saudi restaurant accounting structure with:
// - Fixed Assets & Depreciation tracking
// - Expandable bank accounts (parent/child)
// - Customer sub-ledger (cash vs platform)
// - Supplier sub-ledger (local vs platform)
// - Current Year P&L separate from Retained Earnings
import { db } from './db';

interface DefaultAccount {
  code: string;
  name: string;
  nameEn: string;
  type: string;
  level: number;
  isSystem: boolean;
  parentId?: string;
  /**
   * Branch code that owns this account.
   * - 'NONE'  → shared/system account, assigned to the MAIN branch
   * - 'CHINA_TOWN' → owned by the China Town branch
   * - 'PALACE_INDIA' → owned by the Palace India branch
   * Resolved to a branchId (UUID) at seed time.
   */
  branch?: string;
  isActive?: boolean;
  isComputed?: boolean;
  computedSource?: string;
}

export const DEFAULT_ACCOUNTS: DefaultAccount[] = [
  // ===== ASSETS (1xxx) =====
  // branch: 'NONE' = shared/grouping accounts (not branch-specific)
  { code: '1000', name: 'النقدية', nameEn: 'Cash', type: 'ASSET', level: 1, isSystem: true, branch: 'NONE' },

  // Bank Accounts — Parent + Children (expandable structure)
  // 1010 is a PARENT account — do NOT post directly. Post to 1011, 1012, etc.
  { code: '1010', name: 'الحسابات البنكية', nameEn: 'Bank Accounts', type: 'ASSET', level: 1, isSystem: true, branch: 'NONE' },
  { code: '1011', name: 'بنك الراجحي - الرئيسي', nameEn: 'Al Rajhi Bank - Main', type: 'ASSET', parentId: '1010', level: 2, isSystem: true, branch: 'NONE' },
  { code: '1012', name: 'بنك الراجحي - الفرعي', nameEn: 'Al Rajhi Bank - Sub', type: 'ASSET', parentId: '1010', level: 2, isSystem: true, branch: 'NONE' },
  { code: '1013', name: 'بنك الأهلي', nameEn: 'Al Ahli Bank (NCB)', type: 'ASSET', parentId: '1010', level: 2, isSystem: false, branch: 'NONE' },
  { code: '1014', name: 'بنك الإنماء', nameEn: 'Al Inma Bank', type: 'ASSET', parentId: '1010', level: 2, isSystem: false, branch: 'NONE' },

  // Customers (AR) — Parent + Children (sub-ledger structure)
  // 1100 is a PARENT account — do NOT post directly. Post to 1101, 1102, etc.
  { code: '1100', name: 'العملاء', nameEn: 'Customers (AR)', type: 'ASSET', level: 1, isSystem: true, branch: 'NONE' },
  { code: '1101', name: 'عملاء نقديين', nameEn: 'Cash Customers', type: 'ASSET', parentId: '1100', level: 2, isSystem: true, branch: 'NONE' },
  { code: '1102', name: 'عملاء منصات', nameEn: 'Platform Customers', type: 'ASSET', parentId: '1100', level: 2, isSystem: true, branch: 'NONE' },

  { code: '1200', name: 'ضريبة مدخلات', nameEn: 'Input Tax', type: 'ASSET', level: 1, isSystem: true, branch: 'NONE' },
  { code: '1300', name: 'المخزون', nameEn: 'Inventory', type: 'ASSET', level: 1, isSystem: true, branch: 'NONE' },

  // Fixed Assets — Parent + Children
  // 1400 is a PARENT account — do NOT post directly. Post to 1410, 1420, etc.
  { code: '1400', name: 'الأصول الثابتة', nameEn: 'Fixed Assets', type: 'ASSET', level: 1, isSystem: true, branch: 'NONE' },
  { code: '1410', name: 'معدات مطبخ', nameEn: 'Kitchen Equipment', type: 'ASSET', parentId: '1400', level: 2, isSystem: true, branch: 'NONE' },
  { code: '1420', name: 'أثاث', nameEn: 'Furniture', type: 'ASSET', parentId: '1400', level: 2, isSystem: true, branch: 'NONE' },
  { code: '1430', name: 'أجهزة حاسب', nameEn: 'Computer Equipment', type: 'ASSET', parentId: '1400', level: 2, isSystem: true, branch: 'NONE' },
  { code: '1440', name: 'مركبات', nameEn: 'Vehicles', type: 'ASSET', parentId: '1400', level: 2, isSystem: false, branch: 'NONE' },

  // Accumulated Depreciation — Contra Asset (ASSET type with credit normal balance)
  // 1490 is a PARENT account — do NOT post directly. Post to 1491, 1492, etc.
  // NOTE: These are ASSET accounts but their balance increases on the CREDIT side.
  // In the balance sheet, they are presented as deductions from the related fixed assets.
  { code: '1490', name: 'مجمع الإهلاك', nameEn: 'Accumulated Depreciation', type: 'ASSET', level: 1, isSystem: true, branch: 'NONE' },
  { code: '1491', name: 'مجمع إهلاك معدات مطبخ', nameEn: 'Accum. Depr. - Kitchen Equipment', type: 'ASSET', parentId: '1490', level: 2, isSystem: true, branch: 'NONE' },
  { code: '1492', name: 'مجمع إهلاك أثاث', nameEn: 'Accum. Depr. - Furniture', type: 'ASSET', parentId: '1490', level: 2, isSystem: true, branch: 'NONE' },
  { code: '1493', name: 'مجمع إهلاك أجهزة حاسب', nameEn: 'Accum. Depr. - Computer Equipment', type: 'ASSET', parentId: '1490', level: 2, isSystem: true, branch: 'NONE' },
  { code: '1494', name: 'مجمع إهلاك مركبات', nameEn: 'Accum. Depr. - Vehicles', type: 'ASSET', parentId: '1490', level: 2, isSystem: false, branch: 'NONE' },

  // ===== LIABILITIES (2xxx) =====
  // Suppliers (AP) — Parent + Children (sub-ledger structure)
  // 2000 is a PARENT account — do NOT post directly. Post to 2001, 2002, etc.
  { code: '2000', name: 'الموردون', nameEn: 'Suppliers (AP)', type: 'LIABILITY', level: 1, isSystem: true, branch: 'NONE' },
  { code: '2001', name: 'موردين محليين', nameEn: 'Local Suppliers', type: 'LIABILITY', parentId: '2000', level: 2, isSystem: true, branch: 'NONE' },
  { code: '2002', name: 'موردين منصات', nameEn: 'Platform Suppliers', type: 'LIABILITY', parentId: '2000', level: 2, isSystem: true, branch: 'NONE' },

  { code: '2100', name: 'ضريبة مخرجات', nameEn: 'Output Tax', type: 'LIABILITY', level: 1, isSystem: true, branch: 'NONE' },
  { code: '2200', name: 'رواتب مستحقة', nameEn: 'Salaries Payable', type: 'LIABILITY', level: 1, isSystem: true, branch: 'NONE' },
  { code: '2300', name: 'ذمم دائنة أخرى', nameEn: 'Other Payables', type: 'LIABILITY', level: 1, isSystem: true, branch: 'NONE' },
  { code: '2400', name: 'مصروفات مستحقة', nameEn: 'Expenses Payable', type: 'LIABILITY', level: 1, isSystem: true, branch: 'NONE' },
  { code: '2500', name: 'دفوعات حكومية مستحقة', nameEn: 'Government Payments Payable', type: 'LIABILITY', level: 1, isSystem: true, branch: 'NONE' },
  { code: '2600', name: 'ضريبة مستحقة', nameEn: 'Tax Payable', type: 'LIABILITY', level: 1, isSystem: true, branch: 'NONE' },

  // ===== EQUITY (3xxx) =====
  { code: '3000', name: 'رأس المال', nameEn: 'Capital', type: 'EQUITY', level: 1, isSystem: true, branch: 'NONE' },
  { code: '3001', name: 'مسحوبات شخصية', nameEn: 'Personal Withdrawals', type: 'EQUITY', level: 1, isSystem: true, branch: 'NONE' },
  { code: '3100', name: 'أرباح (خسائر) محتجزة', nameEn: 'Retained Earnings', type: 'EQUITY', level: 1, isSystem: true, branch: 'NONE' },
  // Current Year P&L — separate from retained earnings for proper year-end closing
  // At year-end, this account's balance gets transferred to 3100 (Retained Earnings)
  { code: '3200', name: 'أرباح وخسائر السنة الحالية', nameEn: 'Current Year P&L', type: 'EQUITY', level: 1, isSystem: true, branch: 'NONE' },

  // ===== REVENUE (4xxx) =====
  // 4000 is the parent/summary account — it should NOT receive direct journal lines.
  // All sales postings go to leaf accounts: 4100/4200 (branch), 4300 (platform).
  // Branch sales accounts are sub-accounts under المبيعات, linked to their branch.
  { code: '4000', name: 'المبيعات', nameEn: 'Sales', type: 'REVENUE', level: 1, isSystem: true, branch: 'NONE' },
  { code: '4100', name: 'مبيعات China Town', nameEn: 'China Town Sales', type: 'REVENUE', parentId: '4000', level: 2, branch: 'CHINA_TOWN', isSystem: true },
  { code: '4200', name: 'مبيعات Palace India', nameEn: 'Palace India Sales', type: 'REVENUE', parentId: '4000', level: 2, branch: 'PALACE_INDIA', isSystem: true },
  { code: '4300', name: 'مبيعات منصات', nameEn: 'Platform Sales', type: 'REVENUE', parentId: '4000', level: 2, isSystem: true, branch: 'NONE' },
  { code: '4400', name: 'خصم مكتسب', nameEn: 'Discount Received', type: 'REVENUE', level: 1, isSystem: false, branch: 'NONE' },
  // Other Revenue — for inventory surplus and miscellaneous income
  { code: '4900', name: 'إيرادات أخرى', nameEn: 'Other Revenue', type: 'REVENUE', level: 1, isSystem: true, branch: 'NONE' },

  // ===== EXPENSES (5xxx–7xxx) =====
  // 5000 is the parent/summary account — it should NOT receive direct journal lines.
  // All purchase postings go to leaf accounts: 5001 (direct), 5100/5200/5300 (specific).
  { code: '5000', name: 'المشتريات', nameEn: 'Purchases', type: 'EXPENSE', level: 1, isSystem: true, branch: 'NONE' },
  { code: '5001', name: 'مشتريات عامة', nameEn: 'General Purchases', type: 'EXPENSE', parentId: '5000', level: 2, isSystem: true, branch: 'NONE' },
  { code: '5100', name: 'مواد خام', nameEn: 'Raw Materials', type: 'EXPENSE', parentId: '5000', level: 2, isSystem: true, branch: 'NONE' },
  { code: '5200', name: 'أدوات مطبخ', nameEn: 'Kitchen Tools', type: 'EXPENSE', parentId: '5000', level: 2, isSystem: true, branch: 'NONE' },
  { code: '5300', name: 'مستلزمات مكتبية', nameEn: 'Office Supplies', type: 'EXPENSE', parentId: '5000', level: 2, isSystem: true, branch: 'NONE' },

  { code: '5400', name: 'إنترنت', nameEn: 'Internet', type: 'EXPENSE', level: 1, isSystem: true, branch: 'NONE' },
  { code: '5500', name: 'مياه', nameEn: 'Water', type: 'EXPENSE', level: 1, isSystem: true, branch: 'NONE' },
  { code: '5600', name: 'كهرباء', nameEn: 'Electricity', type: 'EXPENSE', level: 1, isSystem: true, branch: 'NONE' },
  { code: '5700', name: 'مصروفات أخرى', nameEn: 'Other Expenses', type: 'EXPENSE', level: 1, isSystem: true, branch: 'NONE' },
  { code: '5800', name: 'خصم مسموح به', nameEn: 'Discount Allowed', type: 'EXPENSE', level: 1, isSystem: true, branch: 'NONE' },
  { code: '5900', name: 'إيجار', nameEn: 'Rent', type: 'EXPENSE', level: 1, isSystem: true, branch: 'NONE' },
  { code: '5950', name: 'تكلفة البضاعة المباعة', nameEn: 'Cost of Goods Sold', type: 'EXPENSE', level: 1, isSystem: true, branch: 'NONE' },
  { code: '6000', name: 'تسويق', nameEn: 'Marketing', type: 'EXPENSE', level: 1, isSystem: true, branch: 'NONE' },
  { code: '6100', name: 'رواتب', nameEn: 'Salaries', type: 'EXPENSE', level: 1, isSystem: true, branch: 'NONE' },
  { code: '6200', name: 'اشتراكات', nameEn: 'Subscriptions', type: 'EXPENSE', level: 1, isSystem: true, branch: 'NONE' },
  { code: '6300', name: 'حكومية', nameEn: 'Government Fees', type: 'EXPENSE', level: 1, isSystem: true, branch: 'NONE' },
  { code: '6400', name: 'نقل', nameEn: 'Transport', type: 'EXPENSE', level: 1, isSystem: true, branch: 'NONE' },
  { code: '6500', name: 'رسوم تحويل', nameEn: 'Transfer Fees', type: 'EXPENSE', level: 1, isSystem: true, branch: 'NONE' },
  { code: '6600', name: 'فوائد بنكية', nameEn: 'Bank Interest', type: 'EXPENSE', level: 1, isSystem: true, branch: 'NONE' },
  { code: '6700', name: 'صيانة', nameEn: 'Maintenance', type: 'EXPENSE', level: 1, isSystem: true, branch: 'NONE' },
  { code: '6800', name: 'استقدام', nameEn: 'Recruitment', type: 'EXPENSE', level: 1, isSystem: true, branch: 'NONE' },
  { code: '6900', name: 'خدمات مقيمين', nameEn: 'Resident Services', type: 'EXPENSE', level: 1, isSystem: true, branch: 'NONE' },
  { code: '7000', name: 'تأمينات', nameEn: 'Insurance', type: 'EXPENSE', level: 1, isSystem: true, branch: 'NONE' },
  { code: '7100', name: 'تأمين طبي', nameEn: 'Medical Insurance', type: 'EXPENSE', level: 1, isSystem: true, branch: 'NONE' },
  { code: '7200', name: 'بدلات', nameEn: 'Allowances', type: 'EXPENSE', level: 1, isSystem: true, branch: 'NONE' },
  { code: '7300', name: 'حوافز ومكافآت', nameEn: 'Incentives & Bonuses', type: 'EXPENSE', level: 1, isSystem: true, branch: 'NONE' },
  // Depreciation Expense
  { code: '7400', name: 'مصروف الإهلاك', nameEn: 'Depreciation Expense', type: 'EXPENSE', level: 1, isSystem: true, branch: 'NONE' },

  // ===== LEGACY MIGRATION — Old 1020 account =====
  // 1020 was a standalone bank account. Now it's migrated under 1010 as a child (1012).
  // This entry ensures the old account gets updated with the correct parentId.
  // It is marked inactive to prevent new postings — use 1012 instead.
  { code: '1020', name: 'بنك الراجحي فرعي (قديم)', nameEn: 'Al Rajhi Bank - Sub (Legacy)', type: 'ASSET', parentId: '1010', level: 2, isSystem: true, isActive: false, branch: 'NONE' },
];

// Seed default accounts - WRAPPED IN $transaction for atomicity
// All accounts must be created together or none at all
export async function seedDefaultAccounts() {
  const codeToIdMap = new Map<string, string>();

  await db.$transaction(async (tx) => {
    // ─── STEP 1: Seed branches first so we can resolve branch codes to UUIDs ───
    const branchDefs = [
      { code: 'MAIN', name: 'الفرع الرئيسي', nameEn: 'Main Branch', sortOrder: 0 },
      { code: 'CHINA_TOWN', name: 'تشاينا تاون', nameEn: 'China Town', sortOrder: 1 },
      { code: 'PALACE_INDIA', name: 'بالاس إنديا', nameEn: 'Palace India', sortOrder: 2 },
    ];

    const branchIdByCode: Record<string, string> = {};
    for (const def of branchDefs) {
      const branch = await tx.branch.upsert({
        where: { code: def.code },
        update: { name: def.name, nameEn: def.nameEn, sortOrder: def.sortOrder },
        create: def,
      });
      branchIdByCode[def.code] = branch.id;
    }

    // Helper: resolve a branch code from DefaultAccount.branch to a branchId UUID.
    // - 'NONE' or undefined → MAIN branch (shared/system accounts)
    // - 'CHINA_TOWN' / 'PALACE_INDIA' → that branch's UUID
    const resolveAccountBranchId = (code?: string): string => {
      const c = (code || 'NONE').trim();
      if (c === 'NONE' || !c) return branchIdByCode['MAIN'];
      if (branchIdByCode[c]) return branchIdByCode[c];
      // Unknown code — fall back to MAIN
      return branchIdByCode['MAIN'];
    };

    // ─── STEP 2: Seed accounts, resolving branch code → branchId ───
    for (const accountData of DEFAULT_ACCOUNTS) {
      const parentId = accountData.parentId ? codeToIdMap.get(accountData.parentId) : null;
      const branchId = resolveAccountBranchId(accountData.branch);

      const account = await tx.account.upsert({
        where: { code: accountData.code },
        update: {
          name: accountData.name,
          nameEn: accountData.nameEn || null,
          type: accountData.type,
          level: accountData.level,
          isSystem: accountData.isSystem || false,
          isActive: accountData.isActive !== undefined ? accountData.isActive : true,
          // Update parentId for migrated accounts (e.g., 1020 → under 1010)
          ...(parentId ? { parentId } : {}),
          // Always re-link to the correct branch
          branchId,
        },
        create: {
          code: accountData.code,
          name: accountData.name,
          nameEn: accountData.nameEn || null,
          type: accountData.type,
          parentId: parentId,
          branchId,
          level: accountData.level,
          isSystem: accountData.isSystem || false,
          isComputed: accountData.isComputed || false,
          computedSource: accountData.computedSource || null,
          openingBalance: 0,
          currentBalance: 0,
          isActive: accountData.isActive !== undefined ? accountData.isActive : true,
        },
      });

      codeToIdMap.set(accountData.code, account.id);
    }

    // ─── MIGRATION: Deactivate old standalone 1020 and move under 1010 ───
    const old1020 = await tx.account.findFirst({ where: { code: '1020' } });
    if (old1020 && !old1020.parentId) {
      const parent1010 = await tx.account.findFirst({ where: { code: '1010' } });
      if (parent1010) {
        await tx.account.update({
          where: { id: old1020.id },
          data: {
            parentId: parent1010.id,
            level: 2,
            isActive: false,
            name: 'بنك الراجحي فرعي (قديم)',
            nameEn: 'Al Rajhi Bank - Sub (Legacy)',
          },
        });
      }
    }

    // ─── MIGRATION: Ensure 1010 is now a parent account (rename if still old name) ───
    const bank1010 = await tx.account.findFirst({ where: { code: '1010' } });
    if (bank1010 && bank1010.name === 'بنك الراجحي رئيسي') {
      await tx.account.update({
        where: { id: bank1010.id },
        data: {
          name: 'الحسابات البنكية',
          nameEn: 'Bank Accounts',
        },
      });
    }

    // ─── MIGRATION: Ensure 1100 is a parent (update level if needed) ───
    const customers1100 = await tx.account.findFirst({ where: { code: '1100' } });
    if (customers1100 && !customers1100.parentId) {
      // Already a top-level account, just ensure it stays as parent
      // Children will be created by the upsert above
    }

    // ─── MIGRATION: Ensure 2000 is a parent ───
    const suppliers2000 = await tx.account.findFirst({ where: { code: '2000' } });
    if (suppliers2000 && !suppliers2000.parentId) {
      // Already a top-level account, just ensure it stays as parent
    }
  });

  return { seeded: true, count: DEFAULT_ACCOUNTS.length };
}
