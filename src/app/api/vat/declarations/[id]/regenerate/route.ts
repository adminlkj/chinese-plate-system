import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { toNumber, round2 } from '@/lib/decimal';
import {
  requireAuth,
  checkWriteAccess,
  assertBranchAccess,
} from '@/lib/api-auth';
import { auditLog } from '@/lib/audit-log';

// ═══════════════════════════════════════════════════════════════════
// POST /api/vat/declarations/[id]/regenerate
// Recomputes totals from Transaction records (only allowed if status === 'DRAFT').
//
// Body: (none required)
// Returns the recomputed totals + audit log entry.
//
// RBAC: checkWriteAccess(auth, 'vat') — ADMIN+MANAGER
// ═══════════════════════════════════════════════════════════════════
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth();
    if (!auth.authenticated) return auth.response;
    const writeCheck = checkWriteAccess(auth, 'vat');
    if (!writeCheck.authenticated) return writeCheck.response;

    const { id } = await params;
    const existing = await db.vatDeclaration.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: 'الإقرار الضريبي غير موجود' }, { status: 404 });
    }

    const branchCheck = assertBranchAccess(auth, existing.branchId);
    if (!branchCheck.authenticated) return branchCheck.response;

    if (existing.status !== 'DRAFT') {
      return NextResponse.json(
        { error: `لا يمكن إعادة احتساب إقرار بحالة ${existing.status}. يمكن فقط إعادة احتساب المسودات.` },
        { status: 423 }
      );
    }

    // ─── Recompute totals from Transaction records ───
    const { year, quarter } = existing;
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

    const prevTotals = {
      totalSalesBase: toNumber(existing.totalSalesBase),
      totalSalesReturnsBase: toNumber(existing.totalSalesReturnsBase),
      netSalesBase: toNumber(existing.netSalesBase),
      totalPurchaseBase: toNumber(existing.totalPurchaseBase),
      totalPurchaseReturnsBase: toNumber(existing.totalPurchaseReturnsBase),
      netPurchaseBase: toNumber(existing.netPurchaseBase),
      totalOutputTax: toNumber(existing.totalOutputTax),
      totalInputTax: toNumber(existing.totalInputTax),
      netVAT: toNumber(existing.netVAT),
    };

    const updated = await db.vatDeclaration.update({
      where: { id },
      data: {
        totalSalesBase,
        totalSalesReturnsBase,
        netSalesBase,
        totalPurchaseBase,
        totalPurchaseReturnsBase,
        netPurchaseBase,
        totalOutputTax,
        totalInputTax,
        netVAT,
      },
    });

    auditLog({
      action: 'UPDATE',
      entity: 'VAT',
      entityId: id,
      entityNumber: existing.number,
      description: `إعادة احتساب الإقرار الضريبي ${existing.number} - صافي الضريبة الجديد: ${netVAT} (السابق: ${prevTotals.netVAT})`,
      details: {
        branchId: existing.branchId,
        year: existing.year,
        quarter: existing.quarter,
        number: existing.number,
        previous: prevTotals,
        next: {
          totalSalesBase,
          totalSalesReturnsBase,
          netSalesBase,
          totalPurchaseBase,
          totalPurchaseReturnsBase,
          netPurchaseBase,
          totalOutputTax,
          totalInputTax,
          netVAT,
        },
      },
      userId: auth.userId,
      userName: auth.email,
      userRole: auth.role,
      branchId: existing.branchId,
      severity: 'INFO',
      category: 'ACCOUNTING',
    }).catch(() => {});

    return NextResponse.json({
      success: true,
      id,
      number: existing.number,
      status: updated.status,
      totals: {
        totalSalesBase,
        totalSalesReturnsBase,
        netSalesBase,
        totalPurchaseBase,
        totalPurchaseReturnsBase,
        netPurchaseBase,
        totalOutputTax,
        totalInputTax,
        netVAT,
      },
      previousTotals: prevTotals,
    });
  } catch (error: any) {
    console.error('[POST /api/vat/declarations/[id]/regenerate]', error);
    return NextResponse.json({ error: 'فشل في إعادة حساب الإقرار الضريبي' }, { status: 500 });
  }
}
