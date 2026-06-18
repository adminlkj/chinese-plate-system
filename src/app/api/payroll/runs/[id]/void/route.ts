import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { toNumber } from '@/lib/decimal';
import {
  requireAuth,
  assertBranchAccess,
  sanitizeInput,
} from '@/lib/api-auth';
import {
  createPayrollVoidJournalEntry,
  logPayrollAction,
  isPeriodLocked,
} from '@/lib/payroll-engine';

// POST /api/payroll/runs/[id]/void
// Soft-void an APPROVED or PAID run. Creates a reversal Journal Entry that
// cancels out the original accrual. Marks the run as VOIDED (never hard-deletes).
// Body: { reason: string }
//
// PERMISSIONS (Section 8): ADMIN ONLY.
// Also enforces Payroll Period Lock (Section 10) — a locked period blocks voiding.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth();
    if (!auth.authenticated) return auth.response;

    // VOID requires ADMIN role — only admins can reverse posted payroll
    if (auth.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'إلغاء مسير الرواتب يتطلب صلاحية مدير النظام (ADMIN)' },
        { status: 403 }
      );
    }

    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const reason = body.reason ? sanitizeInput(body.reason) : null;
    if (!reason) {
      return NextResponse.json(
        { error: 'سبب الإلغاء مطلوب' },
        { status: 400 }
      );
    }

    const run = await db.payrollRun.findUnique({
      where: { id },
      include: { branch: { select: { id: true, name: true } }, payments: true },
    });
    if (!run) {
      return NextResponse.json({ error: 'المسير غير موجود' }, { status: 404 });
    }

    const branchCheck = assertBranchAccess(auth, run.branchId);
    if (!branchCheck.authenticated) return branchCheck.response;

    // ── Period Lock check (Section 10) — locked period blocks voiding ──
    const locked = await isPeriodLocked(run.branchId, run.year, run.month);
    if (locked) {
      return NextResponse.json(
        { error: `الفترة ${run.month}/${run.year} مقفلة. لا يمكن إلغاء المسير. يجب إعادة فتح الفترة أولاً (صلاحية مدير النظام).` },
        { status: 423 }
      );
    }

    if (run.status === 'VOIDED') {
      return NextResponse.json({ error: 'المسير ملغي بالفعل' }, { status: 400 });
    }
    if (run.status === 'DRAFT' || run.status === 'GENERATED') {
      return NextResponse.json(
        { error: 'المسيرات غير المعتمدة تُحذف مباشرة — لا تحتاج إلغاء' },
        { status: 400 }
      );
    }

    const totalGross = toNumber(run.totalGross);
    const totalDeductions = toNumber(run.totalDeductions);
    const totalAdvances = toNumber(run.totalAdvances);
    const totalNet = toNumber(run.totalNet);
    const totalPaid = toNumber(run.totalPaid);

    await db.$transaction(async (tx) => {
      // 1. Reverse the accrual entry (if exists)
      if (run.accrualJournalEntryId) {
        await createPayrollVoidJournalEntry({
          runNumber: run.number,
          branchName: run.branch?.name || run.branchId,
          accrualJournalEntryId: run.accrualJournalEntryId,
          totalGross,
          totalDeductions,
          totalAdvances,
          totalNet,
          date: new Date(),
          branchId: run.branchId,
          tx,
        });
      }

      // 2. Reverse each payment's JE (cancel them)
      for (const payment of run.payments) {
        if (payment.journalEntryId) {
          await tx.journalEntry.update({
            where: { id: payment.journalEntryId },
            data: { status: 'CANCELLED' },
          });
        }
      }

      // 3. Mark run as VOIDED
      await tx.payrollRun.update({
        where: { id },
        data: {
          status: 'VOIDED',
          voidedAt: new Date(),
          voidedBy: auth.userId,
          voidReason: reason,
        },
      });

      // 4. Re-open settled advances for this run's items
      const items = await tx.payrollItem.findMany({
        where: { payrollRunId: id, advanceAmount: { gt: 0 } },
      });
      for (const item of items) {
        const advances = await tx.salaryAdvance.findMany({
          where: { employeeId: item.employeeId, status: 'SETTLED' },
          orderBy: { date: 'desc' },
        });
        let remainingToReverse = toNumber(item.advanceAmount);
        for (const adv of advances) {
          if (remainingToReverse <= 0) break;
          const currentSettled = toNumber(adv.settledAmount);
          const reverseNow = Math.min(currentSettled, remainingToReverse);
          const newSettled = Math.round((currentSettled - reverseNow) * 100) / 100;
          await tx.salaryAdvance.update({
            where: { id: adv.id },
            data: {
              settledAmount: newSettled,
              status: newSettled >= toNumber(adv.amount) ? 'SETTLED' : 'PENDING',
            },
          });
          remainingToReverse = Math.round((remainingToReverse - reverseNow) * 100) / 100;
        }
      }
    });

    await logPayrollAction({
      action: 'VOID_PAYROLL_RUN',
      entity: 'PayrollRun',
      entityId: id,
      entityNumber: run.number,
      description: `إلغاء مسير رواتب ${run.number} - السبب: ${reason}`,
      details: {
        reason,
        totalGross,
        totalNet,
        totalPaid,
        accrualJournalEntryId: run.accrualJournalEntryId,
      },
      userId: auth.userId,
      userName: auth.email,
      userRole: auth.role,
      branchId: run.branchId,
      severity: 'CRITICAL',
    });

    return NextResponse.json({
      success: true,
      id: run.id,
      number: run.number,
      status: 'VOIDED',
      voidedAt: new Date().toISOString(),
      voidReason: reason,
    });
  } catch (error: any) {
    console.error('[POST /api/payroll/runs/[id]/void]', error);
    return NextResponse.json(
      { error: 'فشل في إلغاء المسير' },
      { status: 500 }
    );
  }
}
