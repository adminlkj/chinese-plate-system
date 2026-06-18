import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { toNumber } from '@/lib/decimal';
import {
  requireAuth,
  checkReadAccess,
  checkWriteAccess,
  assertBranchAccess,
  getUserAllowedBranches,
} from '@/lib/api-auth';
import { resolveBranchIdOrNull } from '@/lib/branch-resolver';
import { auditLog } from '@/lib/audit-log';

// GET /api/payroll/settings
// Query: branchId — returns settings for the branch (or defaults if none exist)
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth();
    if (!auth.authenticated) return auth.response;
    const readCheck = checkReadAccess(auth, 'payroll');
    if (!readCheck.authenticated) return readCheck.response;

    const { searchParams } = new URL(request.url);
    const branchInput = searchParams.get('branch') || searchParams.get('branchId');
    if (!branchInput) {
      return NextResponse.json({ error: 'الفرع مطلوب' }, { status: 400 });
    }

    const branchId = await resolveBranchIdOrNull(branchInput);
    if (!branchId) {
      return NextResponse.json({ error: 'الفرع غير موجود' }, { status: 404 });
    }
    const branchCheck = assertBranchAccess(auth, branchId);
    if (!branchCheck.authenticated) return branchCheck.response;

    const settings = await db.payrollSetting.findUnique({
      where: { branchId },
    });

    if (!settings) {
      // Return defaults
      return NextResponse.json({
        branchId,
        workingDaysPerMonth: 30,
        standardWorkHoursPerDay: 8,
        overtimeRateMultiplier: 1.5,
        lateDeductionPerHour: 0,
        absenceDeductionPerDay: 0,
        gosiEnabled: false,
        gosiEmployerRate: 12,
        gosiEmployeeRate: 10,
        gosiSalaryCap: 45000,
        salaryExpenseAccountId: null,
        salariesPayableAccountId: null,
        employeeAdvancesAccountId: null,
        isDefault: true,
      });
    }

    return NextResponse.json({
      id: settings.id,
      branchId: settings.branchId,
      workingDaysPerMonth: settings.workingDaysPerMonth,
      standardWorkHoursPerDay: toNumber(settings.standardWorkHoursPerDay),
      overtimeRateMultiplier: toNumber(settings.overtimeRateMultiplier),
      lateDeductionPerHour: toNumber(settings.lateDeductionPerHour),
      absenceDeductionPerDay: toNumber(settings.absenceDeductionPerDay),
      gosiEnabled: settings.gosiEnabled,
      gosiEmployerRate: toNumber(settings.gosiEmployerRate),
      gosiEmployeeRate: toNumber(settings.gosiEmployeeRate),
      gosiSalaryCap: toNumber(settings.gosiSalaryCap),
      salaryExpenseAccountId: settings.salaryExpenseAccountId,
      salariesPayableAccountId: settings.salariesPayableAccountId,
      employeeAdvancesAccountId: settings.employeeAdvancesAccountId,
      isDefault: false,
    });
  } catch (error: any) {
    console.error('[GET /api/payroll/settings]', error);
    return NextResponse.json({ error: 'فشل في جلب إعدادات الرواتب' }, { status: 500 });
  }
}

// POST /api/payroll/settings — create or update settings for a branch (upsert)
// Body: { branchId, workingDaysPerMonth, standardWorkHoursPerDay, overtimeRateMultiplier,
//         lateDeductionPerHour, absenceDeductionPerDay,
//         gosiEnabled, gosiEmployerRate, gosiEmployeeRate, gosiSalaryCap,
//         salaryExpenseAccountId?, salariesPayableAccountId?, employeeAdvancesAccountId? }
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth();
    if (!auth.authenticated) return auth.response;

    // AUDIT-9-18: Enforce write-access check (prior AUDIT-5-6 worklog claimed this was added
    // but the fix was missing from the working tree — re-applying it here).
    // CASHIER (payroll=NONE) is blocked; MANAGER (payroll=FULL default) and ADMIN allowed.
    const writeCheck = checkWriteAccess(auth, 'payroll');
    if (!writeCheck.authenticated) return writeCheck.response;

    // Settings management requires ADMIN (or MANAGER with write access)
    // We allow MANAGER+ to update settings (they already have write access to payroll)
    const allowedBranches = getUserAllowedBranches(auth);
    const body = await request.json();
    const branchId = await resolveBranchIdOrNull(body.branchId || body.branch);
    if (!branchId) {
      return NextResponse.json({ error: 'الفرع مطلوب' }, { status: 400 });
    }
    const branchCheck = assertBranchAccess(auth, branchId);
    if (!branchCheck.authenticated) return branchCheck.response;

    const data = {
      workingDaysPerMonth: Number(body.workingDaysPerMonth || 30),
      standardWorkHoursPerDay: Number(body.standardWorkHoursPerDay || 8),
      overtimeRateMultiplier: Number(body.overtimeRateMultiplier || 1.5),
      lateDeductionPerHour: Number(body.lateDeductionPerHour || 0),
      absenceDeductionPerDay: Number(body.absenceDeductionPerDay || 0),
      gosiEnabled: !!body.gosiEnabled,
      gosiEmployerRate: Number(body.gosiEmployerRate || 12),
      gosiEmployeeRate: Number(body.gosiEmployeeRate || 10),
      gosiSalaryCap: Number(body.gosiSalaryCap || 45000),
      salaryExpenseAccountId: body.salaryExpenseAccountId || null,
      salariesPayableAccountId: body.salariesPayableAccountId || null,
      employeeAdvancesAccountId: body.employeeAdvancesAccountId || null,
    };

    const upserted = await db.payrollSetting.upsert({
      where: { branchId },
      update: data,
      create: { branchId, ...data },
    });

    // AUDIT-9-18 — payroll settings upsert (GOSI rates, account mappings — compliance-sensitive)
    auditLog({
      action: 'SETTINGS_CHANGE',
      entity: 'SETTING',
      entityId: upserted.id,
      description: `تحديث إعدادات الرواتب للفرع ${branchId} (GOSI: ${data.gosiEnabled ? 'مفعّل' : 'معطيل'}, معدل العامل: ${data.gosiEmployeeRate}%)`,
      userId: auth.userId,
      userName: auth.email,
      userRole: auth.role,
      branchId,
      severity: 'WARNING',
      category: 'SETTINGS',
      details: {
        ...data,
        allowedBranches,
      },
    }).catch(() => {});

    return NextResponse.json({
      id: upserted.id,
      branchId: upserted.branchId,
      workingDaysPerMonth: upserted.workingDaysPerMonth,
      standardWorkHoursPerDay: toNumber(upserted.standardWorkHoursPerDay),
      overtimeRateMultiplier: toNumber(upserted.overtimeRateMultiplier),
      lateDeductionPerHour: toNumber(upserted.lateDeductionPerHour),
      absenceDeductionPerDay: toNumber(upserted.absenceDeductionPerDay),
      gosiEnabled: upserted.gosiEnabled,
      gosiEmployerRate: toNumber(upserted.gosiEmployerRate),
      gosiEmployeeRate: toNumber(upserted.gosiEmployeeRate),
      gosiSalaryCap: toNumber(upserted.gosiSalaryCap),
      salaryExpenseAccountId: upserted.salaryExpenseAccountId,
      salariesPayableAccountId: upserted.salariesPayableAccountId,
      employeeAdvancesAccountId: upserted.employeeAdvancesAccountId,
    });
  } catch (error: any) {
    console.error('[POST /api/payroll/settings]', error);
    return NextResponse.json({ error: 'فشل في حفظ إعدادات الرواتب' }, { status: 500 });
  }
}
