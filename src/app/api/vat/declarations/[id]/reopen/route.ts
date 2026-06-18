import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  requireAuth,
  assertBranchAccess,
  sanitizeInput,
} from '@/lib/api-auth';
import { auditLog } from '@/lib/audit-log';

// ═══════════════════════════════════════════════════════════════════
// POST /api/vat/declarations/[id]/reopen
// State transition: LOCKED|SUBMITTED → DRAFT|SUBMITTED (ADMIN only)
//
// Body: { reason: string, targetStatus: 'DRAFT' | 'SUBMITTED' }
//   - `reason` is MANDATORY (audit trail) — 400 if missing/empty
//   - `targetStatus` defaults to 'DRAFT' if omitted; must be 'DRAFT' or 'SUBMITTED'
//
// RBAC: ADMIN ONLY (auth.role !== 'ADMIN' → 403)
// Audit severity: CRITICAL (reopening a closed declaration is a sensitive op)
// ═══════════════════════════════════════════════════════════════════
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth();
    if (!auth.authenticated) return auth.response;

    // ── ADMIN ONLY ──
    if (auth.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'صلاحية غير كافية — إعادة فتح الإقرار يتطلب صلاحية مدير النظام (ADMIN)' },
        { status: 403 }
      );
    }

    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const reason = body.reason ? sanitizeInput(body.reason) : '';
    if (!reason) {
      return NextResponse.json(
        { error: 'سبب إعادة فتح الإقرار مطلوب (للسجل التدقيقي)' },
        { status: 400 }
      );
    }

    const targetStatus = body.targetStatus === 'SUBMITTED' ? 'SUBMITTED' : 'DRAFT';

    const existing = await db.vatDeclaration.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: 'الإقرار الضريبي غير موجود' }, { status: 404 });
    }

    const branchCheck = assertBranchAccess(auth, existing.branchId);
    if (!branchCheck.authenticated) return branchCheck.response;

    if (existing.status !== 'SUBMITTED' && existing.status !== 'LOCKED') {
      return NextResponse.json(
        { error: `لا يمكن إعادة فتح إقرار بحالة ${existing.status}. يمكن فقط إعادة فتح الإقرارات المقدمة أو المقفلة.` },
        { status: 423 }
      );
    }

    if (existing.status === targetStatus) {
      return NextResponse.json(
        { error: `الإقرار بالفعل في الحالة المطلوبة (${targetStatus})` },
        { status: 400 }
      );
    }

    // When reopening, preserve the original submission/lock audit columns
    // (do not null them out) — they remain part of the historical record.
    // The reopened* fields capture THIS reopen event.
    const updated = await db.vatDeclaration.update({
      where: { id },
      data: {
        status: targetStatus,
        reopenedAt: new Date(),
        reopenedById: auth.userId,
        reopenedByName: auth.email,
        reopenReason: reason,
      },
    });

    auditLog({
      action: 'RECOVER',
      entity: 'VAT',
      entityId: id,
      entityNumber: existing.number,
      description: `إعادة فتح الإقرار الضريبي ${existing.number} (${existing.status} → ${targetStatus}) - السبب: ${reason}`,
      details: {
        branchId: existing.branchId,
        year: existing.year,
        quarter: existing.quarter,
        number: existing.number,
        previousStatus: existing.status,
        newStatus: targetStatus,
        reason,
      },
      userId: auth.userId,
      userName: auth.email,
      userRole: auth.role,
      branchId: existing.branchId,
      severity: 'CRITICAL',
      category: 'ACCOUNTING',
    }).catch(() => {});

    return NextResponse.json({
      success: true,
      id,
      number: existing.number,
      status: updated.status,
      reopenedAt: updated.reopenedAt?.toISOString(),
      reopenedById: updated.reopenedById,
      reopenedByName: updated.reopenedByName,
      reopenReason: updated.reopenReason,
    });
  } catch (error: any) {
    console.error('[POST /api/vat/declarations/[id]/reopen]', error);
    return NextResponse.json({ error: 'فشل في إعادة فتح الإقرار الضريبي' }, { status: 500 });
  }
}
