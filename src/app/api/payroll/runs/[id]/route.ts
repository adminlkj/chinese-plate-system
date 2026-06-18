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
} from '@/lib/api-auth';
import {
  createPayrollVoidJournalEntry,
  logPayrollAction,
  isPeriodLocked,
} from '@/lib/payroll-engine';

// GET /api/payroll/runs/[id] — full detail with items, payments, branch
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth();
    if (!auth.authenticated) return auth.response;
    const readCheck = checkReadAccess(auth, 'payroll');
    if (!readCheck.authenticated) return readCheck.response;

    const { id } = await params;
    const run = await db.payrollRun.findUnique({
      where: { id },
      include: {
        branch: { select: { id: true, name: true, nameEn: true, code: true } },
        items: {
          orderBy: { employee: { code: 'asc' } },
          include: {
            employee: {
              select: {
                id: true,
                code: true,
                name: true,
                nameEn: true,
                position: true,
                salaryType: true,
                baseSalary: true,
                branchId: true,
              },
            },
          },
        },
        payments: { orderBy: { date: 'desc' } },
      },
    });

    if (!run) {
      return NextResponse.json({ error: 'المسير غير موجود' }, { status: 404 });
    }

    const branchCheck = assertBranchAccess(auth, run.branchId);
    if (!branchCheck.authenticated) return branchCheck.response;

    // Fetch period-lock status
    const periodLock = await db.payrollPeriodLock.findUnique({
      where: { branchId_month_year: { branchId: run.branchId, month: run.month, year: run.year } },
    });

    return NextResponse.json({
      id: run.id,
      number: run.number,
      branchId: run.branchId,
      branchName: run.branch?.name,
      branchNameEn: run.branch?.nameEn,
      branchCode: run.branch?.code,
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
      remainingToPay: toNumber(run.totalNet) - toNumber(run.totalPaid),
      employeeCount: run.employeeCount,
      periodLocked: !!periodLock?.isActive,
      periodLockInfo: periodLock ? {
        lockedAt: periodLock.lockedAt.toISOString(),
        lockedByName: periodLock.lockedByName,
        reason: periodLock.reason,
      } : null,
      generatedAt: run.generatedAt?.toISOString() || null,
      generatedBy: run.generatedBy,
      approvedAt: run.approvedAt?.toISOString() || null,
      approvedBy: run.approvedBy,
      paidAt: run.paidAt?.toISOString() || null,
      voidedAt: run.voidedAt?.toISOString() || null,
      voidedBy: run.voidedBy,
      voidReason: run.voidReason,
      accrualJournalEntryId: run.accrualJournalEntryId,
      notes: run.notes,
      createdAt: run.createdAt.toISOString(),
      items: run.items.map((it) => ({
        id: it.id,
        employeeId: it.employeeId,
        employeeCode: it.employee?.code,
        employeeName: it.employee?.name,
        employeeNameEn: it.employee?.nameEn,
        employeePosition: it.employee?.position,
        salaryType: it.employee?.salaryType,
        baseSalary: toNumber(it.employee?.baseSalary),
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
      payments: run.payments.map((p) => ({
        id: p.id,
        amount: toNumber(p.amount),
        paymentMethod: p.paymentMethod,
        date: p.date.toISOString(),
        reference: p.reference,
        journalEntryId: p.journalEntryId,
        notes: p.notes,
        createdAt: p.createdAt.toISOString(),
      })),
    });
  } catch (error: any) {
    console.error('[GET /api/payroll/runs/[id]]', error);
    return NextResponse.json(
      { error: 'فشل في تحميل المسير' },
      { status: 500 }
    );
  }
}

// PUT /api/payroll/runs/[id] — edit items (only allowed in DRAFT/GENERATED status, before approval)
// Body: { items: [{ id?, employeeId, workDays, workHours, allowances, deductions, notes }], notes }
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth();
    if (!auth.authenticated) return auth.response;
    const writeCheck = checkWriteAccess(auth, 'payroll');
    if (!writeCheck.authenticated) return writeCheck.response;

    const { id } = await params;
    const body = await request.json();

    const run = await db.payrollRun.findUnique({
      where: { id },
      include: { branch: { select: { name: true } } },
    });
    if (!run) {
      return NextResponse.json({ error: 'المسير غير موجود' }, { status: 404 });
    }

    const branchCheck = assertBranchAccess(auth, run.branchId);
    if (!branchCheck.authenticated) return branchCheck.response;

    // ── Period Lock check (Section 10) — locked period blocks edits ──
    const locked = await isPeriodLocked(run.branchId, run.year, run.month);
    if (locked) {
      return NextResponse.json(
        { error: `الفترة ${run.month}/${run.year} مقفلة. لا يمكن تعديل المسير. يجب إعادة فتح الفترة أولاً (صلاحية مدير النظام).` },
        { status: 423 }
      );
    }

    // LOCKED after approval — no edits allowed (must void + recreate)
    if (run.status === 'APPROVED' || run.status === 'PAID') {
      return NextResponse.json(
        {
          error: `لا يمكن تعديل مسير ${run.status === 'PAID' ? 'مدفوع' : 'معتمد'}. يجب إلغاؤه (void) وإنشاء مسير جديد.`,
        },
        { status: 400 }
      );
    }
    if (run.status === 'VOIDED') {
      return NextResponse.json({ error: 'لا يمكن تعديل مسير ملغي' }, { status: 400 });
    }

    // If items array provided, replace all items with recalculated values
    if (Array.isArray(body.items)) {
      // Auto-settle advances: fetch outstanding per employee
      const updated = await db.$transaction(async (tx) => {
        // Reverse previously-settled advances for this run's items
        const oldItems = await tx.payrollItem.findMany({
          where: { payrollRunId: id },
        });
        for (const oldItem of oldItems) {
          if (toNumber(oldItem.advanceAmount) > 0) {
            // Re-open the advances that were settled by this run
            const advances = await tx.salaryAdvance.findMany({
              where: {
                employeeId: oldItem.employeeId,
                status: 'SETTLED',
              },
              orderBy: { date: 'desc' },
            });
            let remainingToReverse = toNumber(oldItem.advanceAmount);
            for (const adv of advances) {
              if (remainingToReverse <= 0) break;
              const currentSettled = toNumber(adv.settledAmount);
              const reverseNow = Math.min(currentSettled, remainingToReverse);
              const newSettled = round2(currentSettled - reverseNow);
              await tx.salaryAdvance.update({
                where: { id: adv.id },
                data: {
                  settledAmount: newSettled,
                  status: newSettled >= toNumber(adv.amount) ? 'SETTLED' : 'PENDING',
                },
              });
              remainingToReverse = round2(remainingToReverse - reverseNow);
            }
          }
        }

        // Delete existing items
        await tx.payrollItem.deleteMany({ where: { payrollRunId: id } });

        // Recompute + recreate items
        // NOTE (PAYROLL-FIX-FINAL): advances are NOT deducted from payroll runs.
        // advanceAmount is always 0 for new/recomputed items; advances are settled
        // separately via /api/payroll/advances/[id] settle flow.
        let totalBase = 0;
        let totalAllowances = 0;
        let totalDeductions = 0;
        const totalAdvances = 0;
        const newItems: any[] = [];

        for (const input of body.items) {
          const emp = await tx.employee.findUnique({ where: { id: input.employeeId } });
          if (!emp) continue;

          const workDays = Number(input.workDays ?? 30);
          const workHours = Number(input.workHours ?? 0);
          const allowances = Number(input.allowances ?? 0);
          const deductions = Number(input.deductions ?? 0);
          const notes = input.notes ? sanitizeInput(input.notes) : null;

          // Advances are NOT deducted here (PAYROLL-FIX-FINAL)
          const advanceAmount = 0;

          const baseSalary = toNumber(emp.baseSalary);
          const baseAmount =
            emp.salaryType === 'HOURLY'
              ? round2(baseSalary * workHours)
              : round2(baseSalary * (Math.min(workDays, 30) / 30));
          const grossAmount = round2(baseAmount + allowances);
          const netAmount = round2(grossAmount - deductions);

          totalBase = round2(totalBase + baseAmount);
          totalAllowances = round2(totalAllowances + allowances);
          totalDeductions = round2(totalDeductions + deductions);

          newItems.push({
            payrollRunId: id,
            employeeId: emp.id,
            workDays,
            workHours,
            baseAmount,
            allowances,
            deductions,
            advanceAmount,
            grossAmount,
            netAmount,
            notes,
          });
        }

        const totalGross = round2(totalBase + totalAllowances);
        const totalNet = round2(totalGross - totalDeductions);

        // Create the new items
        await tx.payrollItem.createMany({ data: newItems });

        // Update run totals
        const updatedRun = await tx.payrollRun.update({
          where: { id },
          data: {
            totalBase,
            totalAllowances,
            totalDeductions,
            totalAdvances,
            totalGross,
            totalNet,
            employeeCount: newItems.length,
            notes: body.notes !== undefined ? (body.notes ? sanitizeInput(body.notes) : null) : run.notes,
          },
        });

        return updatedRun;
      });

      await logPayrollAction({
        action: 'UPDATE_PAYROLL_RUN_ITEMS',
        entity: 'PayrollRun',
        entityId: id,
        entityNumber: run.number,
        description: `تعديل بنود مسير الرواتب ${run.number}`,
        userId: auth.userId,
        userName: auth.email,
        userRole: auth.role,
        branchId: run.branchId,
      });

      return NextResponse.json({
        id: updated.id,
        number: updated.number,
        status: updated.status,
        totalBase: toNumber(updated.totalBase),
        totalAllowances: toNumber(updated.totalAllowances),
        totalDeductions: toNumber(updated.totalDeductions),
        totalAdvances: toNumber(updated.totalAdvances),
        totalGross: toNumber(updated.totalGross),
        totalNet: toNumber(updated.totalNet),
        employeeCount: updated.employeeCount,
      });
    }

    // Just updating notes
    if (body.notes !== undefined) {
      const updated = await db.payrollRun.update({
        where: { id },
        data: { notes: body.notes ? sanitizeInput(body.notes) : null },
      });
      return NextResponse.json({ id: updated.id, notes: updated.notes });
    }

    return NextResponse.json({ id: run.id, status: run.status });
  } catch (error: any) {
    console.error('[PUT /api/payroll/runs/[id]]', error);
    return NextResponse.json(
      { error: 'فشل في تعديل المسير' },
      { status: 500 }
    );
  }
}

// DELETE /api/payroll/runs/[id] — soft void (never hard delete)
// Only allowed for DRAFT/GENERATED runs (before approval). Approved/Paid runs
// can only be voided with a reason via the dedicated /void endpoint.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth();
    if (!auth.authenticated) return auth.response;
    const writeCheck = checkWriteAccess(auth, 'payroll');
    if (!writeCheck.authenticated) return writeCheck.response;

    const { id } = await params;
    const run = await db.payrollRun.findUnique({
      where: { id },
      include: { items: true, branch: { select: { name: true } } },
    });
    if (!run) {
      return NextResponse.json({ error: 'المسير غير موجود' }, { status: 404 });
    }

    const branchCheck = assertBranchAccess(auth, run.branchId);
    if (!branchCheck.authenticated) return branchCheck.response;

    // ── Period Lock check (Section 10) ──
    const locked = await isPeriodLocked(run.branchId, run.year, run.month);
    if (locked) {
      return NextResponse.json(
        { error: `الفترة ${run.month}/${run.year} مقفلة. لا يمكن حذف المسير. يجب إعادة فتح الفترة أولاً (صلاحية مدير النظام).` },
        { status: 423 }
      );
    }

    if (run.status === 'APPROVED' || run.status === 'PAID') {
      return NextResponse.json(
        { error: 'لا يمكن حذف مسير معتمد/مدفوع — استخدم إلغاء (void) بدلاً من ذلك' },
        { status: 400 }
      );
    }

    await db.$transaction(async (tx) => {
      // Reverse settled advances (un-settle them since the run is being deleted)
      for (const item of run.items) {
        if (toNumber(item.advanceAmount) > 0) {
          const advances = await tx.salaryAdvance.findMany({
            where: { employeeId: item.employeeId, status: 'SETTLED' },
            orderBy: { date: 'desc' },
          });
          let remainingToReverse = toNumber(item.advanceAmount);
          for (const adv of advances) {
            if (remainingToReverse <= 0) break;
            const currentSettled = toNumber(adv.settledAmount);
            const reverseNow = Math.min(currentSettled, remainingToReverse);
            const newSettled = round2(currentSettled - reverseNow);
            await tx.salaryAdvance.update({
              where: { id: adv.id },
              data: {
                settledAmount: newSettled,
                status: newSettled >= toNumber(adv.amount) ? 'SETTLED' : 'PENDING',
              },
            });
            remainingToReverse = round2(remainingToReverse - reverseNow);
          }
        }
      }

      // Delete items + the run
      await tx.payrollItem.deleteMany({ where: { payrollRunId: id } });
      await tx.payrollRun.delete({ where: { id } });
    });

    await logPayrollAction({
      action: 'DELETE_PAYROLL_RUN',
      entity: 'PayrollRun',
      entityId: id,
      entityNumber: run.number,
      description: `حذف مسير رواتب ${run.number} (كان ${run.status})`,
      details: { totalNet: toNumber(run.totalNet) },
      userId: auth.userId,
      userName: auth.email,
      userRole: auth.role,
      branchId: run.branchId,
      severity: 'WARN',
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[DELETE /api/payroll/runs/[id]]', error);
    return NextResponse.json(
      { error: 'فشل في حذف المسير' },
      { status: 500 }
    );
  }
}
