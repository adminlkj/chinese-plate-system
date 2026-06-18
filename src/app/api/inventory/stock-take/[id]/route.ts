import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { toNumber, round2 } from '@/lib/decimal';
import { requireAuth, requireRole, checkWriteAccess, assertBranchAccess } from '@/lib/api-auth';
import { resolveBranchIdOrNull } from '@/lib/branch-resolver';

// GET /api/inventory/stock-take/[id] — Get single stock take with all items
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth();
    if (!auth.authenticated) return auth.response;

    const { id } = await params;

    const stockTake = await db.stockTake.findUnique({
      where: { id },
      include: {
        items: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                nameEn: true,
                sku: true,
                unit: true,
              },
            },
          },
          orderBy: { product: { name: 'asc' } },
        },
      },
    });

    if (!stockTake) {
      return NextResponse.json(
        { error: 'جرد المخزون غير موجود' },
        { status: 404 }
      );
    }

    // Verify the user has access to this stock take's branch
    const branchCheck = assertBranchAccess(auth, stockTake.branchId);
    if (!branchCheck.authenticated) return branchCheck.response;

    // Fetch user info
    let createdBy: { name: string; nameEn: string | null } | null = null;
    let postedByUser: { name: string; nameEn: string | null } | null = null;
    if (stockTake.userId) {
      const user = await db.user.findUnique({
        where: { id: stockTake.userId },
        select: { id: true, name: true, nameEn: true },
      });
      createdBy = user ? { name: user.name, nameEn: user.nameEn } : null;
    }
    if (stockTake.postedBy) {
      const user = await db.user.findUnique({
        where: { id: stockTake.postedBy },
        select: { id: true, name: true, nameEn: true },
      });
      postedByUser = user ? { name: user.name, nameEn: user.nameEn } : null;
    }

    // Calculate summary totals
    const totalSurplus = stockTake.items.reduce(
      (sum, item) => sum + (toNumber(item.difference) > 0 ? toNumber(item.difference) : 0),
      0
    );
    const totalShortage = stockTake.items.reduce(
      (sum, item) => sum + (toNumber(item.difference) < 0 ? Math.abs(toNumber(item.difference)) : 0),
      0
    );
    const totalValue = stockTake.items.reduce(
      (sum, item) => sum + toNumber(item.totalValue),
      0
    );
    const countedItems = stockTake.items.filter((item) => item.countedQty !== null).length;

    return NextResponse.json({
      id: stockTake.id,
      number: stockTake.number,
      date: stockTake.date.toISOString(),
      branch: stockTake.branchId,
      status: stockTake.status,
      notes: stockTake.notes,
      userId: stockTake.userId,
      createdBy,
      postedAt: stockTake.postedAt ? stockTake.postedAt.toISOString() : null,
      postedBy: stockTake.postedBy,
      postedByUser,
      items: stockTake.items.map((item) => ({
        id: item.id,
        productId: item.productId,
        productName: item.product.name,
        productNameEn: item.product.nameEn,
        productSku: item.product.sku,
        productUnit: item.product.unit,
        systemQty: toNumber(item.systemQty),
        countedQty: item.countedQty !== null ? toNumber(item.countedQty) : null,
        difference: toNumber(item.difference),
        costPrice: toNumber(item.costPrice),
        totalValue: toNumber(item.totalValue),
        notes: item.notes,
      })),
      summary: {
        totalItems: stockTake.items.length,
        countedItems,
        uncountedItems: stockTake.items.length - countedItems,
        totalSurplus: round2(totalSurplus),
        totalShortage: round2(totalShortage),
        totalValue: round2(totalValue),
      },
      createdAt: stockTake.createdAt.toISOString(),
      updatedAt: stockTake.updatedAt.toISOString(),
    });
  } catch (error: any) {
    console.error('Error fetching stock take:', error);
    return NextResponse.json(
      { error: 'فشل في جلب جرد المخزون' },
      { status: 500 }
    );
  }
}

// PUT /api/inventory/stock-take/[id] — Update stock take items and status
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireRole('MANAGER');
    if (!auth.authenticated) return auth.response;

    const writeCheck = checkWriteAccess(auth, 'products-inventory'); if (!writeCheck.authenticated) return writeCheck.response;

    const { id } = await params;
    const body = await request.json();
    const { items, status, notes } = body;

    // Validate stock take exists and is editable
    const existing = await db.stockTake.findUnique({
      where: { id },
      include: { items: true },
    });

    if (!existing) {
      return NextResponse.json(
        { error: 'جرد المخزون غير موجود' },
        { status: 404 }
      );
    }

    if (!['DRAFT', 'IN_PROGRESS'].includes(existing.status)) {
      return NextResponse.json(
        { error: 'لا يمكن تعديل جرد المخزون في الحالة الحالية' },
        { status: 400 }
      );
    }

    // Verify the user has access to this stock take's branch
    const existingBranchCheck = assertBranchAccess(auth, existing.branchId);
    if (!existingBranchCheck.authenticated) return existingBranchCheck.response;

    // Validate status transition if provided
    if (status) {
      const validTransitions: Record<string, string[]> = {
        DRAFT: ['IN_PROGRESS', 'COMPLETED'],
        IN_PROGRESS: ['COMPLETED', 'DRAFT'],
      };
      const allowed = validTransitions[existing.status] || [];
      if (!allowed.includes(status)) {
        return NextResponse.json(
          { error: `لا يمكن تغيير الحالة من "${existing.status}" إلى "${status}"` },
          { status: 400 }
        );
      }

      // If transitioning to COMPLETED, verify all items are counted
      if (status === 'COMPLETED') {
        const itemsToUpdate = items || existing.items;
        const uncounted = itemsToUpdate.filter(
          (item: any) => item.countedQty === null || item.countedQty === undefined
        );
        if (uncounted.length > 0) {
          return NextResponse.json(
            { error: 'يجب عد جميع المنتجات قبل إكمال الجرد' },
            { status: 400 }
          );
        }
      }
    }

    const result = await db.$transaction(async (tx) => {
      // Update items if provided
      if (items && Array.isArray(items)) {
        for (const itemUpdate of items) {
          const { id: itemId, countedQty, notes: itemNotes } = itemUpdate;

          // Find the existing item
          const existingItem = existing.items.find((i) => i.id === itemId);
          if (!existingItem) {
            throw new Error(`بند الجرد رقم "${itemId}" غير موجود`);
          }

          // Calculate difference and totalValue
          const systemQty = toNumber(existingItem.systemQty);
          const effectiveCountedQty = countedQty !== undefined && countedQty !== null
            ? parseFloat(String(countedQty))
            : null;
          const difference = effectiveCountedQty !== null
            ? round2(effectiveCountedQty - systemQty)
            : 0;
          const costPrice = toNumber(existingItem.costPrice);
          const totalValue = round2(difference * costPrice);

          await tx.stockTakeItem.update({
            where: { id: itemId },
            data: {
              countedQty: effectiveCountedQty,
              difference,
              totalValue,
              ...(itemNotes !== undefined ? { notes: itemNotes || null } : {}),
            },
          });
        }
      }

      // Determine new status
      let newStatus = existing.status;
      if (status) {
        newStatus = status;
      } else if (items && Array.isArray(items)) {
        // Auto-transition to IN_PROGRESS if still DRAFT and items are being counted
        if (existing.status === 'DRAFT') {
          const hasAnyCounted = items.some(
            (item: any) => item.countedQty !== null && item.countedQty !== undefined
          );
          if (hasAnyCounted) {
            newStatus = 'IN_PROGRESS';
          }
        }
      }

      // Update the stock take header
      const updated = await tx.stockTake.update({
        where: { id },
        data: {
          status: newStatus,
          ...(notes !== undefined ? { notes: notes || null } : {}),
        },
        include: {
          items: {
            include: {
              product: {
                select: { id: true, name: true, nameEn: true, sku: true, unit: true },
              },
            },
            orderBy: { product: { name: 'asc' } },
          },
        },
      });

      return updated;
    });

    return NextResponse.json({
      id: result.id,
      number: result.number,
      date: result.date.toISOString(),
      branch: result.branchId,
      status: result.status,
      notes: result.notes,
      userId: result.userId,
      items: result.items.map((item) => ({
        id: item.id,
        productId: item.productId,
        productName: item.product.name,
        productNameEn: item.product.nameEn,
        productSku: item.product.sku,
        productUnit: item.product.unit,
        systemQty: toNumber(item.systemQty),
        countedQty: item.countedQty !== null ? toNumber(item.countedQty) : null,
        difference: toNumber(item.difference),
        costPrice: toNumber(item.costPrice),
        totalValue: toNumber(item.totalValue),
        notes: item.notes,
      })),
      createdAt: result.createdAt.toISOString(),
      updatedAt: result.updatedAt.toISOString(),
    });
  } catch (error: any) {
    console.error('Error updating stock take:', error);
    return NextResponse.json(
      { error: 'فشل في تحديث جرد المخزون' },
      { status: 500 }
    );
  }
}

// DELETE /api/inventory/stock-take/[id] — Cancel a stock take
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireRole('ADMIN');
    if (!auth.authenticated) return auth.response;

    const writeCheck = checkWriteAccess(auth, 'products-inventory'); if (!writeCheck.authenticated) return writeCheck.response;

    const { id } = await params;

    const existing = await db.stockTake.findUnique({
      where: { id },
    });

    if (!existing) {
      return NextResponse.json(
        { error: 'جرد المخزون غير موجود' },
        { status: 404 }
      );
    }

    if (!['DRAFT', 'IN_PROGRESS'].includes(existing.status)) {
      return NextResponse.json(
        { error: 'لا يمكن إلغاء جرد المخزون في الحالة الحالية - فقط المسودة أو قيد التنفيذ' },
        { status: 400 }
      );
    }

    const result = await db.stockTake.update({
      where: { id },
      data: { status: 'CANCELLED' },
    });

    return NextResponse.json({
      id: result.id,
      number: result.number,
      status: result.status,
      message: 'تم إلغاء جرد المخزون بنجاح',
    });
  } catch (error: any) {
    console.error('Error cancelling stock take:', error);
    return NextResponse.json(
      { error: 'فشل في إلغاء جرد المخزون' },
      { status: 500 }
    );
  }
}
