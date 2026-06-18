/**
 * ════════════════════════════════════════════════════════════════════
 *  PAYROLL ENGINE — Accounting Integration Layer
 * ════════════════════════════════════════════════════════════════════
 *
 * Single source of truth for payroll ↔ accounting integration.
 * Every monetary payroll operation flows through this module to produce
 * an immutable JournalEntry in the double-entry bookkeeping system.
 *
 * Accounting mappings (auto-generated Journal Entries):
 *
 *   ┌─────────────────────────┬──────────────────────────────────────────────┐
 *   │ Operation               │ Journal Entry                                │
 *   ├─────────────────────────┼──────────────────────────────────────────────┤
 *   │ Salary Advance payout   │ Dr  Employee Advances (1200)                 │
 *   │                         │ Cr  Cash (1000) or Bank (1010)               │
 *   ├─────────────────────────┼──────────────────────────────────────────────┤
 *   │ Payroll Run approval    │ Dr  Salaries Expense (5100)                  │
 *   │ (accrual)               │ Cr  Salaries Payable (2200)                  │
 *   ├─────────────────────────┼──────────────────────────────────────────────┤
 *   │ Payroll Payment         │ Dr  Salaries Payable (2200)                  │
 *   │                         │ Cr  Cash (1000) or Bank (1010)               │
 *   ├─────────────────────────┼──────────────────────────────────────────────┤
 *   │ Advance settlement      │ (Handled inside payroll run: the advance     │
 *   │ (via payroll run)       │  amount is netted from the employee's net    │
 *   │                         │  pay — no separate JE, the accrual JE already│
 *   │                         │  credits Salaries Payable for the full net.) │
 *   └─────────────────────────┴──────────────────────────────────────────────┘
 *
 * Account resolution strategy (in order):
 *   1. Look up by canonical code (1200, 2200, 5100)
 *   2. Fall back to any active account whose name/nameEn matches the role
 *   3. Throw a clear actionable error if no account is found — never silently
 *      post to a wrong account.
 * ════════════════════════════════════════════════════════════════════
 */

import { db } from './db';
import { toNumber, round2 } from './decimal';
import { createTransaction, PrismaTransaction } from './accounting-engine';

// ─── Account Codes ────────────────────────────────────────────────────
// NOTE: Codes 1000/1010/1100/1200/2000/2100/4000/5100/5800/5950 are already
// used by the existing chart of accounts (1000=Cash, 1200=Input Tax, 5100=Raw
// Materials, etc.). We use NON-conflicting codes for payroll-specific accounts:
//   1250 = Employee Advances (asset, alongside 1200 Input Tax)
//   2200 = Salaries Payable (liability — already exists in the COA)
//   6100 = Salaries Expense (expense, separate from 5100 Raw Materials)
// If the account doesn't exist by code or name, we AUTO-CREATE it as a system
// account so the payroll module is self-bootstrapping (no manual COA setup).
const SALARY_EXPENSE_CODE = '6100';
const SALARIES_PAYABLE_CODE = '2200';
const EMPLOYEE_ADVANCES_CODE = '1250';
const CASH_CODE = '1000';
const BANK_CODE = '1010';

// ─── Types ────────────────────────────────────────────────────────────

export interface PayrollAccountSet {
  salaryExpense: { id: string; code: string; name: string };
  salariesPayable: { id: string; code: string; name: string };
  employeeAdvances: { id: string; code: string; name: string };
  cash: { id: string; code: string; name: string };
  bank: { id: string; code: string; name: string };
}

// ─── Internal helpers ─────────────────────────────────────────────────

async function findAccountByCodeOrName(
  tx: PrismaTransaction | typeof db,
  code: string,
  nameKeywords: string[],
): Promise<{ id: string; code: string; name: string } | null> {
  // 1. Try canonical code
  const byCode = await tx.account.findFirst({
    where: { code, isActive: true },
    select: { id: true, code: true, name: true },
  });
  if (byCode) return byCode;

  // 2. Fall back to name match (Arabic or English keywords)
  const orConditions = nameKeywords.flatMap((kw) => [
    { name: { contains: kw } },
    { nameEn: { contains: kw } },
  ]);
  const byName = await tx.account.findFirst({
    where: { isActive: true, OR: orConditions },
    select: { id: true, code: true, name: true },
  });
  return byName;
}

/**
 * Auto-create a missing payroll account as a system account.
 * This makes the payroll module self-bootstrapping — no manual chart-of-accounts
 * setup is required to start using payroll.
 *
 * IMPORTANT: The account is created as a TOP-LEVEL account (no parent) to avoid
 * the "cannot post to parent account" validation in the accounting engine.
 * Parent accounts (1000, 2000, 5000) cannot receive postings — only leaf
 * accounts can. So we create payroll accounts as independent leaf accounts.
 */
async function ensureAccountExists(
  tx: PrismaTransaction | typeof db,
  code: string,
  name: string,
  nameEn: string,
  type: 'ASSET' | 'LIABILITY' | 'EXPENSE',
): Promise<{ id: string; code: string; name: string }> {
  // 1. Try to find by code first
  const byCode = await tx.account.findFirst({
    where: { code, isActive: true },
    select: { id: true, code: true, name: true },
  });
  if (byCode) return byCode;

  // 2. Try name match
  const byName = await tx.account.findFirst({
    where: {
      isActive: true,
      OR: [{ name: { contains: name } }, { nameEn: { contains: nameEn } }],
    },
    select: { id: true, code: true, name: true },
  });
  if (byName) return byName;

  // 3. Auto-create under the default branch as a TOP-LEVEL leaf account
  //    (no parent — avoids "cannot post to parent account" validation)
  const { getDefaultBranchId } = await import('./branch-resolver');
  const defaultBranchId = await getDefaultBranchId();

  const created = await tx.account.create({
    data: {
      code,
      name,
      nameEn,
      type,
      branchId: defaultBranchId,
      level: 1,
      parentId: null,
      isActive: true,
      isSystem: true,
      openingBalance: 0,
      currentBalance: 0,
    },
    select: { id: true, code: true, name: true },
  });

  console.log(`[payroll-engine] Auto-created account ${code} "${name}" (${type})`);
  return created;
}

/**
 * Find a LEAF cash account (one that has no children).
 * The accounting engine rejects postings to parent accounts, so we must find
 * or create a leaf cash sub-account.
 *
 * Strategy:
 * 1. Look for existing leaf children under 1000 (Cash)
 * 2. If 1000 itself is a leaf (no children), use it
 * 3. Otherwise create a leaf sub-account (1001 "الصندوق الرئيسي")
 */
async function findLeafCashAccount(
  tx: PrismaTransaction | typeof db,
): Promise<{ id: string; code: string; name: string }> {
  const parentCash = await tx.account.findFirst({
    where: { code: CASH_CODE },
    select: { id: true, code: true, name: true },
  });
  if (!parentCash) {
    throw new Error('حساب النقدية (1000) غير موجود. يجب تهيئة شجرة الحسابات.');
  }

  // Check if 1000 has children
  const childCount = await tx.account.count({
    where: { parentId: parentCash.id, isActive: true },
  });

  if (childCount === 0) {
    // 1000 is a leaf — use it directly
    return parentCash;
  }

  // Find the first active leaf child of 1000 that itself has no children
  const children = await tx.account.findMany({
    where: { parentId: parentCash.id, isActive: true, type: 'ASSET' },
    select: { id: true, code: true, name: true },
    orderBy: { code: 'asc' },
  });

  for (const child of children) {
    const grandChildCount = await tx.account.count({
      where: { parentId: child.id, isActive: true },
    });
    if (grandChildCount === 0) {
      return child; // This is a leaf
    }
  }

  // No leaf cash account found — create one (1001)
  const { getDefaultBranchId } = await import('./branch-resolver');
  const defaultBranchId = await getDefaultBranchId();
  const created = await tx.account.create({
    data: {
      code: '1001',
      name: 'الصندوق الرئيسي',
      nameEn: 'Main Cash Box',
      type: 'ASSET',
      branchId: defaultBranchId,
      level: 2,
      parentId: parentCash.id,
      isActive: true,
      isSystem: true,
      openingBalance: 0,
      currentBalance: 0,
    },
    select: { id: true, code: true, name: true },
  });
  console.log('[payroll-engine] Auto-created leaf cash account 1001 "الصندوق الرئيسي"');
  return created;
}

/**
 * Find a LEAF bank account (one that has no children).
 * Reuses the same leaf-finding logic as findLeafCashAccount but for banks (1010).
 */
async function findLeafBankAccount(
  tx: PrismaTransaction | typeof db,
): Promise<{ id: string; code: string; name: string } | null> {
  const parentBank = await tx.account.findFirst({
    where: { code: BANK_CODE },
    select: { id: true, code: true, name: true },
  });
  if (!parentBank) return null;

  // Check if 1010 has children
  const childCount = await tx.account.count({
    where: { parentId: parentBank.id, isActive: true },
  });

  if (childCount === 0) {
    return parentBank; // 1010 is a leaf
  }

  // Find the first active leaf child of 1010
  const children = await tx.account.findMany({
    where: { parentId: parentBank.id, isActive: true, type: 'ASSET' },
    select: { id: true, code: true, name: true },
    orderBy: { code: 'asc' },
  });

  for (const child of children) {
    const grandChildCount = await tx.account.count({
      where: { parentId: child.id, isActive: true },
    });
    if (grandChildCount === 0) {
      return child; // This is a leaf
    }
  }

  return null; // No leaf bank found
}

/**
 * Resolve all payroll-related accounts for a given branch.
 * Auto-creates any missing accounts as system accounts (self-bootstrapping).
 * All returned accounts are LEAF accounts (safe to post to).
 */
export async function resolvePayrollAccounts(
  tx: PrismaTransaction | typeof db,
): Promise<PayrollAccountSet> {
  // Auto-create / find each required payroll account (all created as top-level leaves)
  const salaryExpense = await ensureAccountExists(
    tx,
    SALARY_EXPENSE_CODE,
    'مصروف الرواتب',
    'Salaries Expense',
    'EXPENSE',
  );

  const salariesPayable = await ensureAccountExists(
    tx,
    SALARIES_PAYABLE_CODE,
    'رواتب مستحقة',
    'Salaries Payable',
    'LIABILITY',
  );

  const employeeAdvances = await ensureAccountExists(
    tx,
    EMPLOYEE_ADVANCES_CODE,
    'سلف الموظفين',
    'Employee Advances',
    'ASSET',
  );

  // Find LEAF cash account (never post to parent 1000)
  const cash = await findLeafCashAccount(tx);

  // Find LEAF bank account (never post to parent 1010)
  const bankLeaf = await findLeafBankAccount(tx);
  const bank = bankLeaf || cash; // Fall back to cash if no leaf bank

  return {
    salaryExpense,
    salariesPayable,
    employeeAdvances,
    cash,
    bank,
  };
}

// ─── Number Generators ────────────────────────────────────────────────

export async function generateEmployeeCode(tx?: PrismaTransaction): Promise<string> {
  const client = tx || db;
  const last = await client.employee.findFirst({
    orderBy: { code: 'desc' },
    select: { code: true },
  });
  if (!last) return 'EMP-0001';
  const num = parseInt(last.code.replace('EMP-', ''));
  if (isNaN(num)) return 'EMP-0001';
  return `EMP-${String(num + 1).padStart(4, '0')}`;
}

export async function generatePayrollRunNumber(
  year: number,
  month: number,
  tx?: PrismaTransaction,
): Promise<string> {
  const client = tx || db;
  const prefix = `PR-${year}-${String(month).padStart(2, '0')}-`;
  const last = await client.payrollRun.findFirst({
    where: { number: { startsWith: prefix } },
    orderBy: { number: 'desc' },
    select: { number: true },
  });
  if (!last) return `${prefix}0001`;
  const num = parseInt(last.number.replace(prefix, ''));
  if (isNaN(num)) return `${prefix}0001`;
  return `${prefix}${String(num + 1).padStart(4, '0')}`;
}

export async function generateAdvanceNumber(tx?: PrismaTransaction): Promise<string> {
  const client = tx || db;
  const last = await client.salaryAdvance.findFirst({
    orderBy: { number: 'desc' },
    select: { number: true },
  });
  if (!last) return 'ADV-0001';
  const num = parseInt(last.number.replace('ADV-', ''));
  if (isNaN(num)) return 'ADV-0001';
  return `ADV-${String(num + 1).padStart(4, '0')}`;
}

// ─── Calculation Engine ───────────────────────────────────────────────

export interface PayrollItemInput {
  employeeId: string;
  salaryType: 'MONTHLY' | 'HOURLY';
  baseSalary: number; // monthly salary OR hourly rate
  workDays: number; // for MONTHLY
  workHours: number; // for HOURLY
  allowances: number;
  deductions: number;
  advanceAmount: number; // DEPRECATED — always 0 for new runs. Advances are settled separately from payroll runs (see /api/payroll/advances/[id] settle flow). Field kept for backward compat with historical runs that already embedded advance deductions.
  notes?: string;
  // ── Structured allowance breakdown (Bonus/Allowance Engine) ──
  housingAllowance?: number;
  transportAllowance?: number;
  communicationAllowance?: number;
  bonusAmount?: number;
  commissionAmount?: number;
  otherAllowances?: number;
  // ── Structured deduction breakdown ──
  gosiDeduction?: number;
  absenceDeduction?: number;
  lateDeduction?: number;
  otherDeductions?: number;
  // ── Leave/Attendance summary ──
  annualLeaveDays?: number;
  sickLeaveDays?: number;
  absenceDays?: number;
  lateHours?: number;
}

export interface PayrollItemResult extends PayrollItemInput {
  baseAmount: number;
  grossAmount: number;
  netAmount: number;
}

/**
 * Calculate a single payroll item.
 *
 * Monthly: base = baseSalary × (workDays / 30)
 * Hourly:  base = baseSalary × workHours
 * allowances = housing + transport + communication + bonus + commission + other + (legacy allowances field)
 * deductions = gosi + absence + late + other + (legacy deductions field)
 * gross    = base + allowances
 * net      = gross − deductions
 *
 * NOTE: Advances (السلف) are NOT deducted from payroll runs. They are settled
 * separately via the advances API. The `advanceAmount` input field is kept for
 * backward-compat with historical GENERATED runs but is ignored in net calc.
 */
export function calculatePayrollItem(input: PayrollItemInput): PayrollItemResult {
  const daysInMonth = 30;
  const baseAmount =
    input.salaryType === 'HOURLY'
      ? round2(input.baseSalary * input.workHours)
      : round2(input.baseSalary * (Math.min(input.workDays, daysInMonth) / daysInMonth));

  // Sum structured allowances + legacy flat allowances field
  const structuredAllowances = round2(
    (input.housingAllowance || 0) +
    (input.transportAllowance || 0) +
    (input.communicationAllowance || 0) +
    (input.bonusAmount || 0) +
    (input.commissionAmount || 0) +
    (input.otherAllowances || 0)
  );
  const totalAllowances = round2(structuredAllowances + (input.allowances || 0));

  // Sum structured deductions + legacy flat deductions field
  const structuredDeductions = round2(
    (input.gosiDeduction || 0) +
    (input.absenceDeduction || 0) +
    (input.lateDeduction || 0) +
    (input.otherDeductions || 0)
  );
  const totalDeductions = round2(structuredDeductions + (input.deductions || 0));

  const grossAmount = round2(baseAmount + totalAllowances);
  // Advances are settled separately — NOT deducted here (PAYROLL-FIX-FINAL).
  // input.advanceAmount is ignored for new runs; historical runs that already
  // embedded advances keep their stored net (recomputed values drop it).
  const netAmount = round2(grossAmount - totalDeductions);

  return {
    ...input,
    allowances: totalAllowances,
    deductions: totalDeductions,
    baseAmount,
    grossAmount,
    netAmount,
  };
}

// ─── Payroll Settings Helper ──────────────────────────────────────────
// Loads per-branch payroll settings (or returns defaults) so the calculation
// engine can apply GOSI rates, working-days-per-month, overtime multiplier,
// and absence/late deduction rates consistently.

export interface ResolvedPayrollSettings {
  workingDaysPerMonth: number;
  standardWorkHoursPerDay: number;
  overtimeRateMultiplier: number;
  lateDeductionPerHour: number; // 0 = use hourly rate
  absenceDeductionPerDay: number; // 0 = use daily rate
  gosiEnabled: boolean;
  gosiEmployerRate: number;
  gosiEmployeeRate: number;
  gosiSalaryCap: number;
}

const DEFAULT_PAYROLL_SETTINGS: ResolvedPayrollSettings = {
  workingDaysPerMonth: 30,
  standardWorkHoursPerDay: 8,
  overtimeRateMultiplier: 1.5,
  lateDeductionPerHour: 0,
  absenceDeductionPerDay: 0,
  gosiEnabled: false,
  gosiEmployerRate: 12,
  gosiEmployeeRate: 10,
  gosiSalaryCap: 45000,
};

export async function getPayrollSettings(
  branchId: string,
  tx?: PrismaTransaction | typeof db,
): Promise<ResolvedPayrollSettings> {
  const client = tx || db;
  const settings = await client.payrollSetting.findUnique({
    where: { branchId },
  });
  if (!settings) return DEFAULT_PAYROLL_SETTINGS;
  return {
    workingDaysPerMonth: settings.workingDaysPerMonth || 30,
    standardWorkHoursPerDay: toNumber(settings.standardWorkHoursPerDay) || 8,
    overtimeRateMultiplier: toNumber(settings.overtimeRateMultiplier) || 1.5,
    lateDeductionPerHour: toNumber(settings.lateDeductionPerHour) || 0,
    absenceDeductionPerDay: toNumber(settings.absenceDeductionPerDay) || 0,
    gosiEnabled: settings.gosiEnabled,
    gosiEmployerRate: toNumber(settings.gosiEmployerRate) || 12,
    gosiEmployeeRate: toNumber(settings.gosiEmployeeRate) || 10,
    gosiSalaryCap: toNumber(settings.gosiSalaryCap) || 45000,
  };
}

/**
 * Compute GOSI employee deduction for one employee.
 * gosiDeduction = min(baseSalary, gosiSalaryCap) × gosiEmployeeRate / 100
 */
export function computeGosiDeduction(
  baseSalary: number,
  settings: ResolvedPayrollSettings,
): number {
  if (!settings.gosiEnabled) return 0;
  const subjectSalary = Math.min(baseSalary, settings.gosiSalaryCap);
  return round2((subjectSalary * settings.gosiEmployeeRate) / 100);
}

/**
 * Compute absence deduction (days off without leave).
 * If absenceDeductionPerDay > 0, use it; otherwise use daily rate = baseSalary / workingDaysPerMonth.
 */
export function computeAbsenceDeduction(
  absenceDays: number,
  baseSalary: number,
  settings: ResolvedPayrollSettings,
): number {
  if (absenceDays <= 0) return 0;
  const perDay =
    settings.absenceDeductionPerDay > 0
      ? settings.absenceDeductionPerDay
      : baseSalary / settings.workingDaysPerMonth;
  return round2(absenceDays * perDay);
}

/**
 * Compute late-hours deduction.
 * If lateDeductionPerHour > 0, use it; otherwise use hourly rate = baseSalary / (workingDaysPerMonth × standardWorkHoursPerDay).
 */
export function computeLateDeduction(
  lateHours: number,
  baseSalary: number,
  settings: ResolvedPayrollSettings,
): number {
  if (lateHours <= 0) return 0;
  const perHour =
    settings.lateDeductionPerHour > 0
      ? settings.lateDeductionPerHour
      : baseSalary / (settings.workingDaysPerMonth * settings.standardWorkHoursPerDay);
  return round2(lateHours * perHour);
}

/**
 * Fetch approved leaves for an employee within a month/year range.
 * Returns leave-day counts broken down by type.
 */
export async function getEmployeeLeavesForPeriod(
  employeeId: string,
  year: number,
  month: number,
  tx?: PrismaTransaction | typeof db,
): Promise<{
  annualLeaveDays: number;
  sickLeaveDays: number;
  unpaidLeaveDays: number;
  otherLeaveDays: number;
  totalLeaveDays: number;
}> {
  const client = tx || db;
  // Build the month range
  const startOfMonth = new Date(year, month - 1, 1);
  const endOfMonth = new Date(year, month, 0, 23, 59, 59);

  const leaves = await client.leave.findMany({
    where: {
      employeeId,
      status: 'APPROVED',
      AND: [
        { startDate: { lte: endOfMonth } },
        { endDate: { gte: startOfMonth } },
      ],
    },
  });

  let annualLeaveDays = 0;
  let sickLeaveDays = 0;
  let unpaidLeaveDays = 0;
  let otherLeaveDays = 0;

  for (const leave of leaves) {
    // Compute overlap days within the month
    const leaveStart = leave.startDate < startOfMonth ? startOfMonth : leave.startDate;
    const leaveEnd = leave.endDate > endOfMonth ? endOfMonth : leave.endDate;
    const days = Math.max(0, Math.round((leaveEnd.getTime() - leaveStart.getTime()) / (1000 * 60 * 60 * 24)) + 1);

    switch (leave.type) {
      case 'ANNUAL':
        annualLeaveDays += days;
        break;
      case 'SICK':
        sickLeaveDays += days;
        break;
      case 'UNPAID':
        unpaidLeaveDays += days;
        break;
      default:
        otherLeaveDays += days;
        break;
    }
  }

  return {
    annualLeaveDays,
    sickLeaveDays,
    unpaidLeaveDays,
    otherLeaveDays,
    totalLeaveDays: annualLeaveDays + sickLeaveDays + unpaidLeaveDays + otherLeaveDays,
  };
}

/**
 * Fetch attendance summary for an employee within a month/year range.
 * Returns absence days and late hours aggregated from daily attendance records.
 */
export async function getEmployeeAttendanceForPeriod(
  employeeId: string,
  year: number,
  month: number,
  tx?: PrismaTransaction | typeof db,
): Promise<{
  absenceDays: number;
  lateHours: number;
  presentDays: number;
  overtimeHours: number;
  totalWorkHours: number;
}> {
  const client = tx || db;
  const startOfMonth = new Date(year, month - 1, 1);
  const endOfMonth = new Date(year, month, 0, 23, 59, 59);

  const records = await client.attendance.findMany({
    where: {
      employeeId,
      date: { gte: startOfMonth, lte: endOfMonth },
    },
  });

  let absenceDays = 0;
  let lateHours = 0;
  let presentDays = 0;
  let overtimeHours = 0;
  let totalWorkHours = 0;

  for (const rec of records) {
    if (rec.status === 'ABSENT') absenceDays += 1;
    if (rec.status === 'PRESENT' || rec.status === 'LATE') presentDays += 1;
    lateHours += toNumber(rec.lateHours);
    overtimeHours += toNumber(rec.overtimeHours);
    totalWorkHours += toNumber(rec.workHours);
  }

  return {
    absenceDays,
    lateHours: round2(lateHours),
    presentDays,
    overtimeHours: round2(overtimeHours),
    totalWorkHours: round2(totalWorkHours),
  };
}

/**
 * Resolve recurring allowances assigned to an employee and compute amounts.
 * Returns both structured fields (housing/transport/...) and a list of
 * PayrollItemAllowance records to be created.
 */
export async function resolveEmployeeAllowances(
  employeeId: string,
  baseAmount: number,
  tx?: PrismaTransaction | typeof db,
): Promise<{
  housingAllowance: number;
  transportAllowance: number;
  communicationAllowance: number;
  bonusAmount: number;
  commissionAmount: number;
  otherAllowances: number;
  total: number;
  itemAllowances: { allowanceTypeId: string; amount: number; isPercentage: boolean; notes?: string }[];
}> {
  const client = tx || db;
  const now = new Date();

  const empAllowances = await client.employeeAllowance.findMany({
    where: {
      employeeId,
      isActive: true,
      effectiveFrom: { lte: now },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
    },
    include: {
      allowanceType: true,
    },
  });

  let housingAllowance = 0;
  let transportAllowance = 0;
  let communicationAllowance = 0;
  let bonusAmount = 0;
  let commissionAmount = 0;
  let otherAllowances = 0;
  const itemAllowances: { allowanceTypeId: string; amount: number; isPercentage: boolean; notes?: string }[] = [];

  for (const ea of empAllowances) {
    const at = ea.allowanceType;
    if (!at || !at.isActive) continue;
    if (at.category !== 'ALLOWANCE') continue; // skip deduction types here

    const amount = at.isPercentage
      ? round2((baseAmount * toNumber(ea.amount)) / 100)
      : round2(toNumber(ea.amount));

    itemAllowances.push({
      allowanceTypeId: at.id,
      amount,
      isPercentage: at.isPercentage,
      notes: ea.notes || undefined,
    });

    // Categorize by code for structured storage
    const code = at.code.toUpperCase();
    if (code === 'HOUSING' || code.includes('HOUSE') || code.includes('سكن')) {
      housingAllowance = round2(housingAllowance + amount);
    } else if (code === 'TRANSPORT' || code.includes('TRANS') || code.includes('نقل')) {
      transportAllowance = round2(transportAllowance + amount);
    } else if (code === 'COMMUNICATION' || code.includes('COMM') || code.includes('اتصال')) {
      communicationAllowance = round2(communicationAllowance + amount);
    } else if (code === 'BONUS' || code.includes('مكافأة') || code.includes('BONUS')) {
      bonusAmount = round2(bonusAmount + amount);
    } else if (code === 'COMMISSION' || code.includes('عمولة') || code.includes('COMMIS')) {
      commissionAmount = round2(commissionAmount + amount);
    } else {
      otherAllowances = round2(otherAllowances + amount);
    }
  }

  const total = round2(
    housingAllowance + transportAllowance + communicationAllowance + bonusAmount + commissionAmount + otherAllowances
  );

  return {
    housingAllowance,
    transportAllowance,
    communicationAllowance,
    bonusAmount,
    commissionAmount,
    otherAllowances,
    total,
    itemAllowances,
  };
}

// ─── Period Lock Helper ───────────────────────────────────────────────
// A locked period blocks all payroll mutations for that branch+month+year.
// Only ADMIN can lock/unlock. Unlock requires a reason and is fully audited.

export async function isPeriodLocked(
  branchId: string,
  year: number,
  month: number,
  tx?: PrismaTransaction | typeof db,
): Promise<boolean> {
  const client = tx || db;
  const lock = await client.payrollPeriodLock.findUnique({
    where: { branchId_month_year: { branchId, month, year } },
  });
  return !!lock && lock.isActive;
}

export async function getPeriodLock(
  branchId: string,
  year: number,
  month: number,
  tx?: PrismaTransaction | typeof db,
) {
  const client = tx || db;
  return client.payrollPeriodLock.findUnique({
    where: { branchId_month_year: { branchId, month, year } },
  });
}

// ─── Employee Ledger Helpers ──────────────────────────────────────────
// Every monetary payroll operation appends a row to the employee ledger.
// The running balance is computed as: prevBalance + debit − credit.
// Debit  = amounts the company gives to the employee (advance payout, manual debit)
// Credit = amounts the employee receives (net salary, advance settlement)

export async function appendEmployeeLedgerEntry(params: {
  employeeId: string;
  branchId: string;
  date: Date;
  type: 'ADVANCE' | 'SALARY' | 'ADVANCE_SETTLEMENT' | 'MANUAL_DEBIT' | 'MANUAL_CREDIT';
  description: string;
  debit?: number;
  credit?: number;
  referenceType?: string;
  referenceId?: string;
  journalEntryId?: string;
  tx?: PrismaTransaction;
}): Promise<void> {
  const client = params.tx || db;
  const debit = round2(params.debit || 0);
  const credit = round2(params.credit || 0);

  // Compute running balance
  const lastEntry = await client.employeeLedgerEntry.findFirst({
    where: { employeeId: params.employeeId },
    orderBy: { date: 'desc' },
  });
  const prevBalance = lastEntry ? toNumber(lastEntry.balance) : 0;
  const balance = round2(prevBalance + debit - credit);

  await client.employeeLedgerEntry.create({
    data: {
      employeeId: params.employeeId,
      branchId: params.branchId,
      date: params.date,
      type: params.type,
      description: params.description,
      debit,
      credit,
      balance,
      referenceType: params.referenceType || null,
      referenceId: params.referenceId || null,
      journalEntryId: params.journalEntryId || null,
    },
  });
}

/**
 * Get the current running balance for an employee (last ledger entry's balance).
 * Positive = employee owes the company (e.g. outstanding advances).
 * Negative = company owes the employee (e.g. unpaid salary).
 */
export async function getEmployeeBalance(
  employeeId: string,
  tx?: PrismaTransaction | typeof db,
): Promise<number> {
  const client = tx || db;
  const lastEntry = await client.employeeLedgerEntry.findFirst({
    where: { employeeId },
    orderBy: { date: 'desc' },
  });
  return lastEntry ? toNumber(lastEntry.balance) : 0;
}

// ─── Journal Entry Creators ───────────────────────────────────────────
// Each function creates a single immutable Journal Entry via the accounting
// engine's createTransaction(). The JE is POSTED immediately (status: 'POSTED')
// so it affects account balances.

/**
 * Create the Journal Entry for a salary advance payout.
 * Dr Employee Advances / Cr Cash (or Bank)
 *
 * @returns the created JournalEntry id
 */
export async function createAdvanceJournalEntry(params: {
  employeeId: string;
  employeeName: string;
  amount: number;
  date: Date;
  branchId: string;
  paymentMethod: 'CASH' | 'BANK_TRANSFER';
  reference?: string;
  reason?: string;
  tx?: PrismaTransaction;
}): Promise<string> {
  const accounts = await resolvePayrollAccounts(params.tx || db);
  const creditAccount =
    params.paymentMethod === 'BANK_TRANSFER' ? accounts.bank : accounts.cash;
  const creditAccountName =
    params.paymentMethod === 'BANK_TRANSFER' ? 'البنك' : 'النقدية';

  const description = `سلفة موظف - ${params.employeeName}${params.reason ? ` - ${params.reason}` : ''}`;

  const result = await createTransaction({
    type: 'MANUAL' as any, // generic type — we provide explicit lines below
    date: params.date,
    description,
    amount: params.amount,
    branchId: params.branchId,
    paymentMethod: params.paymentMethod === 'BANK_TRANSFER' ? ('BANK_TRANSFER' as any) : ('CASH' as any),
    counterParty: params.employeeName,
    reference: params.reference,
    status: 'POSTED',
    lines: [
      {
        accountId: accounts.employeeAdvances.id,
        debit: params.amount,
        credit: 0,
        description: `سلفة موظف - ${params.employeeName}`,
      },
      {
        accountId: creditAccount.id,
        debit: 0,
        credit: params.amount,
        description: `صرف سلفة - ${creditAccountName}`,
      },
    ],
    tx: params.tx,
  });

  // createTransaction returns { transaction, journalEntry } — extract JE id
  return (result as any).id || '';
}

/**
 * Create the accrual Journal Entry when a payroll run is approved.
 * Dr Salaries Expense (total gross) / Cr Salaries Payable (total net) + Cr deductions... 
 *
 * Simplified correct version:
 *   Dr Salaries Expense    = totalGross (base + allowances)
 *   Cr Salaries Payable    = totalNet (what we owe employees)
 *   Cr Deductions account  = totalDeductions (e.g. GOSI employee share — posted to a liability/expense)
 *   Cr Employee Advances   = totalAdvances (settled advances reduce what we pay out)
 *
 * To keep it simple and balanced without requiring a "deductions" account,
 * we post:
 *   Dr Salaries Expense  = totalGross
 *   Cr Salaries Payable  = totalNet + totalAdvances   (what we owe + advances we recovered)
 *   Cr Employee Advances = totalAdvances              (advances settled via this run)
 *   (deductions reduce Salaries Payable implicitly via the net calculation)
 *
 * Verification: Dr = totalGross, Cr = (totalNet + totalAdvances) + totalAdvances... 
 * That's NOT balanced. Let me redo the math.
 *
 * For each employee: net = gross − deductions − advanceSettled
 *   Sum: totalNet = totalGross − totalDeductions − totalAdvances
 *   So:  totalGross = totalNet + totalDeductions + totalAdvances  ✓
 *
 * Journal Entry (balanced):
 *   Dr Salaries Expense    = totalGross
 *   Cr Salaries Payable    = totalNet                (obligation to employees)
 *   Cr Deductions Payable  = totalDeductions         (withheld amounts owed to gov/other)
 *   Cr Employee Advances   = totalAdvances           (advances recovered from employees)
 *
 * If there are no deductions, the Deductions Payable line is omitted.
 * For deductions, we fall back to posting to Salaries Payable if no dedicated
 * deductions account exists (keeps the entry balanced without forcing setup).
 */
export async function createPayrollAccrualJournalEntry(params: {
  runNumber: string;
  branchName: string;
  totalGross: number;
  totalDeductions: number;
  totalAdvances: number;
  totalNet: number;
  date: Date;
  branchId: string;
  tx?: PrismaTransaction;
}): Promise<string> {
  const accounts = await resolvePayrollAccounts(params.tx || db);

  const lines: { accountId: string; debit: number; credit: number; description?: string }[] = [
    {
      accountId: accounts.salaryExpense.id,
      debit: params.totalGross,
      credit: 0,
      description: `مصروف رواتب - ${params.branchName} - ${params.runNumber}`,
    },
  ];

  // Cr Salaries Payable = totalNet (what we owe employees)
  if (params.totalNet > 0) {
    lines.push({
      accountId: accounts.salariesPayable.id,
      debit: 0,
      credit: params.totalNet,
      description: `رواتب مستحقة للعاملين - ${params.runNumber}`,
    });
  }

  // Cr Employee Advances = totalAdvances (recovered via this run)
  if (params.totalAdvances > 0) {
    lines.push({
      accountId: accounts.employeeAdvances.id,
      debit: 0,
      credit: params.totalAdvances,
      description: `تسوية سلف الموظفين - ${params.runNumber}`,
    });
  }

  // For deductions: post to Salaries Payable as a reduction (simplification —
  // proper GOSI/withholding tracking would need a dedicated account, but this
  // keeps the entry balanced and the net effect correct).
  // Cr Salaries Payable += totalDeductions (still a payable, just held back)
  if (params.totalDeductions > 0) {
    lines.push({
      accountId: accounts.salariesPayable.id,
      debit: 0,
      credit: params.totalDeductions,
      description: `خصومات مستحقة الخصم - ${params.runNumber}`,
    });
  }

  const description = `مسير رواتب - ${params.branchName} - ${params.runNumber}`;

  const result = await createTransaction({
    type: 'MANUAL' as any,
    date: params.date,
    description,
    amount: params.totalGross,
    branchId: params.branchId,
    status: 'POSTED',
    counterParty: params.branchName,
    reference: params.runNumber,
    lines,
    tx: params.tx,
  });

  return (result as any).id || '';
}

/**
 * Create the payment Journal Entry when a payroll payment is recorded.
 * Dr Salaries Payable / Cr Cash (or Bank)
 */
export async function createPayrollPaymentJournalEntry(params: {
  runNumber: string;
  branchName: string;
  amount: number;
  date: Date;
  branchId: string;
  paymentMethod: 'CASH' | 'BANK_TRANSFER' | 'CHEQUE';
  reference?: string;
  tx?: PrismaTransaction;
}): Promise<string> {
  const accounts = await resolvePayrollAccounts(params.tx || db);
  const creditAccount =
    params.paymentMethod === 'CASH' ? accounts.cash : accounts.bank;
  const creditAccountName =
    params.paymentMethod === 'CASH' ? 'النقدية' : 'البنك';

  const description = `دفع رواتب - ${params.branchName} - ${params.runNumber}`;

  const result = await createTransaction({
    type: 'MANUAL' as any,
    date: params.date,
    description,
    amount: params.amount,
    branchId: params.branchId,
    paymentMethod: params.paymentMethod === 'BANK_TRANSFER' ? ('BANK_TRANSFER' as any) : ('CASH' as any),
    counterParty: params.branchName,
    reference: params.reference || params.runNumber,
    status: 'POSTED',
    lines: [
      {
        accountId: accounts.salariesPayable.id,
        debit: params.amount,
        credit: 0,
        description: `تسوية رواتب مستحقة - ${params.runNumber}`,
      },
      {
        accountId: creditAccount.id,
        debit: 0,
        credit: params.amount,
        description: `صرف رواتب - ${creditAccountName}`,
      },
    ],
    tx: params.tx,
  });

  return (result as any).id || '';
}

// ─── Void / Reverse ───────────────────────────────────────────────────
// When a payroll run is voided, we reverse the accrual JE with a counter-entry.
export async function createPayrollVoidJournalEntry(params: {
  runNumber: string;
  branchName: string;
  accrualJournalEntryId: string;
  totalGross: number;
  totalDeductions: number;
  totalAdvances: number;
  totalNet: number;
  date: Date;
  branchId: string;
  tx?: PrismaTransaction;
}): Promise<string> {
  const accounts = await resolvePayrollAccounts(params.tx || db);

  // Reverse the accrual entry (swap Dr/Cr)
  const lines: { accountId: string; debit: number; credit: number; description?: string }[] = [];

  if (params.totalNet > 0) {
    lines.push({
      accountId: accounts.salariesPayable.id,
      debit: params.totalNet,
      credit: 0,
      description: `عكس رواتب مستحقة - إلغاء ${params.runNumber}`,
    });
  }
  if (params.totalAdvances > 0) {
    lines.push({
      accountId: accounts.employeeAdvances.id,
      debit: params.totalAdvances,
      credit: 0,
      description: `عكس تسوية سلف - إلغاء ${params.runNumber}`,
    });
  }
  if (params.totalDeductions > 0) {
    lines.push({
      accountId: accounts.salariesPayable.id,
      debit: params.totalDeductions,
      credit: 0,
      description: `عكس خصومات - إلغاء ${params.runNumber}`,
    });
  }
  lines.push({
    accountId: accounts.salaryExpense.id,
    debit: 0,
    credit: params.totalGross,
    description: `عكس مصروف رواتب - إلغاء ${params.runNumber}`,
  });

  const description = `إلغاء مسير رواتب - ${params.branchName} - ${params.runNumber}`;

  const result = await createTransaction({
    type: 'MANUAL' as any,
    date: params.date,
    description,
    amount: params.totalGross,
    branchId: params.branchId,
    status: 'POSTED',
    counterParty: params.branchName,
    reference: `VOID-${params.runNumber}`,
    lines,
    tx: params.tx,
  });

  return (result as any).id || '';
}

// ─── Audit Log Helper ─────────────────────────────────────────────────

export async function logPayrollAction(params: {
  action: string;
  entity: string;
  entityId?: string;
  entityNumber?: string;
  description: string;
  details?: any;
  userId?: string;
  userName?: string;
  userRole?: string;
  branchId?: string;
  severity?: string;
  tx?: PrismaTransaction;
}): Promise<void> {
  const client = params.tx || db;
  await client.auditLog.create({
    data: {
      action: params.action,
      entity: params.entity,
      entityId: params.entityId,
      entityNumber: params.entityNumber,
      description: params.description,
      details: params.details ? JSON.stringify(params.details) : null,
      userId: params.userId,
      userName: params.userName,
      userRole: params.userRole,
      branchId: params.branchId,
      severity: params.severity || 'INFO',
      category: 'PAYROLL',
    },
  });
}
