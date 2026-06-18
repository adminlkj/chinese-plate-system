import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { toNumber } from '@/lib/decimal';
import {
  requireAuth,
  checkReadAccess,
  assertBranchAccess,
  safePageSize,
} from '@/lib/api-auth';

// GET /api/payroll/employee-ledger
// Query: employeeId (required), dateFrom, dateTo, type, page, pageSize
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth();
    if (!auth.authenticated) return auth.response;
    const readCheck = checkReadAccess(auth, 'payroll');
    if (!readCheck.authenticated) return readCheck.response;

    const { searchParams } = new URL(request.url);
    const employeeId = searchParams.get('employeeId');
    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');
    const type = searchParams.get('type');
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = safePageSize(parseInt(searchParams.get('pageSize') || '500'));

    if (!employeeId) {
      return NextResponse.json({ error: 'الموظف مطلوب' }, { status: 400 });
    }

    const employee = await db.employee.findUnique({
      where: { id: employeeId },
      select: { id: true, code: true, name: true, nameEn: true, position: true, branchId: true },
    });
    if (!employee) {
      return NextResponse.json({ error: 'الموظف غير موجود' }, { status: 404 });
    }

    const branchCheck = assertBranchAccess(auth, employee.branchId);
    if (!branchCheck.authenticated) return branchCheck.response;

    const where: any = { employeeId };
    if (type) where.type = type;
    if (dateFrom || dateTo) {
      where.date = {
        ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
        ...(dateTo ? { lte: new Date(dateTo) } : {}),
      };
    }

    const [entries, total] = await Promise.all([
      db.employeeLedgerEntry.findMany({
        where,
        orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.employeeLedgerEntry.count({ where }),
    ]);

    // Aggregate summary
    const summary = await db.employeeLedgerEntry.aggregate({
      where,
      _sum: { debit: true, credit: true },
      _count: { id: true },
    });

    const totalDebit = toNumber(summary._sum.debit || 0);
    const totalCredit = toNumber(summary._sum.credit || 0);
    const closingBalance = totalDebit - totalCredit;

    return NextResponse.json({
      employee: {
        id: employee.id,
        code: employee.code,
        name: employee.name,
        nameEn: employee.nameEn,
        position: employee.position,
        branchId: employee.branchId,
      },
      entries: entries.map((e) => ({
        id: e.id,
        date: e.date.toISOString(),
        type: e.type,
        description: e.description,
        debit: toNumber(e.debit),
        credit: toNumber(e.credit),
        balance: toNumber(e.balance),
        referenceType: e.referenceType,
        referenceId: e.referenceId,
        journalEntryId: e.journalEntryId,
        createdAt: e.createdAt.toISOString(),
      })),
      summary: {
        totalDebit,
        totalCredit,
        closingBalance,
        entryCount: summary._count.id || 0,
      },
      total,
      page,
      pageSize,
    });
  } catch (error: any) {
    console.error('[GET /api/payroll/employee-ledger]', error);
    return NextResponse.json({ error: 'فشل في جلب قيود الموظف' }, { status: 500 });
  }
}
