import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { toNumber } from '@/lib/decimal';
import { requireAuth, checkWriteAccess } from '@/lib/api-auth';
import { resolveBranchId } from '@/lib/branch-resolver';

// PUT /api/pos/categories/[id] - Update a category
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth(); if (!auth.authenticated) return auth.response;
    const writeCheck = checkWriteAccess(auth, 'products-inventory'); if (!writeCheck.authenticated) return writeCheck.response;
    const { id } = await params;
    const body = await request.json();
    const { name, nameEn, icon, color, isActive, sortOrder } = body;

    const existing = await db.productCategory.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(
        { error: 'التصنيف غير موجود' },
        { status: 404 }
      );
    }

    const updateData: any = {};
    if (name !== undefined) updateData.name = name;
    if (nameEn !== undefined) updateData.nameEn = nameEn;
    if (icon !== undefined) updateData.icon = icon;
    if (color !== undefined) updateData.color = color;
    if (body.branch !== undefined || body.branchId !== undefined) {
      const branchId = await resolveBranchId(body.branch || body.branchId);
      if (!branchId) {
        return NextResponse.json(
          { error: 'branchId غير صالح' },
          { status: 400 }
        );
      }
      updateData.branchId = branchId;
    }
    if (isActive !== undefined) updateData.isActive = isActive;
    if (sortOrder !== undefined) updateData.sortOrder = sortOrder;

    const category = await db.productCategory.update({
      where: { id },
      data: updateData,
      include: {
        products: {
          where: { isActive: true },
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        },
      },
    });

    return NextResponse.json({
      id: category.id,
      name: category.name,
      nameEn: category.nameEn,
      branchId: category.branchId,
      icon: category.icon,
      color: category.color,
      isActive: category.isActive,
      sortOrder: category.sortOrder,
      productsCount: category.products.length,
      products: category.products.map((p) => ({
        id: p.id,
        name: p.name,
        nameEn: p.nameEn,
        price: toNumber(p.price),
        branchId: p.branchId,
        isActive: p.isActive,
        sortOrder: p.sortOrder,
      })),
      createdAt: category.createdAt.toISOString(),
      updatedAt: category.updatedAt.toISOString(),
    });
  } catch (error: any) {
    console.error('Error updating category:', error);
    // Handle unique constraint violations with 409 Conflict
    if (error.code === 'P2002') {
      const fields = error.meta?.target?.join(', ') || 'الحقول الفريدة';
      return NextResponse.json(
        { error: `قيمة مكررة في ${fields}` },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: 'فشل في تحديث التصنيف' },
      { status: 500 }
    );
  }
}

// DELETE /api/pos/categories/[id] - Delete category (only if no active products reference it)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth(); if (!auth.authenticated) return auth.response;
    const writeCheck = checkWriteAccess(auth, 'products-inventory'); if (!writeCheck.authenticated) return writeCheck.response;
    const { id } = await params;

    const existing = await db.productCategory.findUnique({
      where: { id },
      include: {
        products: { where: { isActive: true } },
      },
    });

    if (!existing) {
      return NextResponse.json(
        { error: 'التصنيف غير موجود' },
        { status: 404 }
      );
    }

    // Check if there are active products referencing this category
    if (existing.products.length > 0) {
      return NextResponse.json(
        {
          error: `لا يمكن حذف التصنيف لأنه يحتوي على ${existing.products.length} منتج نشط`,
          productsCount: existing.products.length,
        },
        { status: 400 }
      );
    }

    // Safe to delete (soft delete by setting isActive = false, or hard delete if no products at all)
    await db.productCategory.update({
      where: { id },
      data: { isActive: false },
    });

    return NextResponse.json({
      id: existing.id,
      name: existing.name,
      message: 'تم تعطيل التصنيف بنجاح',
    });
  } catch (error: any) {
    console.error('Error deleting category:', error);
    return NextResponse.json(
      { error: 'فشل في حذف التصنيف' },
      { status: 500 }
    );
  }
}
