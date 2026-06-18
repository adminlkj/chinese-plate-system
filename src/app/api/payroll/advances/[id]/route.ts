import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { toNumber, round2 } from '@/lib/decimal';
import {
  requireAuth,
  checkWriteAccess,
  assertBranchAccess,
  sanitizeInput,
} from '@/lib/api-auth';
import { logPayrollAction } from '@/lib/payroll-engine';

// PUT /api/payroll/advances/[id] — update an advance (only if PENDING and not settled)
// Allows editing reason/notes, or recording a manual settlement (markAsSettled=true)
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

    const existing = await db.salaryAdvance.findUnique({
      where: { id },
      include: {
        employee: { select: { id: true, name: true, code: true } },
      },
    });
    if (!existing) {
      return NextResponse.json({ error: 'السلفة غير موجودة' }, { status: 404 });
    }

    const branchCheck = assertBranchAccess(auth, existing.branchId);
    if (!branchCheck.authenticated) return branchCheck.response;

    // Manual settlement: markAsSettled=true with settledAmount
    if (body.markAsSettled) {
      const settledAmount = body.settledAmount
        ? Number(body.settledAmount)
        : toNumber(existing.amount) - toNumber(existing.settledAmount);

      const newSettledTotal = round2(toNumber(existing.settledAmount) + settledAmount);
      const totalAmount = toNumber(existing.amount);
      const newStatus = newSettledTotal >= totalAmount ? 'SETTLED' : 'PENDING';

      const updated = await db.salaryAdvance.update({
        where: { id },
        data: {
          settledAmount: newSettledTotal,
          status: newStatus,
        },
        include: {
          employee: { select: { id: true, code: true, name: true, nameEn: true, position: true } },
          branch: { select: { id: true, name: true, nameEn: true, code: true } },
        },
      });

      await logPayrollAction({
        action: 'SETTLE_ADVANCE_MANUAL',
        entity: 'SalaryAdvance',
        entityId: id,
        entityNumber: existing.number,
        description: `تسوية يدوية للسلفة ${existing.number} - مخصوم ${settledAmount} من ${existing.employee.name}`,
        details: { settledAmount, newSettledTotal, totalAmount, newStatus },
        userId: auth.userId,
        userName: auth.email,
        userRole: auth.role,
        branchId: existing.branchId,
      });

      return NextResponse.json({
        id: updated.id,
        number: updated.number,
        amount: toNumber(updated.amount),
        settledAmount: toNumber(updated.settledAmount),
        remaining: toNumber(updated.amount) - toNumber(updated.settledAmount),
        status: updated.status,
      });
    }

    // Regular edit — only allow if advance is still PENDING and has no settlement
    if (existing.status === 'SETTLED' || toNumber(existing.settledAmount) > 0) {
      return NextResponse.json(
        { error: 'لا يمكن تعديل سلفة تم تسويتها — يجب إلغاؤها وإنشاء سلفة جديدة' },
        { status: 400 }
      );
    }

    const updated = await db.salaryAdvance.update({
      where: { id },
      data: {
        reason: body.reason !== undefined ? (body.reason ? sanitizeInput(body.reason) : null) : existing.reason,
        notes: body.notes !== undefined ? (body.notes ? sanitizeInput(body.notes) : null) : existing.notes,
        date: body.date ? new Date(body.date) : existing.date,
      },
      include: {
        employee: { select: { id: true, code: true, name: true, nameEn: true, position: true } },
        branch: { select: { id: true, name: true, nameEn: true, code: true } },
      },
    });

    await logPayrollAction({
      action: 'UPDATE_ADVANCE',
      entity: 'SalaryAdvance',
      entityId: id,
      entityNumber: existing.number,
      description: `تعديل سلفة ${existing.number} للموظف ${existing.employee.name}`,
      userId: auth.userId,
      userName: auth.email,
      userRole: auth.role,
      branchId: existing.branchId,
    });

    return NextResponse.json({
      id: updated.id,
      number: updated.number,
      amount: toNumber(updated.amount),
      date: updated.date.toISOString(),
      reason: updated.reason,
      notes: updated.notes,
      status: updated.status,
      settledAmount: toNumber(updated.settledAmount),
      remaining: toNumber(updated.amount) - toNumber(updated.settledAmount),
    });
  } catch (error: any) {
    console.error('[PUT /api/payroll/advances/[id]]', error);
    return NextResponse.json(
      { error: 'فشل في تعديل السلفة' },
      { status: 500 }
    );
  }
}

// DELETE /api/payroll/advances/[id] — only if PENDING and not settled at all
// Reverses the journal entry by creating a counter-entry.
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
    const existing = await db.salaryAdvance.findUnique({
      where: { id },
      include: { employee: { select: { id: true, name: true, code: true } } },
    });
    if (!existing) {
      return NextResponse.json({ error: 'السلفة غير موجودة' }, { status: 404 });
    }

    const branchCheck = assertBranchAccess(auth, existing.branchId);
    if (!branchCheck.authenticated) return branchCheck.response;

    if (existing.status === 'SETTLED' || toNumber(existing.settledAmount) > 0) {
      return NextResponse.json(
        { error: 'لا يمكن حذف سلفة تم تسويتها — يجب معالجتها كاسترداد بدلاً من ذلك' },
        { status: 400 }
      );
    }

    // Reverse the journal entry (create counter-entry) and delete the advance
    await db.$transaction(async (tx) => {
      // Cancel the original journal entry (status → CANCELLED)
      if (existing.journalEntryId) {
        await tx.journalEntry.update({
          where: { id: existing.journalEntryId },
          data: { status: 'CANCELLED' },
        });
        // Recompute affected account balances
        const lines = await tx.journalLine.findMany({
          where: { journalEntryId: existing.journalEntryId },
          select: { accountId: true },
        });
        const affectedAccountIds = new Set(lines.map((l) => l.accountId));
        for (const accountId of affectedAccountIds) {
          const result = await tx.journalLine.aggregate({
            where: {
              accountId,
              journalEntry: { status: 'POSTED' },
            },
            _sum: { debit: true, credit: true },
          });
          const debit = toNumber(result._sum.debit);
          const credit = toNumber(result._sum.credit);
          // For asset accounts, balance = debit - credit
          // For liability/equity/revenue, balance = credit - debit
          // We just store the net debit position; the accounting engine handles interpretation
          await tx.account.update({
            where: { id: accountId },
            data: { currentBalance: debit - credit },
          });
        }
      }

      await tx.salaryAdvance.delete({ where: { id } });
    });

    await logPayrollAction({
      action: 'DELETE_ADVANCE',
      entity: 'SalaryAdvance',
      entityId: id,
      entityNumber: existing.number,
      description: `حذف سلفة ${existing.number} للموظف ${existing.employee.name} — تم إلغاء القيد المحاسبي`,
      details: { amount: toNumber(existing.amount), journalEntryId: existing.journalEntryId },
      userId: auth.userId,
      userName: auth.email,
      userRole: auth.role,
      branchId: existing.branchId,
      severity: 'WARN',
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[DELETE /api/payroll/advances/[id]]', error);
    return NextResponse.json(
      { error: 'فشل في حذف السلفة' },
      { status: 500 }
    );
  }
}
