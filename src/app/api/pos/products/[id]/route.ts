import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { toNumber } from '@/lib/decimal';
import { requireAuth, checkWriteAccess } from '@/lib/api-auth';
import { resolveBranchId } from '@/lib/branch-resolver';
import { auditLog } from '@/lib/audit-log';

// PUT /api/pos/products/[id] - Update a product
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth(); if (!auth.authenticated) return auth.response;
    const writeCheck = checkWriteAccess(auth, 'products-inventory'); if (!writeCheck.authenticated) return writeCheck.response;
    const { id } = await params;
    const body = await request.json();
    const { name, nameEn, sku, costPrice, price, unit, categoryId, isActive, sortOrder, minStock } = body;

    const existing = await db.product.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(
        { error: 'المنتج غير موجود' },
        { status: 404 }
      );
    }

    // If categoryId is changing, verify the new category exists
    if (categoryId && categoryId !== existing.categoryId) {
      const category = await db.productCategory.findUnique({
        where: { id: categoryId },
      });
      if (!category) {
        return NextResponse.json(
          { error: 'التصنيف غير موجود' },
          { status: 404 }
        );
      }
    }

    const updateData: any = {};
    if (name !== undefined) updateData.name = name;
    if (nameEn !== undefined) updateData.nameEn = nameEn;
    if (sku !== undefined) updateData.sku = sku;
    if (costPrice !== undefined) updateData.costPrice = parseFloat(String(costPrice));
    if (price !== undefined) updateData.price = parseFloat(String(price));
    if (unit !== undefined) updateData.unit = unit;
    if (categoryId !== undefined) updateData.categoryId = categoryId;
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
    if (minStock !== undefined) updateData.minStock = parseFloat(String(minStock));

    const product = await db.product.update({
      where: { id },
      data: updateData,
      include: {
        category: true,
      },
    });

    // AUDIT-9-18 — product update (INFO/WARNING depending on price change)
    auditLog({
      action: 'UPDATE',
      entity: 'PRODUCT',
      entityId: id,
      entityNumber: existing.sku || undefined,
      description: `تحديث منتج: ${product.name}${price !== undefined ? ` (سعر جديد: ${price})` : ''}`,
      userId: auth.userId,
      userName: auth.email,
      userRole: auth.role,
      branchId: product.branchId,
      severity: price !== undefined || costPrice !== undefined ? 'WARNING' : 'INFO',
      category: 'INVENTORY',
      details: { updatedFields: Object.keys(updateData), previous: { price: toNumber(existing.price), costPrice: toNumber(existing.costPrice) } },
    }).catch(() => {});

    return NextResponse.json({
      id: product.id,
      name: product.name,
      nameEn: product.nameEn,
      sku: product.sku,
      categoryId: product.categoryId,
      branchId: product.branchId,
      costPrice: toNumber(product.costPrice),
      price: toNumber(product.price),
      unit: product.unit,
      currentStock: toNumber(product.currentStock),
      minStock: toNumber(product.minStock),
      isActive: product.isActive,
      sortOrder: product.sortOrder,
      category: product.category
        ? {
            id: product.category.id,
            name: product.category.name,
            nameEn: product.category.nameEn,
            icon: product.category.icon,
            color: product.category.color,
          }
        : null,
      createdAt: product.createdAt.toISOString(),
      updatedAt: product.updatedAt.toISOString(),
    });
  } catch (error: any) {
    console.error('Error updating product:', error);
    return NextResponse.json(
      { error: 'فشل في تحديث المنتج' },
      { status: 500 }
    );
  }
}

// DELETE /api/pos/products/[id] - Soft delete (set isActive = false)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth(); if (!auth.authenticated) return auth.response;
    const writeCheck = checkWriteAccess(auth, 'products-inventory'); if (!writeCheck.authenticated) return writeCheck.response;
    const { id } = await params;

    const existing = await db.product.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(
        { error: 'المنتج غير موجود' },
        { status: 404 }
      );
    }

    if (!existing.isActive) {
      return NextResponse.json(
        { error: 'المنتج معطل بالفعل' },
        { status: 400 }
      );
    }

    const product = await db.product.update({
      where: { id },
      data: { isActive: false },
      include: {
        category: true,
      },
    });

    // AUDIT-9-18 — product soft-delete (deactivate)
    auditLog({
      action: 'DELETE',
      entity: 'PRODUCT',
      entityId: id,
      entityNumber: existing.sku || undefined,
      description: `تعطيل منتج: ${existing.name}`,
      userId: auth.userId,
      userName: auth.email,
      userRole: auth.role,
      branchId: existing.branchId,
      severity: 'WARNING',
      category: 'INVENTORY',
      details: { productId: id, name: existing.name, sku: existing.sku },
    }).catch(() => {});

    return NextResponse.json({
      id: product.id,
      name: product.name,
      isActive: product.isActive,
      message: 'تم تعطيل المنتج بنجاح',
    });
  } catch (error: any) {
    console.error('Error deleting product:', error);
    return NextResponse.json(
      { error: 'فشل في تعطيل المنتج' },
      { status: 500 }
    );
  }
}
