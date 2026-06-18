import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { toNumber, round2 } from '@/lib/decimal';
import {
  requireAuth,
  checkReadAccess,
  assertBranchAccess,
  sanitizeInput,
} from '@/lib/api-auth';
import {
  createPayrollPaymentJournalEntry,
  logPayrollAction,
  isPeriodLocked,
  appendEmployeeLedgerEntry,
} from '@/lib/payroll-engine';

// GET /api/payroll/runs/[id]/payments — list payments for a run
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
      select: { id: true, branchId: true, number: true, totalNet: true, totalPaid: true },
    });
    if (!run) {
      return NextResponse.json({ error: 'المسير غير موجود' }, { status: 404 });
    }
    const branchCheck = assertBranchAccess(auth, run.branchId);
    if (!branchCheck.authenticated) return branchCheck.response;

    const payments = await db.payrollPayment.findMany({
      where: { payrollRunId: id },
      orderBy: { date: 'desc' },
    });

    return NextResponse.json({
      payments: payments.map((p) => ({
        id: p.id,
        amount: toNumber(p.amount),
        paymentMethod: p.paymentMethod,
        date: p.date.toISOString(),
        reference: p.reference,
        journalEntryId: p.journalEntryId,
        notes: p.notes,
        createdAt: p.createdAt.toISOString(),
      })),
      totalNet: toNumber(run.totalNet),
      totalPaid: toNumber(run.totalPaid),
      remaining: toNumber(run.totalNet) - toNumber(run.totalPaid),
    });
  } catch (error: any) {
    console.error('[GET /api/payroll/runs/[id]/payments]', error);
    return NextResponse.json(
      { error: 'فشل في تحميل المدفوعات' },
      { status: 500 }
    );
  }
}

// POST /api/payroll/runs/[id]/payments — record a payment
// Body: { amount, paymentMethod, date, reference, notes }
// Creates Journal Entry: Dr Salaries Payable / Cr Cash|Bank
// If totalPaid + amount >= totalNet, marks run as PAID
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth();
    if (!auth.authenticated) return auth.response;

    // ── Permission: ADMIN only (per Section 8 matrix) ──
    if (auth.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'صلاحية غير كافية — دفع الرواتب يتطلب صلاحية مدير النظام (ADMIN)' },
        { status: 403 }
      );
    }

    const { id } = await params;
    const body = await request.json();

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
        { error: `الفترة ${run.month}/${run.year} مقفلة. لا يمكن تسجيل دفعات. يجب إعادة فتح الفترة أولاً (صلاحية مدير النظام).` },
        { status: 423 }
      );
    }

    // Only APPROVED runs can receive payments
    if (run.status !== 'APPROVED' && run.status !== 'PAID') {
      return NextResponse.json(
        { error: `لا يمكن دفع مسير بحالة ${run.status}. يجب اعتماده أولاً.` },
        { status: 400 }
      );
    }
    if (run.status === 'PAID') {
      return NextResponse.json(
        { error: 'المسير مدفوع بالكامل بالفعل' },
        { status: 400 }
      );
    }

    const amount = Number(body.amount);
    if (!amount || amount <= 0) {
      return NextResponse.json(
        { error: 'مبلغ الدفع يجب أن يكون أكبر من صفر' },
        { status: 400 }
      );
    }

    const totalNet = toNumber(run.totalNet);
    const totalPaid = toNumber(run.totalPaid);
    const remaining = round2(totalNet - totalPaid);

    if (amount > remaining + 0.01) {
      // 0.01 tolerance for rounding
      return NextResponse.json(
        {
          error: `المبلغ يتجاوز المتبقي (${remaining}). لا يمكن دفع أكثر من المستحق.`,
        },
        { status: 400 }
      );
    }

    const paymentMethod =
      body.paymentMethod === 'BANK_TRANSFER'
        ? 'BANK_TRANSFER'
        : body.paymentMethod === 'CHEQUE'
          ? 'CHEQUE'
          : 'CASH';

    const date = body.date ? new Date(body.date) : new Date();
    const reference = body.reference ? sanitizeInput(body.reference) : null;
    const notes = body.notes ? sanitizeInput(body.notes) : null;

    const result = await db.$transaction(async (tx) => {
      // Create the payment Journal Entry
      const journalEntryId = await createPayrollPaymentJournalEntry({
        runNumber: run.number,
        branchName: run.branch?.name || run.branchId,
        amount,
        date,
        branchId: run.branchId,
        paymentMethod: paymentMethod as 'CASH' | 'BANK_TRANSFER' | 'CHEQUE',
        reference: reference || run.number,
        tx,
      });

      // Create the payment record
      const payment = await tx.payrollPayment.create({
        data: {
          payrollRunId: id,
          amount,
          paymentMethod,
          date,
          reference,
          journalEntryId,
          notes,
        },
      });

      // Update run totalPaid + status
      const newTotalPaid = round2(totalPaid + amount);
      const newStatus = newTotalPaid >= totalNet - 0.01 ? 'PAID' : 'APPROVED';
      const updated = await tx.payrollRun.update({
        where: { id },
        data: {
          totalPaid: newTotalPaid,
          status: newStatus,
          paidAt: newStatus === 'PAID' ? new Date() : null,
        },
      });

      // ── Distribute the payment across items proportionally and append ledger entries ──
      // (debit = the salary payable is settled; from the employee's perspective this is
      //  a debit because they received the cash — but since the SALARY credit was already
      //  posted on approval, the payment clears it. We record it as a debit of the same amount.)
      if (totalNet > 0) {
        const items = await tx.payrollItem.findMany({
          where: { payrollRunId: id },
          select: { id: true, employeeId: true, netAmount: true },
        });
        let distributed = 0;
        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          const empNet = toNumber(it.netAmount);
          if (empNet <= 0) continue;
          // Last item gets the residual to avoid rounding drift
          const share = i === items.length - 1
            ? round2(amount - distributed)
            : round2((empNet / totalNet) * amount);
          distributed = round2(distributed + share);
          if (share > 0) {
            await appendEmployeeLedgerEntry({
              employeeId: it.employeeId,
              branchId: run.branchId,
              date,
              type: 'SALARY',
              description: `صرف راتب - ${run.number}`,
              debit: share,
              referenceType: 'PayrollPayment',
              referenceId: payment.id,
              journalEntryId,
              tx,
            });
          }
        }
      }

      return { payment, updated, journalEntryId };
    });

    await logPayrollAction({
      action: 'PAYROLL_PAYMENT',
      entity: 'PayrollRun',
      entityId: id,
      entityNumber: run.number,
      description: `دفع رواتب ${run.number} - مبلغ ${amount} (${paymentMethod}) - قيد ${result.journalEntryId}`,
      details: {
        amount,
        paymentMethod,
        reference,
        journalEntryId: result.journalEntryId,
        newStatus: result.updated.status,
      },
      userId: auth.userId,
      userName: auth.email,
      userRole: auth.role,
      branchId: run.branchId,
    });

    return NextResponse.json({
      id: result.payment.id,
      amount: toNumber(result.payment.amount),
      paymentMethod: result.payment.paymentMethod,
      date: result.payment.date.toISOString(),
      reference: result.payment.reference,
      journalEntryId: result.payment.journalEntryId,
      notes: result.payment.notes,
      runStatus: result.updated.status,
      totalPaid: toNumber(result.updated.totalPaid),
      remaining: toNumber(result.updated.totalNet) - toNumber(result.updated.totalPaid),
    });
  } catch (error: any) {
    console.error('[POST /api/payroll/runs/[id]/payments]', error);
    return NextResponse.json(
      { error: 'فشل في تسجيل الدفعة' },
      { status: 500 }
    );
  }
}
