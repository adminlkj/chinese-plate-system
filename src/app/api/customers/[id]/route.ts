import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth, checkWriteAccess, checkReadAccess } from '@/lib/api-auth';
import { toNumber } from '@/lib/decimal';
import { auditLog } from '@/lib/audit-log';

// GET /api/customers/[id]
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth(); if (!auth.authenticated) return auth.response;
    // Context-aware: POS users get READ access via POS_CONTEXT (Layer 2)
    const readCheck = checkReadAccess(auth, 'customers', 'pos'); if (!readCheck.authenticated) return readCheck.response;
    const { id } = await params;
    const customer = await db.customer.findUnique({ where: { id } });
    if (!customer) return NextResponse.json({ error: 'العميل غير موجود' }, { status: 404 });
    return NextResponse.json({
      ...customer,
      discountPercentage: toNumber(customer.discountPercentage),
      balance: toNumber(customer.balance),
    });
  } catch (error) {
    return NextResponse.json({ error: 'فشل في جلب العميل' }, { status: 500 });
  }
}

// PUT /api/customers/[id]
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth(); if (!auth.authenticated) return auth.response;
    const writeCheck = checkWriteAccess(auth, 'customers'); if (!writeCheck.authenticated) return writeCheck.response;
    const { id } = await params;
    const body = await request.json();
    const customer = await db.customer.update({
      where: { id },
      data: {
        ...(body.name ? { name: body.name } : {}),
        ...(body.nameEn !== undefined ? { nameEn: body.nameEn } : {}),
        ...(body.type ? { type: body.type } : {}),
        ...(body.discountPercentage !== undefined ? { discountPercentage: parseFloat(String(body.discountPercentage)) } : {}),
        ...(body.phone !== undefined ? { phone: body.phone } : {}),
        ...(body.email !== undefined ? { email: body.email } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      },
    });
    // AUDIT-9-18
    auditLog({
      action: 'UPDATE',
      entity: 'CUSTOMER',
      entityId: id,
      description: `تحديث عميل: ${customer.name}`,
      userId: auth.userId,
      userName: auth.email,
      userRole: auth.role,
      severity: 'INFO',
      category: 'ACCOUNTING',
      details: { updatedFields: Object.keys(body) },
    }).catch(() => {});
    return NextResponse.json({
      ...customer,
      discountPercentage: toNumber(customer.discountPercentage),
      balance: toNumber(customer.balance),
    });
  } catch (error: any) {
    console.error('[PUT /api/customers/[id]]', error);
    return NextResponse.json({ error: 'فشل في تحديث العميل' }, { status: 500 });
  }
}

// DELETE /api/customers/[id]
// ADMIN can delete ANY customer (soft-delete). Non-admin users are restricted.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth(); if (!auth.authenticated) return auth.response;
    const writeCheck = checkWriteAccess(auth, 'customers'); if (!writeCheck.authenticated) return writeCheck.response;
    const { id } = await params;

    const customer = await db.customer.findUnique({
      where: { id },
      include: { _count: { select: { transactions: true } } },
    });

    if (!customer) {
      // Idempotent: return success even if not found
      return NextResponse.json({ success: true });
    }

    // Non-admin users cannot delete customers with balance or transactions
    if (auth.role !== 'ADMIN') {
      if (toNumber(customer.balance) !== 0) {
        return NextResponse.json(
          { error: 'لا يمكن حذف عميل لديه رصيد مستحق' },
          { status: 400 }
        );
      }

      if (customer._count.transactions > 0) {
        return NextResponse.json(
          { error: 'لا يمكن حذف عميل لديه معاملات مسجلة' },
          { status: 400 }
        );
      }
    }

    // ADMIN can always soft-delete; others can delete if no balance/transactions
    await db.customer.update({ where: { id }, data: { isActive: false } });
    // AUDIT-9-18
    auditLog({
      action: 'DELETE',
      entity: 'CUSTOMER',
      entityId: id,
      description: `تعطيل/حذف عميل: ${customer.name}`,
      userId: auth.userId,
      userName: auth.email,
      userRole: auth.role,
      severity: 'WARNING',
      category: 'ACCOUNTING',
    }).catch(() => {});
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[DELETE /api/customers/[id]]', error);
    return NextResponse.json({ error: 'فشل في حذف العميل' }, { status: 500 });
  }
}
