import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth, checkWriteAccess, checkReadAccess, sanitizeInput, assertBranchAccess } from '@/lib/api-auth';
import { resolveBranchId, resolveBranchIdOrNull } from '@/lib/branch-resolver';

// GET /api/pos/tables - List all tables, optionally filter by branch
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(); if (!auth.authenticated) return auth.response;
    const readCheck = checkReadAccess(auth, 'pos'); if (!readCheck.authenticated) return readCheck.response;
    const { searchParams } = new URL(request.url);
    const branchInput = searchParams.get('branch') || searchParams.get('branchId');

    const branchId = await resolveBranchIdOrNull(branchInput);

    // Verify branch access if branch filter is specified (use the RESOLVED UUID)
    if (branchId) {
      const branchCheck = assertBranchAccess(auth, branchId);
      if (!branchCheck.authenticated) return branchCheck.response;
    }

    const where: any = {};
    if (branchId) where.branchId = branchId;

    const tables = await db.restaurantTable.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: {
        _count: { select: { invoices: true } },
      },
    });

    return NextResponse.json(
      tables.map((t) => ({
        id: t.id,
        name: t.name,
        branchId: t.branchId,
        isActive: t.isActive,
        sortOrder: t.sortOrder,
        invoiceCount: t._count.invoices,
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
      }))
    );
  } catch (error: any) {
    console.error('Error fetching tables:', error);
    return NextResponse.json(
      { error: 'فشل في جلب الطاولات' },
      { status: 500 }
    );
  }
}

// POST /api/pos/tables - Create a new table
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(); if (!auth.authenticated) return auth.response;
    const writeCheck = checkWriteAccess(auth, 'pos'); if (!writeCheck.authenticated) return writeCheck.response;
    const body = await request.json();
    const { sortOrder } = body;
    const name = sanitizeInput(body.name);

    if (!name) {
      return NextResponse.json(
        { error: 'اسم الطاولة مطلوب' },
        { status: 400 }
      );
    }

    const branchId = await resolveBranchId(body.branch || body.branchId);
    if (!branchId) {
      return NextResponse.json(
        { error: 'الفرع مطلوب' },
        { status: 400 }
      );
    }

    // Verify the user has access to this branch
    const branchCheck = assertBranchAccess(auth, body.branch || body.branchId);
    if (!branchCheck.authenticated) return branchCheck.response;

    const table = await db.restaurantTable.create({
      data: {
        name,
        branchId,
        sortOrder: sortOrder ?? 0,
        isActive: true,
      },
    });

    return NextResponse.json(table);
  } catch (error: any) {
    console.error('Error creating table:', error);
    return NextResponse.json(
      { error: 'فشل في إنشاء الطاولة' },
      { status: 500 }
    );
  }
}

// PUT /api/pos/tables - Update a table
export async function PUT(request: NextRequest) {
  try {
    const auth = await requireAuth(); if (!auth.authenticated) return auth.response;
    const writeCheck = checkWriteAccess(auth, 'pos'); if (!writeCheck.authenticated) return writeCheck.response;
    const body = await request.json();
    const { id, isActive, sortOrder } = body;
    const name = body.name !== undefined ? sanitizeInput(body.name) : undefined;

    if (!id) {
      return NextResponse.json(
        { error: 'معرف الطاولة مطلوب' },
        { status: 400 }
      );
    }

    const existing = await db.restaurantTable.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(
        { error: 'الطاولة غير موجودة' },
        { status: 404 }
      );
    }

    // Verify the user has access to this table's branch
    const branchCheck = assertBranchAccess(auth, existing.branchId);
    if (!branchCheck.authenticated) return branchCheck.response;

    const data: any = {};
    if (name !== undefined) data.name = name;
    if (isActive !== undefined) data.isActive = isActive;
    if (sortOrder !== undefined) data.sortOrder = sortOrder;

    const table = await db.restaurantTable.update({
      where: { id },
      data,
    });

    return NextResponse.json(table);
  } catch (error: any) {
    console.error('Error updating table:', error);
    return NextResponse.json(
      { error: 'فشل في تحديث الطاولة' },
      { status: 500 }
    );
  }
}

// DELETE /api/pos/tables - Delete a table by id in body
export async function DELETE(request: NextRequest) {
  try {
    const auth = await requireAuth(); if (!auth.authenticated) return auth.response;
    const writeCheck = checkWriteAccess(auth, 'pos'); if (!writeCheck.authenticated) return writeCheck.response;
    const body = await request.json();
    const { id } = body;

    if (!id) {
      return NextResponse.json(
        { error: 'معرف الطاولة مطلوب' },
        { status: 400 }
      );
    }

    const existing = await db.restaurantTable.findUnique({
      where: { id },
      include: { _count: { select: { invoices: true } } },
    });

    if (!existing) {
      return NextResponse.json(
        { error: 'الطاولة غير موجودة' },
        { status: 404 }
      );
    }

    if (existing._count.invoices > 0) {
      return NextResponse.json(
        { error: 'لا يمكن حذف طاولة مرتبطة بفواتير' },
        { status: 400 }
      );
    }

    // Verify the user has access to this table's branch
    const branchCheck = assertBranchAccess(auth, existing.branchId);
    if (!branchCheck.authenticated) return branchCheck.response;

    await db.restaurantTable.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error deleting table:', error);
    return NextResponse.json(
      { error: 'فشل في حذف الطاولة' },
      { status: 500 }
    );
  }
}
