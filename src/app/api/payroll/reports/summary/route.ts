import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { toNumber, round2 } from '@/lib/decimal';
import {
  requireAuth,
  checkReadAccess,
  assertBranchAccess,
  getUserAllowedBranches,
} from '@/lib/api-auth';
import { resolveBranchIdOrNull } from '@/lib/branch-resolver';

// GET /api/payroll/reports/summary
// Query params: year (required), branch (optional — 'all' for company-wide)
// Returns:
//   - Per-branch summary (employeeCount, totalGross, totalNet, totalAdvances, totalPaid)
//   - Monthly breakdown (12 months of totalNet + employeeCount)
//   - Grand totals
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth();
    if (!auth.authenticated) return auth.response;
    const readCheck = checkReadAccess(auth, 'payroll');
    if (!readCheck.authenticated) return readCheck.response;

    const { searchParams } = new URL(request.url);
    const yearStr = searchParams.get('year');
    const year = yearStr ? parseInt(yearStr) : new Date().getFullYear();
    const branchInput = searchParams.get('branch') || searchParams.get('branchId');

    // Build where clause
    const where: any = { year };

    // Branch scoping
    const allowedBranches = getUserAllowedBranches(auth);
    if (allowedBranches) {
      where.branchId = { in: allowedBranches };
    }
    let singleBranchId: string | null = null;
    if (branchInput && branchInput !== 'all') {
      singleBranchId = await resolveBranchIdOrNull(branchInput);
      if (singleBranchId) {
        const branchCheck = assertBranchAccess(auth, singleBranchId);
        if (!branchCheck.authenticated) return branchCheck.response;
        where.branchId = singleBranchId;
      }
    }

    // Only include non-VOIDED runs
    where.status = { not: 'VOIDED' };

    // Fetch all runs in scope
    const runs = await db.payrollRun.findMany({
      where,
      include: {
        branch: { select: { id: true, name: true, nameEn: true, code: true } },
        items: {
          select: {
            baseAmount: true,
            allowances: true,
            deductions: true,
            advanceAmount: true,
            grossAmount: true,
            netAmount: true,
            employeeId: true,
          },
        },
      },
      orderBy: [{ month: 'asc' }, { branch: { name: 'asc' } }],
    });

    // ─── Per-branch aggregation ─────────────────────────────────
    const branchMap = new Map<
      string,
      {
        branchId: string;
        branchName: string;
        branchNameEn: string | null;
        branchCode: string;
        runCount: number;
        employeeCount: number;
        totalBase: number;
        totalAllowances: number;
        totalDeductions: number;
        totalAdvances: number;
        totalGross: number;
        totalNet: number;
        totalPaid: number;
      }
    >();

    for (const run of runs) {
      const key = run.branchId;
      if (!branchMap.has(key)) {
        branchMap.set(key, {
          branchId: run.branchId,
          branchName: run.branch?.name || run.branchId,
          branchNameEn: run.branch?.nameEn || null,
          branchCode: run.branch?.code || '',
          runCount: 0,
          employeeCount: 0,
          totalBase: 0,
          totalAllowances: 0,
          totalDeductions: 0,
          totalAdvances: 0,
          totalGross: 0,
          totalNet: 0,
          totalPaid: 0,
        });
      }
      const b = branchMap.get(key)!;
      b.runCount += 1;
      b.employeeCount += run.employeeCount;
      b.totalBase = round2(b.totalBase + toNumber(run.totalBase));
      b.totalAllowances = round2(b.totalAllowances + toNumber(run.totalAllowances));
      b.totalDeductions = round2(b.totalDeductions + toNumber(run.totalDeductions));
      b.totalAdvances = round2(b.totalAdvances + toNumber(run.totalAdvances));
      b.totalGross = round2(b.totalGross + toNumber(run.totalGross));
      b.totalNet = round2(b.totalNet + toNumber(run.totalNet));
      b.totalPaid = round2(b.totalPaid + toNumber(run.totalPaid));
    }

    // ─── Monthly aggregation (12 months) ────────────────────────
    const monthlyData: Array<{
      month: number;
      monthName: string;
      runCount: number;
      employeeCount: number;
      totalGross: number;
      totalNet: number;
      totalPaid: number;
    }> = [];
    const monthNamesAr = [
      'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
      'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
    ];
    for (let m = 1; m <= 12; m++) {
      const monthRuns = runs.filter((r) => r.month === m);
      monthlyData.push({
        month: m,
        monthName: monthNamesAr[m - 1],
        runCount: monthRuns.length,
        employeeCount: monthRuns.reduce((sum, r) => sum + r.employeeCount, 0),
        totalGross: round2(monthRuns.reduce((sum, r) => sum + toNumber(r.totalGross), 0)),
        totalNet: round2(monthRuns.reduce((sum, r) => sum + toNumber(r.totalNet), 0)),
        totalPaid: round2(monthRuns.reduce((sum, r) => sum + toNumber(r.totalPaid), 0)),
      });
    }

    // ─── Grand totals ───────────────────────────────────────────
    const grandTotals = {
      runCount: runs.length,
      employeeCount: runs.reduce((sum, r) => sum + r.employeeCount, 0),
      totalBase: round2(runs.reduce((s, r) => s + toNumber(r.totalBase), 0)),
      totalAllowances: round2(runs.reduce((s, r) => s + toNumber(r.totalAllowances), 0)),
      totalDeductions: round2(runs.reduce((s, r) => s + toNumber(r.totalDeductions), 0)),
      totalAdvances: round2(runs.reduce((s, r) => s + toNumber(r.totalAdvances), 0)),
      totalGross: round2(runs.reduce((s, r) => s + toNumber(r.totalGross), 0)),
      totalNet: round2(runs.reduce((s, r) => s + toNumber(r.totalNet), 0)),
      totalPaid: round2(runs.reduce((s, r) => s + toNumber(r.totalPaid), 0)),
    };

    // ─── Advances summary (all advances in the year, scoped) ────
    const advanceWhere: any = {
      date: {
        gte: new Date(year, 0, 1),
        lt: new Date(year + 1, 0, 1),
      },
    };
    if (allowedBranches) {
      advanceWhere.branchId = { in: allowedBranches };
    }
    if (singleBranchId) {
      advanceWhere.branchId = singleBranchId;
    }
    const advanceSummary = await db.salaryAdvance.aggregate({
      where: advanceWhere,
      _sum: { amount: true, settledAmount: true },
      _count: { id: true },
    });

    return NextResponse.json({
      year,
      branch: singleBranchId || 'all',
      branches: Array.from(branchMap.values()).sort((a, b) =>
        a.branchName.localeCompare(b.branchName, 'ar'),
      ),
      monthly: monthlyData,
      grandTotals: {
        ...grandTotals,
        outstandingAdvances:
          toNumber(advanceSummary._sum.amount) -
          toNumber(advanceSummary._sum.settledAmount),
        totalAdvancesIssued: toNumber(advanceSummary._sum.amount),
        advanceCount: advanceSummary._count.id || 0,
      },
    });
  } catch (error: any) {
    console.error('[GET /api/payroll/reports/summary]', error);
    return NextResponse.json(
      { error: 'فشل في تحميل ملخص الرواتب' },
      { status: 500 }
    );
  }
}
