import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { toNumber } from '@/lib/decimal';
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
  generateAdvanceNumber,
  createAdvanceJournalEntry,
  logPayrollAction,
  appendEmployeeLedgerEntry,
} from '@/lib/payroll-engine';

// GET /api/payroll/advances
// Query params: branch, employeeId, status, dateFrom, dateTo, page, pageSize
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth();
    if (!auth.authenticated) return auth.response;
    const readCheck = checkReadAccess(auth, 'payroll');
    if (!readCheck.authenticated) return readCheck.response;

    const { searchParams } = new URL(request.url);
    const branchInput = searchParams.get('branch') || searchParams.get('branchId');
    const employeeId = searchParams.get('employeeId');
    const status = searchParams.get('status');
    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = safePageSize(parseInt(searchParams.get('pageSize') || '50'));

    const where: any = {};

    // Branch scoping
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

    if (employeeId) where.employeeId = employeeId;
    if (status) where.status = status;
    if (dateFrom || dateTo) {
      where.date = {
        ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
        ...(dateTo ? { lte: new Date(dateTo) } : {}),
      };
    }

    const [advances, total] = await Promise.all([
      db.salaryAdvance.findMany({
        where,
        include: {
          employee: {
            select: { id: true, code: true, name: true, nameEn: true, position: true },
          },
          branch: { select: { id: true, name: true, nameEn: true, code: true } },
        },
        orderBy: { date: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.salaryAdvance.count({ where }),
    ]);

    // Summary
    const summaryWhere = { ...where };
    const summary = await db.salaryAdvance.aggregate({
      where: summaryWhere,
      _sum: { amount: true, settledAmount: true },
      _count: { id: true },
    });

    return NextResponse.json({
      advances: advances.map((a) => ({
        id: a.id,
        number: a.number,
        employeeId: a.employeeId,
        employeeCode: a.employee?.code,
        employeeName: a.employee?.name,
        employeeNameEn: a.employee?.nameEn,
        employeePosition: a.employee?.position,
        branchId: a.branchId,
        branchName: a.branch?.name,
        branchNameEn: a.branch?.nameEn,
        branchCode: a.branch?.code,
        amount: toNumber(a.amount),
        date: a.date.toISOString(),
        reason: a.reason,
        status: a.status,
        settledAmount: toNumber(a.settledAmount),
        remaining: toNumber(a.amount) - toNumber(a.settledAmount),
        journalEntryId: a.journalEntryId,
        notes: a.notes,
        createdAt: a.createdAt.toISOString(),
      })),
      total,
      page,
      pageSize,
      summary: {
        totalAmount: toNumber(summary._sum.amount),
        totalSettled: toNumber(summary._sum.settledAmount),
        totalOutstanding:
          toNumber(summary._sum.amount) - toNumber(summary._sum.settledAmount),
        count: summary._count.id || 0,
      },
    });
  } catch (error: any) {
    console.error('[GET /api/payroll/advances]', error);
    return NextResponse.json(
      { error: 'فشل في تحميل السلف' },
      { status: 500 }
    );
  }
}

// POST /api/payroll/advances — create a new salary advance
// This creates a Journal Entry: Dr Employee Advances / Cr Cash|Bank
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth();
    if (!auth.authenticated) return auth.response;
    const writeCheck = checkWriteAccess(auth, 'payroll');
    if (!writeCheck.authenticated) return writeCheck.response;

    const body = await request.json();

    // Validate employee
    const employeeId = body.employeeId;
    if (!employeeId) {
      return NextResponse.json({ error: 'الموظف مطلوب' }, { status: 400 });
    }
    const employee = await db.employee.findUnique({
      where: { id: employeeId },
      include: { branch: { select: { id: true, name: true, nameEn: true } } },
    });
    if (!employee) {
      return NextResponse.json({ error: 'الموظف غير موجود' }, { status: 404 });
    }

    // Branch access check (employee's branch)
    const branchCheck = assertBranchAccess(auth, employee.branchId);
    if (!branchCheck.authenticated) return branchCheck.response;

    // Validate amount
    const amount = Number(body.amount);
    if (!amount || amount <= 0) {
      return NextResponse.json(
        { error: 'المبلغ يجب أن يكون أكبر من صفر' },
        { status: 400 }
      );
    }

    const paymentMethod =
      body.paymentMethod === 'BANK_TRANSFER' ? 'BANK_TRANSFER' : 'CASH';

    const date = body.date ? new Date(body.date) : new Date();
    const reason = body.reason ? sanitizeInput(body.reason) : null;
    const notes = body.notes ? sanitizeInput(body.notes) : null;

    const number = await generateAdvanceNumber();

    // Create the advance + journal entry in a single transaction for atomicity
    const result = await db.$transaction(async (tx) => {
      // 1. Create the Journal Entry (Dr Employee Advances / Cr Cash|Bank)
      const journalEntryId = await createAdvanceJournalEntry({
        employeeId: employee.id,
        employeeName: employee.name,
        amount,
        date,
        branchId: employee.branchId,
        paymentMethod,
        reference: number,
        reason: reason || undefined,
        tx,
      });

      // 2. Create the SalaryAdvance record
      const advance = await tx.salaryAdvance.create({
        data: {
          number,
          employeeId: employee.id,
          branchId: employee.branchId,
          amount,
          date,
          reason,
          status: 'PENDING',
          settledAmount: 0,
          journalEntryId,
          notes,
        },
        include: {
          employee: {
            select: { id: true, code: true, name: true, nameEn: true, position: true },
          },
          branch: { select: { id: true, name: true, nameEn: true, code: true } },
        },
      });

      // 3. Append to Employee Ledger (debit = company gave cash to employee)
      await appendEmployeeLedgerEntry({
        employeeId: employee.id,
        branchId: employee.branchId,
        date,
        type: 'ADVANCE',
        description: `سلفة موظف - ${number}${reason ? ` - ${reason}` : ''}`,
        debit: amount,
        referenceType: 'SalaryAdvance',
        referenceId: advance.id,
        journalEntryId,
        tx,
      });

      return advance;
    });

    await logPayrollAction({
      action: 'CREATE_ADVANCE',
      entity: 'SalaryAdvance',
      entityId: result.id,
      entityNumber: result.number,
      description: `صرف سلفة للموظف ${employee.name} - ${result.number} - مبلغ ${amount}`,
      details: {
        employeeId: employee.id,
        amount,
        paymentMethod,
        journalEntryId: result.journalEntryId,
      },
      userId: auth.userId,
      userName: auth.email,
      userRole: auth.role,
      branchId: employee.branchId,
    });

    return NextResponse.json({
      id: result.id,
      number: result.number,
      employeeId: result.employeeId,
      employeeCode: result.employee?.code,
      employeeName: result.employee?.name,
      employeeNameEn: result.employee?.nameEn,
      employeePosition: result.employee?.position,
      branchId: result.branchId,
      branchName: result.branch?.name,
      branchNameEn: result.branch?.nameEn,
      branchCode: result.branch?.code,
      amount: toNumber(result.amount),
      date: result.date.toISOString(),
      reason: result.reason,
      status: result.status,
      settledAmount: toNumber(result.settledAmount),
      remaining: toNumber(result.amount) - toNumber(result.settledAmount),
      journalEntryId: result.journalEntryId,
      notes: result.notes,
      createdAt: result.createdAt.toISOString(),
    });
  } catch (error: any) {
    console.error('[POST /api/payroll/advances]', error);
    return NextResponse.json(
      { error: 'فشل في صرف السلفة' },
      { status: 500 }
    );
  }
}
