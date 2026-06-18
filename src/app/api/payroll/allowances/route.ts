import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  requireAuth,
  checkReadAccess,
  checkWriteAccess,
  assertBranchAccess,
  safePageSize,
  sanitizeInput,
  getUserAllowedBranches,
} from '@/lib/api-auth';
import { resolveBranchIdOrNull } from '@/lib/branch-resolver';

// GET /api/payroll/allowances
// Query: branch, category (ALLOWANCE|DEDUCTION), isActive, page, pageSize
// Returns AllowanceType records for the branch (the templates)
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth();
    if (!auth.authenticated) return auth.response;
    const readCheck = checkReadAccess(auth, 'payroll');
    if (!readCheck.authenticated) return readCheck.response;

    const { searchParams } = new URL(request.url);
    const branchInput = searchParams.get('branch') || searchParams.get('branchId');
    const category = searchParams.get('category');
    const isActive = searchParams.get('isActive');
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = safePageSize(parseInt(searchParams.get('pageSize') || '100'));

    const where: any = {};
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
    if (category) where.category = category;
    if (isActive === 'true') where.isActive = true;
    if (isActive === 'false') where.isActive = false;

    const [types, total] = await Promise.all([
      db.allowanceType.findMany({
        where,
        include: {
          branch: { select: { id: true, name: true, code: true } },
          _count: { select: { employeeAllowances: true } },
        },
        orderBy: [{ category: 'asc' }, { code: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.allowanceType.count({ where }),
    ]);

    // If no types exist yet for this branch, return a suggested set of defaults
    let defaults: any[] = [];
    if (types.length === 0 && branchInput && branchInput !== 'all') {
      const branchId = await resolveBranchIdOrNull(branchInput);
      if (branchId) {
        defaults = [
          { code: 'HOUSING', name: 'بدل سكن', nameEn: 'Housing Allowance', category: 'ALLOWANCE', defaultAmount: 1000 },
          { code: 'TRANSPORT', name: 'بدل نقل', nameEn: 'Transport Allowance', category: 'ALLOWANCE', defaultAmount: 300 },
          { code: 'COMMUNICATION', name: 'بدل اتصال', nameEn: 'Communication Allowance', category: 'ALLOWANCE', defaultAmount: 200 },
          { code: 'BONUS', name: 'مكافأة', nameEn: 'Bonus', category: 'ALLOWANCE', defaultAmount: 0 },
          { code: 'COMMISSION', name: 'عمولة', nameEn: 'Commission', category: 'ALLOWANCE', defaultAmount: 0 },
          { code: 'OVERTIME', name: 'بدل عمل إضافي', nameEn: 'Overtime', category: 'ALLOWANCE', defaultAmount: 0 },
          { code: 'GOSI', name: 'خصم التأمينات', nameEn: 'GOSI Deduction', category: 'DEDUCTION', defaultAmount: 10, isPercentage: true },
          { code: 'PENALTY', name: 'غرامة', nameEn: 'Penalty', category: 'DEDUCTION', defaultAmount: 0 },
        ];
      }
    }

    return NextResponse.json({
      types: types.map((t) => ({
        id: t.id,
        code: t.code,
        name: t.name,
        nameEn: t.nameEn,
        category: t.category,
        isPercentage: t.isPercentage,
        defaultAmount: Number(t.defaultAmount),
        isRecurring: t.isRecurring,
        isActive: t.isActive,
        branchId: t.branchId,
        branchName: t.branch?.name,
        branchCode: t.branch?.code,
        employeeCount: t._count.employeeAllowances,
        createdAt: t.createdAt.toISOString(),
      })),
      defaults,
      total,
      page,
      pageSize,
    });
  } catch (error: any) {
    console.error('[GET /api/payroll/allowances]', error);
    return NextResponse.json(
      { error: 'فشل في تحميل أنواع البدلات' },
      { status: 500 }
    );
  }
}

// POST /api/payroll/allowances — create a new AllowanceType
// Body: { branchId, code, name, nameEn?, category, isPercentage, defaultAmount, isRecurring }
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth();
    if (!auth.authenticated) return auth.response;
    const writeCheck = checkWriteAccess(auth, 'payroll');
    if (!writeCheck.authenticated) return writeCheck.response;

    const body = await request.json();
    const branchId = await resolveBranchIdOrNull(body.branchId || body.branch);
    if (!branchId) {
      return NextResponse.json({ error: 'الفرع مطلوب' }, { status: 400 });
    }
    const branchCheck = assertBranchAccess(auth, branchId);
    if (!branchCheck.authenticated) return branchCheck.response;

    const code = (body.code || '').trim().toUpperCase();
    const name = (body.name || '').trim();
    if (!code || !name) {
      return NextResponse.json(
        { error: 'كود البدل والاسم مطلوبان' },
        { status: 400 }
      );
    }
    const category = body.category === 'DEDUCTION' ? 'DEDUCTION' : 'ALLOWANCE';

    // Prevent duplicate code within branch
    const existing = await db.allowanceType.findUnique({
      where: { branchId_code: { branchId, code } },
    });
    if (existing) {
      return NextResponse.json(
        { error: `يوجد بدل بنفس الكود "${code}" في هذا الفرع` },
        { status: 409 }
      );
    }

    const created = await db.allowanceType.create({
      data: {
        code,
        name: sanitizeInput(name),
        nameEn: body.nameEn ? sanitizeInput(body.nameEn) : null,
        category,
        isPercentage: !!body.isPercentage,
        defaultAmount: Number(body.defaultAmount || 0),
        isRecurring: body.isRecurring !== false,
        isActive: body.isActive !== false,
        branchId,
      },
      include: { branch: { select: { name: true, code: true } } },
    });

    return NextResponse.json({
      id: created.id,
      code: created.code,
      name: created.name,
      nameEn: created.nameEn,
      category: created.category,
      isPercentage: created.isPercentage,
      defaultAmount: Number(created.defaultAmount),
      isRecurring: created.isRecurring,
      isActive: created.isActive,
      branchId: created.branchId,
      branchName: created.branch?.name,
    });
  } catch (error: any) {
    console.error('[POST /api/payroll/allowances]', error);
    return NextResponse.json(
      { error: 'فشل في إنشاء نوع البدل' },
      { status: 500 }
    );
  }
}
