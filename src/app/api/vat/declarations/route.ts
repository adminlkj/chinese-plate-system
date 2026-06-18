import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { toNumber, round2 } from '@/lib/decimal';
import {
  requireAuth,
  checkReadAccess,
  checkWriteAccess,
  assertBranchAccess,
  safePageSize,
  getUserAllowedBranches,
} from '@/lib/api-auth';
import { resolveBranchIdOrNull, getDefaultBranchId } from '@/lib/branch-resolver';
import { auditLog } from '@/lib/audit-log';

// ═══════════════════════════════════════════════════════════════════
// GET /api/vat/declarations
// Query: branchId, year, quarter, status, page, pageSize
// Lists persisted VAT declarations with filters + pagination (max 100).
// RBAC: checkReadAccess(auth, 'vat') — Layer 2 contexts grant READ too.
// ═══════════════════════════════════════════════════════════════════
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth();
    if (!auth.authenticated) return auth.response;
    const readCheck = checkReadAccess(auth, 'vat');
    if (!readCheck.authenticated) return readCheck.response;

    const { searchParams } = new URL(request.url);
    const branchInput = searchParams.get('branch') || searchParams.get('branchId');
    const year = searchParams.get('year');
    const quarter = searchParams.get('quarter');
    const status = searchParams.get('status');
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = safePageSize(parseInt(searchParams.get('pageSize') || '100'), 200, 100);

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
    if (year) where.year = parseInt(year);
    if (quarter) where.quarter = parseInt(quarter);
    if (status) where.status = status;

    const [declarations, total] = await Promise.all([
      db.vatDeclaration.findMany({
        where,
        include: {
          branch: { select: { id: true, name: true, nameEn: true, code: true } },
        },
        orderBy: [{ year: 'desc' }, { quarter: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.vatDeclaration.count({ where }),
    ]);

    return NextResponse.json({
      declarations: declarations.map((d) => ({
        id: d.id,
        number: d.number,
        branchId: d.branchId,
        branchName: d.branch?.name,
        branchNameEn: d.branch?.nameEn,
        branchCode: d.branch?.code,
        year: d.year,
        quarter: d.quarter,
        status: d.status,
        totalSalesBase: toNumber(d.totalSalesBase),
        totalSalesReturnsBase: toNumber(d.totalSalesReturnsBase),
        netSalesBase: toNumber(d.netSalesBase),
        totalPurchaseBase: toNumber(d.totalPurchaseBase),
        totalPurchaseReturnsBase: toNumber(d.totalPurchaseReturnsBase),
        netPurchaseBase: toNumber(d.netPurchaseBase),
        totalOutputTax: toNumber(d.totalOutputTax),
        totalInputTax: toNumber(d.totalInputTax),
        netVAT: toNumber(d.netVAT),
        createdAt: d.createdAt.toISOString(),
        createdById: d.createdById,
        createdByName: d.createdByName,
        submittedAt: d.submittedAt?.toISOString() || null,
        submittedByName: d.submittedByName,
        lockedAt: d.lockedAt?.toISOString() || null,
        lockedByName: d.lockedByName,
        reopenedAt: d.reopenedAt?.toISOString() || null,
        reopenedByName: d.reopenedByName,
        reopenReason: d.reopenReason,
        notes: d.notes,
      })),
      total,
      page,
      pageSize,
    });
  } catch (error: any) {
    console.error('[GET /api/vat/declarations]', error);
    return NextResponse.json({ error: 'فشل في جلب الإقرارات الضريبية' }, { status: 500 });
  }
}

// ═══════════════════════════════════════════════════════════════════
// POST /api/vat/declarations
// Body: { branchId, year, quarter, notes? }
// Creates a DRAFT declaration with totals snapshotted from Transaction
// records (same logic as /api/vat/quarterly-report).
//
// RBAC: checkWriteAccess(auth, 'vat') — ADMIN+MANAGER
// Duplicate prevention: if a non-VOIDED declaration exists for the same
// branch+year+quarter → 409. Prior VOIDED records are hard-deleted so the
// unique constraint (branchId, year, quarter, status) stays satisfiable.
// ═══════════════════════════════════════════════════════════════════
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth();
    if (!auth.authenticated) return auth.response;
    const writeCheck = checkWriteAccess(auth, 'vat');
    if (!writeCheck.authenticated) return writeCheck.response;

    const body = await request.json();
    const branchId = await resolveBranchIdOrNull(body.branchId || body.branch);
    const finalBranchId = branchId || (await getDefaultBranchId());

    const branchCheck = assertBranchAccess(auth, finalBranchId);
    if (!branchCheck.authenticated) return branchCheck.response;

    const year = parseInt(body.year);
    const quarter = parseInt(body.quarter);
    if (!year || year < 2000 || year > 2100) {
      return NextResponse.json({ error: 'السنة غير صحيحة' }, { status: 400 });
    }
    if (!quarter || quarter < 1 || quarter > 4) {
      return NextResponse.json({ error: 'الربع يجب أن يكون بين 1 و 4' }, { status: 400 });
    }

    // ─── Duplicate prevention ───
    // If any non-VOIDED declaration exists for this period, reject with 409.
    const existing = await db.vatDeclaration.findMany({
      where: { branchId: finalBranchId, year, quarter, status: { not: 'VOIDED' } },
      select: { id: true, status: true, number: true },
    });
    if (existing.length > 0) {
      return NextResponse.json(
        {
          error: `يوجد إقرار ضريبي لهذه الفترة (${finalBranchId}/${year}/Q${quarter}) بحالة ${existing[0].status}`,
          existingNumber: existing[0].number,
        },
        { status: 409 }
      );
    }

    // Hard-delete any prior VOIDED records so the unique constraint
    // (branchId, year, quarter, status=VOIDED) stays satisfiable for future deletes.
    await db.vatDeclaration.deleteMany({
      where: { branchId: finalBranchId, year, quarter, status: 'VOIDED' },
    });

    // ─── Compute totals from Transaction records ───
    // Same logic as /api/vat/quarterly-report (uses Transaction.taxAmount,
    // NOT journal line balances — those include settlement entries).
    const quarterStartMonth = (quarter - 1) * 3;
    const startDate = new Date(year, quarterStartMonth, 1);
    const endDate = new Date(year, quarterStartMonth + 3, 1);

    const salesTxns = await db.transaction.findMany({
      where: {
        type: { in: ['SALE', 'SALE_RETURN'] },
        status: 'POSTED',
        date: { gte: startDate, lt: endDate },
      },
      select: { type: true, totalAmount: true, taxAmount: true },
    });
    const purchaseTxns = await db.transaction.findMany({
      where: {
        type: { in: ['PURCHASE', 'PURCHASE_RETURN', 'EXPENSE'] },
        status: 'POSTED',
        date: { gte: startDate, lt: endDate },
      },
      select: { type: true, totalAmount: true, taxAmount: true },
    });

    const totalSalesBase = round2(
      salesTxns.filter(t => t.type === 'SALE').reduce((s, t) => s + toNumber(t.totalAmount), 0)
    );
    const totalSalesReturnsBase = round2(
      salesTxns.filter(t => t.type === 'SALE_RETURN').reduce((s, t) => s + toNumber(t.totalAmount), 0)
    );
    const netSalesBase = round2(totalSalesBase - totalSalesReturnsBase);

    const totalPurchaseBase = round2(
      purchaseTxns.filter(t => t.type !== 'PURCHASE_RETURN').reduce((s, t) => s + toNumber(t.totalAmount), 0)
    );
    const totalPurchaseReturnsBase = round2(
      purchaseTxns.filter(t => t.type === 'PURCHASE_RETURN').reduce((s, t) => s + toNumber(t.totalAmount), 0)
    );
    const netPurchaseBase = round2(totalPurchaseBase - totalPurchaseReturnsBase);

    const totalOutputTax = round2(
      salesTxns.filter(t => t.type === 'SALE').reduce((s, t) => s + toNumber(t.taxAmount), 0)
      - salesTxns.filter(t => t.type === 'SALE_RETURN').reduce((s, t) => s + toNumber(t.taxAmount), 0)
    );
    const totalInputTax = round2(
      purchaseTxns.filter(t => t.type !== 'PURCHASE_RETURN').reduce((s, t) => s + toNumber(t.taxAmount), 0)
      - purchaseTxns.filter(t => t.type === 'PURCHASE_RETURN').reduce((s, t) => s + toNumber(t.taxAmount), 0)
    );
    const netVAT = round2(totalOutputTax - totalInputTax);

    // ─── Generate sequential number VAT-{year}-Q{quarter}-{seq:0001} ───
    const prefix = `VAT-${year}-Q${quarter}-`;
    const lastWithPrefix = await db.vatDeclaration.findFirst({
      where: { number: { startsWith: prefix } },
      orderBy: { number: 'desc' },
      select: { number: true },
    });
    let nextSeq = 1;
    if (lastWithPrefix?.number) {
      const tail = lastWithPrefix.number.slice(prefix.length);
      const parsed = parseInt(tail);
      if (Number.isFinite(parsed) && parsed >= 1) nextSeq = parsed + 1;
    }
    const number = `${prefix}${String(nextSeq).padStart(4, '0')}`;

    const notes = body.notes ? String(body.notes).slice(0, 1000) : null;

    const declaration = await db.vatDeclaration.create({
      data: {
        number,
        branchId: finalBranchId,
        year,
        quarter,
        status: 'DRAFT',
        totalSalesBase,
        totalSalesReturnsBase,
        netSalesBase,
        totalPurchaseBase,
        totalPurchaseReturnsBase,
        netPurchaseBase,
        totalOutputTax,
        totalInputTax,
        netVAT,
        createdById: auth.userId,
        createdByName: auth.email,
        notes,
      },
      include: {
        branch: { select: { id: true, name: true, nameEn: true, code: true } },
      },
    });

    // Audit log
    auditLog({
      action: 'CREATE',
      entity: 'VAT',
      entityId: declaration.id,
      entityNumber: declaration.number,
      description: `إنشاء إقرار ضريبي ${declaration.number} للفترة ${year}/Q${quarter} - صافي الضريبة: ${netVAT}`,
      details: {
        branchId: finalBranchId,
        year,
        quarter,
        number: declaration.number,
        netVAT,
        totalOutputTax,
        totalInputTax,
      },
      userId: auth.userId,
      userName: auth.email,
      userRole: auth.role,
      branchId: finalBranchId,
      severity: 'INFO',
      category: 'ACCOUNTING',
    }).catch(() => {});

    return NextResponse.json({
      id: declaration.id,
      number: declaration.number,
      branchId: declaration.branchId,
      branchName: declaration.branch?.name,
      branchCode: declaration.branch?.code,
      year: declaration.year,
      quarter: declaration.quarter,
      status: declaration.status,
      totalSalesBase,
      totalSalesReturnsBase,
      netSalesBase,
      totalPurchaseBase,
      totalPurchaseReturnsBase,
      netPurchaseBase,
      totalOutputTax,
      totalInputTax,
      netVAT,
      createdAt: declaration.createdAt.toISOString(),
      createdByName: declaration.createdByName,
      notes: declaration.notes,
    }, { status: 201 });
  } catch (error: any) {
    console.error('[POST /api/vat/declarations]', error);
    const isConflict = error?.code === 'P2002' || error?.code === 'P2003';
    return NextResponse.json(
      { error: isConflict ? 'يوجد إقرار غير ملغى لنفس الفترة — احذفه أو أعد فتحه أولاً' : 'فشل في إنشاء الإقرار الضريبي' },
      { status: isConflict ? 409 : 500 }
    );
  }
}
