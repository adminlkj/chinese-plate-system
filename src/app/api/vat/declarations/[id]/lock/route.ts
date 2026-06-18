import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  requireAuth,
  assertBranchAccess,
} from '@/lib/api-auth';
import { auditLog } from '@/lib/audit-log';

// ═══════════════════════════════════════════════════════════════════
// POST /api/vat/declarations/[id]/lock
// State transition: SUBMITTED → LOCKED
//
// Fully closes the declaration. To modify after this, ADMIN must /reopen.
//
// RBAC: ADMIN ONLY (auth.role !== 'ADMIN' → 403)
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
        { error: 'صلاحية غير كافية — إقفال الإقرار يتطلب صلاحية مدير النظام (ADMIN)' },
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

    if (existing.status !== 'SUBMITTED') {
      return NextResponse.json(
        { error: `لا يمكن إقفال إقرار بحالة ${existing.status}. يجب تقديم الإقرار أولاً.` },
        { status: 423 }
      );
    }

    const updated = await db.vatDeclaration.update({
      where: { id },
      data: {
        status: 'LOCKED',
        lockedAt: new Date(),
        lockedById: auth.userId,
        lockedByName: auth.email,
      },
    });

    auditLog({
      action: 'CLOSE',
      entity: 'VAT',
      entityId: id,
      entityNumber: existing.number,
      description: `إقفال الإقرار الضريبي ${existing.number} (SUBMITTED → LOCKED)`,
      details: {
        branchId: existing.branchId,
        year: existing.year,
        quarter: existing.quarter,
        number: existing.number,
        previousStatus: 'SUBMITTED',
        newStatus: 'LOCKED',
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
      lockedAt: updated.lockedAt?.toISOString(),
      lockedById: updated.lockedById,
      lockedByName: updated.lockedByName,
    });
  } catch (error: any) {
    console.error('[POST /api/vat/declarations/[id]/lock]', error);
    return NextResponse.json({ error: 'فشل في قفل الإقرار الضريبي' }, { status: 500 });
  }
}
