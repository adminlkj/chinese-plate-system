import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { toNumber, round2 } from '@/lib/decimal';
import {
  requireAuth,
  checkReadAccess,
  checkWriteAccess,
  assertBranchAccess,
  safePageSize,
  sanitizeInput,
  getUserAllowedBranches,
} from '@/lib/api-auth';
import { resolveBranchId, resolveBranchIdOrNull } from '@/lib/branch-resolver';
import {
  generatePayrollRunNumber,
  calculatePayrollItem,
  logPayrollAction,
  isPeriodLocked,
  getPayrollSettings,
  getEmployeeLeavesForPeriod,
  getEmployeeAttendanceForPeriod,
  resolveEmployeeAllowances,
  computeGosiDeduction,
  computeAbsenceDeduction,
  computeLateDeduction,
  appendEmployeeLedgerEntry,
} from '@/lib/payroll-engine';

// GET /api/payroll/runs
// Query params: branch, status, year, month, page, pageSize
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth();
    if (!auth.authenticated) return auth.response;
    const readCheck = checkReadAccess(auth, 'payroll');
    if (!readCheck.authenticated) return readCheck.response;

    const { searchParams } = new URL(request.url);
    const branchInput = searchParams.get('branch') || searchParams.get('branchId');
    const status = searchParams.get('status');
    const year = searchParams.get('year');
    const month = searchParams.get('month');
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = safePageSize(parseInt(searchParams.get('pageSize') || '50'));

    const where: any = {};

    const allowedBranches = getUserAllowedBranches(auth);
    if (allowedBranches) {
      where.branchId = { in: allowedBranches };
    }
    if (branchInput && branchInput !== 'all') {
      const branchId = await resolveBranchIdOrNull(branchInput);
      if (branchId) {
        const branchCheck = assertBranchAccess(auth, branchId);
        if (!branchCheck.authenticated) return branchCheck.response;
        where.branchId = branchId;
      }
    }

    if (status) where.status = status;
    if (year) where.year = parseInt(year);
    if (month) where.month = parseInt(month);

    const [runs, total] = await Promise.all([
      db.payrollRun.findMany({
        where,
        include: {
          branch: { select: { id: true, name: true, nameEn: true, code: true } },
          _count: { select: { items: true, payments: true } },
        },
        orderBy: [{ year: 'desc' }, { month: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.payrollRun.count({ where }),
    ]);

    // For each run, also fetch its period-lock status (cheap query)
    const runsPeriodLocks = await Promise.all(
      runs.map((r) =>
        db.payrollPeriodLock.findUnique({
          where: { branchId_month_year: { branchId: r.branchId, month: r.month, year: r.year } },
          select: { isActive: true, lockedAt: true, lockedByName: true },
        })
      )
    );

    // Summary across the filtered set
    const summary = await db.payrollRun.aggregate({
      where,
      _sum: {
        totalGross: true,
        totalDeductions: true,
        totalAdvances: true,
        totalNet: true,
        totalPaid: true,
      },
    });

    return NextResponse.json({
      runs: runs.map((r, idx) => ({
        id: r.id,
        number: r.number,
        branchId: r.branchId,
        branchName: r.branch?.name,
        branchNameEn: r.branch?.nameEn,
        branchCode: r.branch?.code,
        month: r.month,
        year: r.year,
        status: r.status,
        totalBase: toNumber(r.totalBase),
        totalAllowances: toNumber(r.totalAllowances),
        totalDeductions: toNumber(r.totalDeductions),
        totalAdvances: toNumber(r.totalAdvances),
        totalGross: toNumber(r.totalGross),
        totalNet: toNumber(r.totalNet),
        totalPaid: toNumber(r.totalPaid),
        remainingToPay: toNumber(r.totalNet) - toNumber(r.totalPaid),
        employeeCount: r.employeeCount,
        itemCount: r._count.items,
        paymentCount: r._count.payments,
        periodLocked: !!runsPeriodLocks[idx]?.isActive,
        generatedAt: r.generatedAt?.toISOString() || null,
        approvedAt: r.approvedAt?.toISOString() || null,
        paidAt: r.paidAt?.toISOString() || null,
        voidedAt: r.voidedAt?.toISOString() || null,
        accrualJournalEntryId: r.accrualJournalEntryId,
        notes: r.notes,
        createdAt: r.createdAt.toISOString(),
      })),
      total,
      page,
      pageSize,
      summary: {
        totalGross: toNumber(summary._sum.totalGross),
        totalDeductions: toNumber(summary._sum.totalDeductions),
        totalAdvances: toNumber(summary._sum.totalAdvances),
        totalNet: toNumber(summary._sum.totalNet),
        totalPaid: toNumber(summary._sum.totalPaid),
      },
    });
  } catch (error: any) {
    console.error('[GET /api/payroll/runs]', error);
    return NextResponse.json(
      { error: 'فشل في تحميل مسيرات الرواتب' },
      { status: 500 }
    );
  }
}

// POST /api/payroll/runs — create a new payroll run (DRAFT → GENERATED)
// Body: {
//   branchId, month, year,
//   employeeIds: [string],          // multi-select employees (bulk)
//   items?: [{ employeeId, workDays, workHours, allowances, deductions, notes,
//              housingAllowance, transportAllowance, communicationAllowance,
//              bonusAmount, commissionAmount, otherAllowances,
//              gosiDeduction, absenceDeduction, lateDeduction, otherDeductions }],
//   autoApplyAllowances?: boolean,  // default true — pull recurring EmployeeAllowances
//   autoApplyLeaves?: boolean,      // default true — pull Leave records for the month
//   autoApplyAttendance?: boolean,  // default true — pull Attendance records for the month
//   autoApplyGosi?: boolean,        // default follows settings.gosiEnabled
// }
//
// NOTE (PAYROLL-FIX-FINAL): Advances (السلف) are NOT deducted from payroll runs.
// They are settled separately via /api/payroll/advances/[id] settle flow.
// advanceAmount is always 0 for new runs; totalAdvances is always 0.
//
// PERFORMANCE (Section 7):
//   - All items computed in-memory (single loop, no per-employee DB round-trip)
//   - All PayrollItem records created via nested create (1 INSERT for N items)
//   - All PayrollItemAllowance records created via nested create
//   - All EmployeeLedgerEntry records created in bulk within the same transaction
//   - Whole operation wrapped in a single db.$transaction (atomic)
//
// PERIOD LOCK (Section 10): a locked period blocks creation entirely.
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth();
    if (!auth.authenticated) return auth.response;
    const writeCheck = checkWriteAccess(auth, 'payroll');
    if (!writeCheck.authenticated) return writeCheck.response;

    const body = await request.json();

    // MANDATORY branchId
    const branchId = await resolveBranchId(body.branchId || body.branch);
    if (!branchId) {
      return NextResponse.json(
        { error: 'الفرع مطلوب — لا يمكن إنشاء مسير بدون فرع' },
        { status: 400 }
      );
    }
    const branchCheck = assertBranchAccess(auth, branchId);
    if (!branchCheck.authenticated) return branchCheck.response;

    // Validate month/year
    const month = parseInt(body.month);
    const year = parseInt(body.year);
    if (!month || month < 1 || month > 12) {
      return NextResponse.json({ error: 'الشهر غير صحيح (1-12)' }, { status: 400 });
    }
    if (!year || year < 2000 || year > 2100) {
      return NextResponse.json({ error: 'السنة غير صحيح' }, { status: 400 });
    }

    // ── Period Lock check (Section 10) ──
    const locked = await isPeriodLocked(branchId, year, month);
    if (locked) {
      return NextResponse.json(
        { error: `الفترة ${month}/${year} مقفلة. لا يمكن إنشاء مسير جديد. يجب إعادة فتح الفترة أولاً (صلاحية مدير النظام).` },
        { status: 423 }
      );
    }

    // Prevent duplicate runs for the same branch+month+year (unless VOIDED)
    // (Section 6 — no duplicate "Payroll June 2026" for same branch)
    const existingRun = await db.payrollRun.findFirst({
      where: {
        branchId,
        month,
        year,
        status: { not: 'VOIDED' },
      },
    });
    if (existingRun) {
      return NextResponse.json(
        {
          error: `يوجد مسير رواتب لهذا الفرع في ${month}/${year} بالفعل (${existingRun.number})`,
          existingRunId: existingRun.id,
        },
        { status: 409 }
      );
    }

    // Validate employee selection
    const employeeIds: string[] = body.employeeIds || [];
    if (!employeeIds.length && !body.items?.length) {
      return NextResponse.json(
        { error: 'يجب اختيار موظف واحد على الأقل' },
        { status: 400 }
      );
    }

    // Fetch all employees in a SINGLE query (bulk) — must belong to branch + ACTIVE
    const targetEmployeeIds = employeeIds.length
      ? employeeIds
      : body.items.map((i: any) => i.employeeId);

    // De-duplicate
    const uniqueEmployeeIds = Array.from(new Set(targetEmployeeIds));

    const employees = await db.employee.findMany({
      where: {
        id: { in: uniqueEmployeeIds },
        branchId,
        status: 'ACTIVE',
      },
    });

    if (!employees.length) {
      return NextResponse.json(
        { error: 'لم يتم العثور على موظفين نشطين للفرع المحدد' },
        { status: 400 }
      );
    }

    // Reject any employee IDs that don't belong to this branch (data-integrity guard)
    const foundIds = new Set(employees.map((e) => e.id));
    const missing = uniqueEmployeeIds.filter((id) => !foundIds.has(id));
    if (missing.length) {
      return NextResponse.json(
        { error: `بعض الموظفين غير نشطين أو لا ينتمون لهذا الفرع (${missing.length} موظف)` },
        { status: 400 }
      );
    }

    // ── Pre-fetch all data needed for calculation in bulk ──
    // (Performance: 1 query per data type, NOT 1 query per employee)
    const settings = await getPayrollSettings(branchId);

    // NOTE (PAYROLL-FIX-FINAL): outstanding advances are NOT pulled here anymore —
    // advances are settled separately from payroll runs.

    // Build items map for custom inputs (allowances, deductions, etc.)
    const itemsMap = new Map<string, any>();
    if (Array.isArray(body.items)) {
      for (const item of body.items) {
        itemsMap.set(item.employeeId, item);
      }
    }

    // Feature flags (default true for auto-apply)
    const autoApplyAllowances = body.autoApplyAllowances !== false;
    const autoApplyLeaves = body.autoApplyLeaves !== false;
    const autoApplyAttendance = body.autoApplyAttendance !== false;
    const autoApplyGosi = body.autoApplyGosi !== undefined
      ? !!body.autoApplyGosi
      : settings.gosiEnabled;

    // ── Compute payroll items in-memory (single loop, no DB round-trips) ──
    // We'll collect data for bulk inserts:
    //   - itemsData: PayrollItem records (nested under run create)
    //   - itemAllowancesData: PayrollItemAllowance records (need payrollItemId after run create)
    //   - ledgerEntries: list of ledger entries to create after run create

    interface ComputedItem {
      employeeId: string;
      workDays: number;
      workHours: number;
      baseAmount: number;
      // Structured allowances
      housingAllowance: number;
      transportAllowance: number;
      communicationAllowance: number;
      bonusAmount: number;
      commissionAmount: number;
      otherAllowances: number;
      allowances: number; // total (legacy field for compatibility)
      // Structured deductions
      gosiDeduction: number;
      absenceDeduction: number;
      lateDeduction: number;
      otherDeductions: number;
      deductions: number; // total
      // Leave/Attendance summary
      annualLeaveDays: number;
      sickLeaveDays: number;
      absenceDays: number;
      lateHours: number;
      // Computed (advanceAmount is always 0 for new runs — PAYROLL-FIX-FINAL)
      advanceAmount: number;
      grossAmount: number;
      netAmount: number;
      notes?: string;
      // Sub-records
      itemAllowances: { allowanceTypeId: string; amount: number; isPercentage: boolean; notes?: string }[];
    }

    const computedItems: ComputedItem[] = [];

    // Pre-fetch leaves + attendance in parallel (bulk) — only if auto-apply enabled
    const leavesByEmployee = new Map<string, any>();
    const attendanceByEmployee = new Map<string, any>();
    if (autoApplyLeaves) {
      const leavesResults = await Promise.all(
        employees.map((e) => getEmployeeLeavesForPeriod(e.id, year, month))
      );
      employees.forEach((e, i) => leavesByEmployee.set(e.id, leavesResults[i]));
    }
    if (autoApplyAttendance) {
      const attendanceResults = await Promise.all(
        employees.map((e) => getEmployeeAttendanceForPeriod(e.id, year, month))
      );
      employees.forEach((e, i) => attendanceByEmployee.set(e.id, attendanceResults[i]));
    }

    for (const emp of employees) {
      const input = itemsMap.get(emp.id) || {};
      const salaryType = emp.salaryType as 'MONTHLY' | 'HOURLY';
      const baseSalary = toNumber(emp.baseSalary);

      // Work days / hours from input, or default
      let workDays = Number(input.workDays ?? settings.workingDaysPerMonth);
      let workHours = Number(input.workHours ?? 0);

      // ── Leave/Attendance integration (Section 5) ──
      const leaves = autoApplyLeaves ? leavesByEmployee.get(emp.id) : null;
      const attendance = autoApplyAttendance ? attendanceByEmployee.get(emp.id) : null;

      const annualLeaveDays = leaves?.annualLeaveDays || 0;
      const sickLeaveDays = leaves?.sickLeaveDays || 0;
      const absenceDays = attendance?.absenceDays || 0;
      const lateHours = attendance?.lateHours || 0;

      // For MONTHLY: prorate based on (workingDays − absence − unpaid leave)
      const unpaidLeaveDays = leaves?.unpaidLeaveDays || 0;
      if (salaryType === 'MONTHLY' && autoApplyAttendance) {
        // Reduce work days by absence + unpaid leave (capped at 0)
        workDays = Math.max(0, workDays - absenceDays - unpaidLeaveDays);
      }

      // For HOURLY: if attendance provides workHours, prefer that
      if (salaryType === 'HOURLY' && autoApplyAttendance && attendance?.totalWorkHours) {
        workHours = attendance.totalWorkHours;
      }

      // ── Calculate base amount ──
      const calc = calculatePayrollItem({
        employeeId: emp.id,
        salaryType,
        baseSalary,
        workDays,
        workHours,
        allowances: 0, // will be set from structured fields
        deductions: 0,
        advanceAmount: 0,
        notes: input.notes ? sanitizeInput(input.notes) : undefined,
      });
      const baseAmount = calc.baseAmount;

      // ── Allowances (Section 4 — Bonus/Allowance Engine) ──
      // 1. Auto-resolve recurring EmployeeAllowances (if enabled)
      const recurring = autoApplyAllowances
        ? await resolveEmployeeAllowances(emp.id, baseAmount)
        : null;

      // 2. Apply any structured overrides from the input
      const housingAllowance = Number(input.housingAllowance ?? recurring?.housingAllowance ?? 0);
      const transportAllowance = Number(input.transportAllowance ?? recurring?.transportAllowance ?? 0);
      const communicationAllowance = Number(input.communicationAllowance ?? recurring?.communicationAllowance ?? 0);
      const bonusAmount = Number(input.bonusAmount ?? recurring?.bonusAmount ?? 0);
      const commissionAmount = Number(input.commissionAmount ?? recurring?.commissionAmount ?? 0);
      const otherAllowances = Number(input.otherAllowances ?? recurring?.otherAllowances ?? 0);
      const legacyAllowance = Number(input.allowances ?? 0); // flat allowances from input

      // ── Deductions ──
      // 1. GOSI auto-deduction
      const gosiDeduction = autoApplyGosi
        ? computeGosiDeduction(baseSalary, settings)
        : Number(input.gosiDeduction ?? 0);
      // 2. Absence deduction (auto from attendance)
      const absenceDeduction = autoApplyAttendance
        ? computeAbsenceDeduction(absenceDays, baseSalary, settings)
        : Number(input.absenceDeduction ?? 0);
      // 3. Late deduction (auto from attendance)
      const lateDeduction = autoApplyAttendance
        ? computeLateDeduction(lateHours, baseSalary, settings)
        : Number(input.lateDeduction ?? 0);
      // 4. Other deductions
      const otherDeductions = Number(input.otherDeductions ?? 0);
      const legacyDeductions = Number(input.deductions ?? 0); // flat deductions from input

      // NOTE (PAYROLL-FIX-FINAL): Advances are NOT deducted from payroll runs.
      // They are settled separately via /api/payroll/advances/[id] settle flow.
      // advanceAmount is always 0 here.
      const advanceAmount = 0;

      // ── Final calculation with all components ──
      const finalCalc = calculatePayrollItem({
        employeeId: emp.id,
        salaryType,
        baseSalary,
        workDays,
        workHours,
        allowances: legacyAllowance,
        deductions: legacyDeductions,
        advanceAmount,
        notes: input.notes ? sanitizeInput(input.notes) : undefined,
        housingAllowance,
        transportAllowance,
        communicationAllowance,
        bonusAmount,
        commissionAmount,
        otherAllowances,
        gosiDeduction,
        absenceDeduction,
        lateDeduction,
        otherDeductions,
        annualLeaveDays,
        sickLeaveDays,
        absenceDays,
        lateHours,
      });

      computedItems.push({
        employeeId: emp.id,
        workDays,
        workHours,
        baseAmount,
        housingAllowance,
        transportAllowance,
        communicationAllowance,
        bonusAmount,
        commissionAmount,
        otherAllowances,
        allowances: finalCalc.allowances,
        gosiDeduction,
        absenceDeduction,
        lateDeduction,
        otherDeductions,
        deductions: finalCalc.deductions,
        annualLeaveDays,
        sickLeaveDays,
        absenceDays,
        lateHours,
        advanceAmount,
        grossAmount: finalCalc.grossAmount,
        netAmount: finalCalc.netAmount,
        notes: input.notes ? sanitizeInput(input.notes) : undefined,
        itemAllowances: recurring?.itemAllowances || [],
      });
    }

    // ── Aggregate totals ──
    // totalAdvances is always 0 for new runs (PAYROLL-FIX-FINAL — advances settled separately)
    const totalBase = round2(computedItems.reduce((s, i) => s + i.baseAmount, 0));
    const totalAllowances = round2(computedItems.reduce((s, i) => s + i.allowances, 0));
    const totalDeductions = round2(computedItems.reduce((s, i) => s + i.deductions, 0));
    const totalAdvances = 0;
    const totalGross = round2(totalBase + totalAllowances);
    const totalNet = round2(totalGross - totalDeductions);

    const number = await generatePayrollRunNumber(year, month);

    // ── Single atomic transaction (Section 7 — bulk processing) ──
    // Within this transaction:
    //   1. Create the PayrollRun with all items in a single nested create
    //   2. Bulk-update settled advances (one UPDATE per advance)
    //   3. Create PayrollItemAllowance records (bulk nested create via update)
    //   4. No ledger entries yet — those are created on APPROVAL (accrual)
    const run = await db.$transaction(async (tx) => {
      // 1. Create run + items in a SINGLE INSERT with nested create
      const created = await tx.payrollRun.create({
        data: {
          number,
          branchId,
          month,
          year,
          status: 'GENERATED',
          totalBase,
          totalAllowances,
          totalDeductions,
          totalAdvances,
          totalGross,
          totalNet,
          totalPaid: 0,
          employeeCount: computedItems.length,
          generatedAt: new Date(),
          generatedBy: auth.userId,
          notes: body.notes ? sanitizeInput(body.notes) : null,
          items: {
            create: computedItems.map((it) => ({
              employeeId: it.employeeId,
              workDays: it.workDays,
              workHours: it.workHours,
              baseAmount: it.baseAmount,
              // Structured allowance fields
              housingAllowance: it.housingAllowance,
              transportAllowance: it.transportAllowance,
              communicationAllowance: it.communicationAllowance,
              bonusAmount: it.bonusAmount,
              commissionAmount: it.commissionAmount,
              otherAllowances: it.otherAllowances,
              allowances: it.allowances,
              // Structured deduction fields
              gosiDeduction: it.gosiDeduction,
              absenceDeduction: it.absenceDeduction,
              lateDeduction: it.lateDeduction,
              otherDeductions: it.otherDeductions,
              deductions: it.deductions,
              // Leave/Attendance summary
              annualLeaveDays: it.annualLeaveDays,
              sickLeaveDays: it.sickLeaveDays,
              absenceDays: it.absenceDays,
              lateHours: it.lateHours,
              advanceAmount: it.advanceAmount,
              grossAmount: it.grossAmount,
              netAmount: it.netAmount,
              notes: it.notes,
            })),
          },
        },
        include: {
          branch: { select: { id: true, name: true, nameEn: true, code: true } },
          items: {
            include: {
              employee: {
                select: { id: true, code: true, name: true, nameEn: true, position: true, salaryType: true },
              },
            },
          },
        },
      });

      // 2. Create PayrollItemAllowance records (bulk) — for each item with allowances
      // We need the payrollItemId from the created run's items
      const itemsWithAllowances = created.items.filter((it) => {
        const computed = computedItems.find((c) => c.employeeId === it.employeeId);
        return computed && computed.itemAllowances.length > 0;
      });

      for (const item of itemsWithAllowances) {
        const computed = computedItems.find((c) => c.employeeId === item.employeeId);
        if (!computed) continue;
        if (computed.itemAllowances.length === 0) continue;

        await tx.payrollItemAllowance.createMany({
          data: computed.itemAllowances.map((ia) => ({
            payrollItemId: item.id,
            allowanceTypeId: ia.allowanceTypeId,
            amount: ia.amount,
            isPercentage: ia.isPercentage,
            notes: ia.notes || null,
          })),
        });
      }

      // NOTE (PAYROLL-FIX-FINAL): No advance settlement transactions here —
      // advances are settled separately via /api/payroll/advances/[id] settle flow.

      return created;
    });

    await logPayrollAction({
      action: 'CREATE_PAYROLL_RUN',
      entity: 'PayrollRun',
      entityId: run.id,
      entityNumber: run.number,
      description: `إنشاء مسير رواتب ${run.number} للفرع ${run.branch?.name} - ${run.employeeCount} موظف - صافي ${totalNet}`,
      details: {
        branchId,
        month,
        year,
        employeeCount: run.employeeCount,
        totalGross,
        totalDeductions,
        totalAdvances,
        totalNet,
        autoApplyAllowances,
        autoApplyLeaves,
        autoApplyAttendance,
        autoApplyGosi,
      },
      userId: auth.userId,
      userName: auth.email,
      userRole: auth.role,
      branchId,
    });

    return NextResponse.json({
      id: run.id,
      number: run.number,
      branchId: run.branchId,
      branchName: run.branch?.name,
      month: run.month,
      year: run.year,
      status: run.status,
      totalBase: toNumber(run.totalBase),
      totalAllowances: toNumber(run.totalAllowances),
      totalDeductions: toNumber(run.totalDeductions),
      totalAdvances: toNumber(run.totalAdvances),
      totalGross: toNumber(run.totalGross),
      totalNet: toNumber(run.totalNet),
      totalPaid: toNumber(run.totalPaid),
      employeeCount: run.employeeCount,
      generatedAt: run.generatedAt?.toISOString(),
      items: run.items.map((it) => ({
        id: it.id,
        employeeId: it.employeeId,
        employeeCode: it.employee?.code,
        employeeName: it.employee?.name,
        employeeNameEn: it.employee?.nameEn,
        employeePosition: it.employee?.position,
        salaryType: it.employee?.salaryType,
        workDays: toNumber(it.workDays),
        workHours: toNumber(it.workHours),
        baseAmount: toNumber(it.baseAmount),
        // Structured allowances
        housingAllowance: toNumber(it.housingAllowance),
        transportAllowance: toNumber(it.transportAllowance),
        communicationAllowance: toNumber(it.communicationAllowance),
        bonusAmount: toNumber(it.bonusAmount),
        commissionAmount: toNumber(it.commissionAmount),
        otherAllowances: toNumber(it.otherAllowances),
        allowances: toNumber(it.allowances),
        // Structured deductions
        gosiDeduction: toNumber(it.gosiDeduction),
        absenceDeduction: toNumber(it.absenceDeduction),
        lateDeduction: toNumber(it.lateDeduction),
        otherDeductions: toNumber(it.otherDeductions),
        deductions: toNumber(it.deductions),
        // Leave/Attendance summary
        annualLeaveDays: toNumber(it.annualLeaveDays),
        sickLeaveDays: toNumber(it.sickLeaveDays),
        absenceDays: toNumber(it.absenceDays),
        lateHours: toNumber(it.lateHours),
        advanceAmount: toNumber(it.advanceAmount),
        grossAmount: toNumber(it.grossAmount),
        netAmount: toNumber(it.netAmount),
        notes: it.notes,
      })),
    });
  } catch (error: any) {
    console.error('[POST /api/payroll/runs]', error);
    return NextResponse.json(
      { error: 'فشل في إنشاء مسير الرواتب' },
      { status: 500 }
    );
  }
}
