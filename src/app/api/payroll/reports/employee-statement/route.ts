import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { toNumber, round2 } from '@/lib/decimal';
import {
  requireAuth,
  checkReadAccess,
  assertBranchAccess,
  safePageSize,
} from '@/lib/api-auth';

// GET /api/payroll/reports/employee-statement
// Query params: employeeId (required), dateFrom, dateTo, page, pageSize
// Returns: employee details + payroll history + advances history + summary totals
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth();
    if (!auth.authenticated) return auth.response;
    const readCheck = checkReadAccess(auth, 'payroll');
    if (!readCheck.authenticated) return readCheck.response;

    const { searchParams } = new URL(request.url);
    const employeeId = searchParams.get('employeeId');
    if (!employeeId) {
      return NextResponse.json({ error: 'معرف الموظف مطلوب' }, { status: 400 });
    }
    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = safePageSize(parseInt(searchParams.get('pageSize') || '200'));

    const employee = await db.employee.findUnique({
      where: { id: employeeId },
      include: {
        branch: { select: { id: true, name: true, nameEn: true, code: true } },
      },
    });
    if (!employee) {
      return NextResponse.json({ error: 'الموظف غير موجود' }, { status: 404 });
    }

    // Branch access check
    const branchCheck = assertBranchAccess(auth, employee.branchId);
    if (!branchCheck.authenticated) return branchCheck.response;

    // Build date filter
    const dateFilter: any = {};
    if (dateFrom) dateFilter.gte = new Date(dateFrom);
    if (dateTo) dateFilter.lte = new Date(dateTo);

    // Fetch payroll items (with their run info) in date range
    const payrollItemsWhere: any = { employeeId };
    if (dateFrom || dateTo) {
      payrollItemsWhere.payrollRun = {
        ...(dateFrom || dateTo ? { createdAt: dateFilter } : {}),
      };
    }

    const [payrollItems, advances, totalCount] = await Promise.all([
      db.payrollItem.findMany({
        where: payrollItemsWhere,
        include: {
          payrollRun: {
            select: {
              id: true,
              number: true,
              month: true,
              year: true,
              status: true,
              createdAt: true,
              branch: { select: { name: true } },
            },
          },
        },
        orderBy: { payrollRun: { createdAt: 'desc' } },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.salaryAdvance.findMany({
        where: {
          employeeId,
          ...(dateFrom || dateTo ? { date: dateFilter } : {}),
        },
        orderBy: { date: 'desc' },
      }),
      db.payrollItem.count({ where: payrollItemsWhere }),
    ]);

    // Aggregate summary across the full date range (not paginated)
    const [payrollAgg, advanceAgg] = await Promise.all([
      db.payrollItem.aggregate({
        where: payrollItemsWhere,
        _sum: {
          baseAmount: true,
          allowances: true,
          deductions: true,
          advanceAmount: true,
          grossAmount: true,
          netAmount: true,
        },
        _count: { id: true },
      }),
      db.salaryAdvance.aggregate({
        where: {
          employeeId,
          ...(dateFrom || dateTo ? { date: dateFilter } : {}),
        },
        _sum: { amount: true, settledAmount: true },
        _count: { id: true },
      }),
    ]);

    // Outstanding advance balance (all-time, not just date range)
    const outstandingAdvances = await db.salaryAdvance.aggregate({
      where: { employeeId, status: 'PENDING' },
      _sum: { amount: true, settledAmount: true },
    });
    const outstandingTotal =
      toNumber(outstandingAdvances._sum.amount) -
      toNumber(outstandingAdvances._sum.settledAmount);

    // Build a unified timeline (payroll runs + advances sorted by date)
    type TimelineEntry = {
      date: string;
      type: 'PAYROLL' | 'ADVANCE';
      reference: string;
      description: string;
      debit: number; // money paid out to employee (advances + net payroll)
      credit: number; // money deducted from employee (deductions + advance settlements)
      balance: number; // running balance owed to employee
    };

    const timeline: TimelineEntry[] = [];

    for (const pi of payrollItems) {
      timeline.push({
        date: pi.payrollRun.createdAt.toISOString(),
        type: 'PAYROLL',
        reference: pi.payrollRun.number,
        description: `مسير ${pi.payrollRun.month}/${pi.payrollRun.year} - ${pi.payrollRun.branch?.name || ''}`,
        debit: toNumber(pi.netAmount), // net owed to employee
        credit: 0,
        balance: 0,
      });
    }
    for (const adv of advances) {
      timeline.push({
        date: adv.date.toISOString(),
        type: 'ADVANCE',
        reference: adv.number,
        description: adv.reason || 'سلفة',
        debit: 0,
        credit: toNumber(adv.amount), // advance paid out (reduces what we owe)
        balance: 0,
      });
    }

    // Sort by date descending
    timeline.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    // Compute running balance (debit = owed to employee, credit = paid/settled)
    let runningBalance = 0;
    for (const entry of timeline) {
      runningBalance = round2(runningBalance + entry.debit - entry.credit);
      entry.balance = runningBalance;
    }

    return NextResponse.json({
      employee: {
        id: employee.id,
        code: employee.code,
        name: employee.name,
        nameEn: employee.nameEn,
        iqamaNumber: employee.iqamaNumber,
        phone: employee.phone,
        email: employee.email,
        position: employee.position,
        salaryType: employee.salaryType,
        baseSalary: toNumber(employee.baseSalary),
        status: employee.status,
        hireDate: employee.hireDate.toISOString(),
        branchId: employee.branchId,
        branchName: employee.branch?.name,
        branchNameEn: employee.branch?.nameEn,
        branchCode: employee.branch?.code,
      },
      dateFrom: dateFrom || null,
      dateTo: dateTo || null,
      summary: {
        totalGross: toNumber(payrollAgg._sum.grossAmount),
        totalBase: toNumber(payrollAgg._sum.baseAmount),
        totalAllowances: toNumber(payrollAgg._sum.allowances),
        totalDeductions: toNumber(payrollAgg._sum.deductions),
        totalAdvanceSettlements: toNumber(payrollAgg._sum.advanceAmount),
        totalNet: toNumber(payrollAgg._sum.netAmount),
        payrollRunCount: payrollAgg._count.id || 0,
        totalAdvances: toNumber(advanceAgg._sum.amount),
        totalAdvancesSettled: toNumber(advanceAgg._sum.settledAmount),
        advanceCount: advanceAgg._count.id || 0,
        outstandingAdvances: outstandingTotal,
      },
      payrollItems: payrollItems.map((pi) => ({
        id: pi.id,
        runNumber: pi.payrollRun.number,
        runId: pi.payrollRun.id,
        month: pi.payrollRun.month,
        year: pi.payrollRun.year,
        runStatus: pi.payrollRun.status,
        date: pi.payrollRun.createdAt.toISOString(),
        branchName: pi.payrollRun.branch?.name,
        workDays: toNumber(pi.workDays),
        workHours: toNumber(pi.workHours),
        baseAmount: toNumber(pi.baseAmount),
        allowances: toNumber(pi.allowances),
        deductions: toNumber(pi.deductions),
        advanceAmount: toNumber(pi.advanceAmount),
        grossAmount: toNumber(pi.grossAmount),
        netAmount: toNumber(pi.netAmount),
        notes: pi.notes,
      })),
      advances: advances.map((a) => ({
        id: a.id,
        number: a.number,
        amount: toNumber(a.amount),
        date: a.date.toISOString(),
        reason: a.reason,
        status: a.status,
        settledAmount: toNumber(a.settledAmount),
        remaining: toNumber(a.amount) - toNumber(a.settledAmount),
        journalEntryId: a.journalEntryId,
      })),
      timeline,
      pagination: {
        page,
        pageSize,
        total: totalCount,
        totalPages: Math.ceil(totalCount / pageSize),
      },
    });
  } catch (error: any) {
    console.error('[GET /api/payroll/reports/employee-statement]', error);
    return NextResponse.json(
      { error: 'فشل في تحميل كشف حساب الموظف' },
      { status: 500 }
    );
  }
}
