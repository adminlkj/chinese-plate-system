import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  requireAuth,
  checkWriteAccess,
  assertBranchAccess,
} from '@/lib/api-auth';
import { auditLog } from '@/lib/audit-log';

// ═══════════════════════════════════════════════════════════════════
// POST /api/vat/declarations/[id]/submit
// State transition: DRAFT → SUBMITTED
//
// After submission the declaration is locked from editing but not
// finalized. Use /lock to fully close it (ADMIN only).
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
        { error: `لا يمكن تقديم إقرار بحالة ${existing.status}. يجب أن يكون الإقرار في حالة مسودة.` },
        { status: 423 }
      );
    }

    const updated = await db.vatDeclaration.update({
      where: { id },
      data: {
        status: 'SUBMITTED',
        submittedAt: new Date(),
        submittedById: auth.userId,
        submittedByName: auth.email,
      },
    });

    auditLog({
      action: 'FINALIZE',
      entity: 'VAT',
      entityId: id,
      entityNumber: existing.number,
      description: `تقديم الإقرار الضريبي ${existing.number} للمراجعة (DRAFT → SUBMITTED)`,
      details: {
        branchId: existing.branchId,
        year: existing.year,
        quarter: existing.quarter,
        number: existing.number,
        previousStatus: 'DRAFT',
        newStatus: 'SUBMITTED',
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
      submittedAt: updated.submittedAt?.toISOString(),
      submittedById: updated.submittedById,
      submittedByName: updated.submittedByName,
    });
  } catch (error: any) {
    console.error('[POST /api/vat/declarations/[id]/submit]', error);
    return NextResponse.json({ error: 'فشل في تقديم الإقرار الضريبي' }, { status: 500 });
  }
}
