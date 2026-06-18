import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { toNumber } from '@/lib/decimal';
import {
  requireAuth,
  checkReadAccess,
  assertBranchAccess,
  sanitizeInput,
} from '@/lib/api-auth';
import { auditLog } from '@/lib/audit-log';

// ═══════════════════════════════════════════════════════════════════
// GET /api/vat/declarations/[id]
// Returns full declaration detail including workflow history.
// RBAC: checkReadAccess(auth, 'vat')
// ═══════════════════════════════════════════════════════════════════
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth();
    if (!auth.authenticated) return auth.response;
    const readCheck = checkReadAccess(auth, 'vat');
    if (!readCheck.authenticated) return readCheck.response;

    const { id } = await params;
    const d = await db.vatDeclaration.findUnique({
      where: { id },
      include: {
        branch: { select: { id: true, name: true, nameEn: true, code: true } },
      },
    });
    if (!d) {
      return NextResponse.json({ error: 'الإقرار الضريبي غير موجود' }, { status: 404 });
    }
    const branchCheck = assertBranchAccess(auth, d.branchId);
    if (!branchCheck.authenticated) return branchCheck.response;

    return NextResponse.json({
      id: d.id,
      number: d.number,
      branchId: d.branchId,
      branchName: d.branch?.name,
      branchNameEn: d.branch?.nameEn,
      branchCode: d.branch?.code,
      year: d.year,
      quarter: d.quarter,
      status: d.status,
      totals: {
        totalSalesBase: toNumber(d.totalSalesBase),
        totalSalesReturnsBase: toNumber(d.totalSalesReturnsBase),
        netSalesBase: toNumber(d.netSalesBase),
        totalPurchaseBase: toNumber(d.totalPurchaseBase),
        totalPurchaseReturnsBase: toNumber(d.totalPurchaseReturnsBase),
        netPurchaseBase: toNumber(d.netPurchaseBase),
        totalOutputTax: toNumber(d.totalOutputTax),
        totalInputTax: toNumber(d.totalInputTax),
        netVAT: toNumber(d.netVAT),
      },
      workflow: {
        createdAt: d.createdAt.toISOString(),
        createdById: d.createdById,
        createdByName: d.createdByName,
        submittedAt: d.submittedAt?.toISOString() || null,
        submittedById: d.submittedById,
        submittedByName: d.submittedByName,
        lockedAt: d.lockedAt?.toISOString() || null,
        lockedById: d.lockedById,
        lockedByName: d.lockedByName,
        reopenedAt: d.reopenedAt?.toISOString() || null,
        reopenedById: d.reopenedById,
        reopenedByName: d.reopenedByName,
        reopenReason: d.reopenReason,
      },
      notes: d.notes,
    });
  } catch (error: any) {
    console.error('[GET /api/vat/declarations/[id]]', error);
    return NextResponse.json({ error: 'فشل في جلب بيانات الإقرار الضريبي' }, { status: 500 });
  }
}

// ═══════════════════════════════════════════════════════════════════
// DELETE /api/vat/declarations/[id]
// Soft-deletes a DRAFT declaration (sets status to VOIDED).
// ADMIN ONLY.
// Returns 423 (Locked) if status is SUBMITTED or LOCKED — those cannot
// be deleted; use /reopen first.
// ═══════════════════════════════════════════════════════════════════
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth();
    if (!auth.authenticated) return auth.response;

    // ── ADMIN ONLY ──
    if (auth.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'صلاحية غير كافية — حذف الإقرار يتطلب صلاحية مدير النظام (ADMIN)' },
        { status: 403 }
      );
    }

    const { id } = await params;
    const existing = await db.vatDeclaration.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: 'الإقرار الضريبي غير موجود' }, { status: 404 });
    }

    const branchCheck = assertBranchAccess(auth, existing.branchId);
    if (!branchCheck.authenticated) return branchCheck.response;

    if (existing.status === 'SUBMITTED' || existing.status === 'LOCKED') {
      return NextResponse.json(
        { error: `لا يمكن حذف إقرار بحالة ${existing.status}. أعد فتح الإقرار أولاً.` },
        { status: 423 }
      );
    }

    // If already VOIDED, idempotent success
    if (existing.status === 'VOIDED') {
      return NextResponse.json({ success: true, id, status: 'VOIDED' });
    }

    // Status === 'DRAFT' → soft-delete to VOIDED.
    // First hard-delete any prior VOIDED record for this period so the unique
    // constraint (branchId, year, quarter, status=VOIDED) is satisfiable.
    await db.vatDeclaration.deleteMany({
      where: {
        branchId: existing.branchId,
        year: existing.year,
        quarter: existing.quarter,
        status: 'VOIDED',
        id: { not: existing.id },
      },
    });

    const updated = await db.vatDeclaration.update({
      where: { id },
      data: { status: 'VOIDED' },
    });

    auditLog({
      action: 'DELETE',
      entity: 'VAT',
      entityId: id,
      entityNumber: existing.number,
      description: `حذف (إلغاء) إقرار ضريبي ${existing.number} للفترة ${existing.year}/Q${existing.quarter}`,
      details: {
        branchId: existing.branchId,
        year: existing.year,
        quarter: existing.quarter,
        number: existing.number,
        previousStatus: existing.status,
        netVAT: toNumber(existing.netVAT),
      },
      userId: auth.userId,
      userName: auth.email,
      userRole: auth.role,
      branchId: existing.branchId,
      severity: 'WARNING',
      category: 'ACCOUNTING',
    }).catch(() => {});

    return NextResponse.json({
      success: true,
      id,
      number: existing.number,
      status: updated.status,
    });
  } catch (error: any) {
    console.error('[DELETE /api/vat/declarations/[id]]', error);
    return NextResponse.json({ error: 'فشل في حذف الإقرار الضريبي' }, { status: 500 });
  }
}

// Helper exported for reuse — sanitize a notes string input.
export function sanitizeNotes(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const trimmed = sanitizeInput(input);
  return trimmed ? trimmed.slice(0, 1000) : null;
}
