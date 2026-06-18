import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth, checkWriteAccess, checkReadAccess } from '@/lib/api-auth';
import { toNumber } from '@/lib/decimal';
import { auditLog } from '@/lib/audit-log';

// GET /api/suppliers/[id]
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth(); if (!auth.authenticated) return auth.response;
    const readCheck = checkReadAccess(auth, 'suppliers'); if (!readCheck.authenticated) return readCheck.response;
    const { id } = await params;
    const supplier = await db.supplier.findUnique({ where: { id } });
    if (!supplier) return NextResponse.json({ error: 'المورد غير موجود' }, { status: 404 });
    return NextResponse.json({
      ...supplier,
      balance: toNumber(supplier.balance),
    });
  } catch (error) {
    return NextResponse.json({ error: 'فشل في جلب المورد' }, { status: 500 });
  }
}

// PUT /api/suppliers/[id]
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth(); if (!auth.authenticated) return auth.response;
    const writeCheck = checkWriteAccess(auth, 'suppliers'); if (!writeCheck.authenticated) return writeCheck.response;
    const { id } = await params;
    const body = await request.json();
    const supplier = await db.supplier.update({
      where: { id },
      data: {
        ...(body.name ? { name: body.name } : {}),
        ...(body.nameEn !== undefined ? { nameEn: body.nameEn } : {}),
        ...(body.phone !== undefined ? { phone: body.phone } : {}),
        ...(body.email !== undefined ? { email: body.email } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      },
    });
    // AUDIT-9-18
    auditLog({
      action: 'UPDATE',
      entity: 'SUPPLIER',
      entityId: id,
      description: `تحديث مورد: ${supplier.name}`,
      userId: auth.userId,
      userName: auth.email,
      userRole: auth.role,
      severity: 'INFO',
      category: 'ACCOUNTING',
      details: { updatedFields: Object.keys(body) },
    }).catch(() => {});
    return NextResponse.json({
      ...supplier,
      balance: toNumber(supplier.balance),
    });
  } catch (error: any) {
    console.error('[PUT /api/suppliers/[id]]', error);
    return NextResponse.json({ error: 'فشل في تحديث المورد' }, { status: 500 });
  }
}

// DELETE /api/suppliers/[id]
// ADMIN can delete ANY supplier (soft-delete). Non-admin users are restricted.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth(); if (!auth.authenticated) return auth.response;
    const writeCheck = checkWriteAccess(auth, 'suppliers'); if (!writeCheck.authenticated) return writeCheck.response;
    const { id } = await params;

    const supplier = await db.supplier.findUnique({
      where: { id },
      include: { _count: { select: { transactions: true } } },
    });

    if (!supplier) {
      // Idempotent: return success even if not found
      return NextResponse.json({ success: true });
    }

    // Non-admin users cannot delete suppliers with balance or transactions
    if (auth.role !== 'ADMIN') {
      if (toNumber(supplier.balance) !== 0) {
        return NextResponse.json(
          { error: 'لا يمكن حذف مورد لديه رصيد مستحق' },
          { status: 400 }
        );
      }

      if (supplier._count.transactions > 0) {
        return NextResponse.json(
          { error: 'لا يمكن حذف مورد لديه معاملات مسجلة' },
          { status: 400 }
        );
      }
    }

    // ADMIN can always soft-delete; others can delete if no balance/transactions
    await db.supplier.update({ where: { id }, data: { isActive: false } });
    // AUDIT-9-18
    auditLog({
      action: 'DELETE',
      entity: 'SUPPLIER',
      entityId: id,
      description: `تعطيل/حذف مورد: ${supplier.name}`,
      userId: auth.userId,
      userName: auth.email,
      userRole: auth.role,
      severity: 'WARNING',
      category: 'ACCOUNTING',
    }).catch(() => {});
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[DELETE /api/suppliers/[id]]', error);
    return NextResponse.json({ error: 'فشل في حذف المورد' }, { status: 500 });
  }
}
