import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { toNumber } from '@/lib/decimal';
import {
  requireAuth,
  assertBranchAccess,
} from '@/lib/api-auth';
import {
  createPayrollAccrualJournalEntry,
  logPayrollAction,
  isPeriodLocked,
  appendEmployeeLedgerEntry,
} from '@/lib/payroll-engine';

// POST /api/payroll/runs/[id]/approve
// Transitions a GENERATED run to APPROVED and creates the accrual Journal Entry:
//   Dr Salaries Expense  = totalGross
//   Cr Salaries Payable  = totalNet + totalDeductions
//   Cr Employee Advances = totalAdvances
//
// PERMISSIONS (per Section 8 matrix): ADMIN ONLY — approve is a financial
// commitment that creates an immutable Journal Entry. MANAGER/CASHIER cannot.
// Also enforces Payroll Period Lock (Section 10) — a locked period blocks approval.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth();
    if (!auth.authenticated) return auth.response;

    // ── Permission: ADMIN only ──
    if (auth.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'صلاحية غير كافية — اعتماد المسير يتطلب صلاحية مدير النظام (ADMIN)' },
        { status: 403 }
      );
    }

    const { id } = await params;
    const run = await db.payrollRun.findUnique({
      where: { id },
      include: { branch: { select: { id: true, name: true, nameEn: true } } },
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
        { error: `الفترة ${run.month}/${run.year} مقفلة. لا يمكن اعتماد المسير. يجب إعادة فتح الفترة أولاً (صلاحية مدير النظام).` },
        { status: 423 } // 423 Locked
      );
    }

    // State machine: only GENERATED runs can be approved
    if (run.status !== 'GENERATED') {
      return NextResponse.json(
        { error: `لا يمكن اعتماد مسير بحالة ${run.status}. يجب أن يكون GENERATED.` },
        { status: 400 }
      );
    }

    const totalGross = toNumber(run.totalGross);
    const totalDeductions = toNumber(run.totalDeductions);
    const totalAdvances = toNumber(run.totalAdvances);
    const totalNet = toNumber(run.totalNet);

    // Atomic: create JE + mark run APPROVED + append employee ledger entries
    const accrualJournalEntryId = await db.$transaction(async (tx) => {
      const jeId = await createPayrollAccrualJournalEntry({
        runNumber: run.number,
        branchName: run.branch?.name || run.branchId,
        totalGross,
        totalDeductions,
        totalAdvances,
        totalNet,
        date: new Date(),
        branchId: run.branchId,
        tx,
      });

      await tx.payrollRun.update({
        where: { id },
        data: {
          status: 'APPROVED',
          approvedAt: new Date(),
          approvedBy: auth.userId,
          accrualJournalEntryId: jeId,
        },
      });

      // Append SALARY ledger entries for each item (credit = net amount owed)
      // — advances settled this run are recorded as ADVANCE_SETTLEMENT credits too.
      const items = await tx.payrollItem.findMany({
        where: { payrollRunId: id },
        select: { employeeId: true, netAmount: true, advanceAmount: true },
      });
      const now = new Date();
      for (const it of items) {
        const netAmt = toNumber(it.netAmount);
        const advAmt = toNumber(it.advanceAmount);
        if (netAmt > 0) {
          await appendEmployeeLedgerEntry({
            employeeId: it.employeeId,
            branchId: run.branchId,
            date: now,
            type: 'SALARY',
            description: `استحقاق راتب - ${run.number}`,
            credit: netAmt,
            referenceType: 'PayrollItem',
            referenceId: it.id,
            journalEntryId: jeId,
            tx,
          });
        }
        if (advAmt > 0) {
          await appendEmployeeLedgerEntry({
            employeeId: it.employeeId,
            branchId: run.branchId,
            date: now,
            type: 'ADVANCE_SETTLEMENT',
            description: `تسوية سلفة عبر المسير - ${run.number}`,
            credit: advAmt,
            referenceType: 'PayrollItem',
            referenceId: it.id,
            journalEntryId: jeId,
            tx,
          });
        }
      }

      return jeId;
    });

    await logPayrollAction({
      action: 'APPROVE_PAYROLL_RUN',
      entity: 'PayrollRun',
      entityId: id,
      entityNumber: run.number,
      description: `اعتماد مسير رواتب ${run.number} - إجمالي ${totalNet} - قيد محاسبي ${accrualJournalEntryId}`,
      details: {
        totalGross,
        totalDeductions,
        totalAdvances,
        totalNet,
        accrualJournalEntryId,
      },
      userId: auth.userId,
      userName: auth.email,
      userRole: auth.role,
      branchId: run.branchId,
      severity: 'INFO',
    });

    return NextResponse.json({
      success: true,
      id: run.id,
      number: run.number,
      status: 'APPROVED',
      approvedAt: new Date().toISOString(),
      accrualJournalEntryId,
    });
  } catch (error: any) {
    console.error('[POST /api/payroll/runs/[id]/approve]', error);
    return NextResponse.json(
      { error: 'فشل في اعتماد المسير' },
      { status: 500 }
    );
  }
}
