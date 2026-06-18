import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { toNumber } from '@/lib/decimal';
import { requireAuth, requireRole, checkWriteAccess, assertBranchAccess } from '@/lib/api-auth';
import { resolveBranchIdOrNull } from '@/lib/branch-resolver';
import { auditLog } from '@/lib/audit-log';

// GET /api/inventory/stock-transfer/[id] - Get single stock transfer with items
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth(request);
    if (!auth.authenticated) return auth.response;

    const { id } = await params;

    const transfer = await db.stockTransfer.findUnique({
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
                branchId: true,
              },
            },
          },
        },
      },
    });

    if (!transfer) {
      return NextResponse.json(
        { error: 'تحويل المخزون غير موجود' },
        { status: 404 }
      );
    }

    // Verify the user has access to this transfer's branches
    const fromBranchCheck = assertBranchAccess(auth, transfer.fromBranchId);
    if (!fromBranchCheck.authenticated) return fromBranchCheck.response;
    const toBranchCheck = assertBranchAccess(auth, transfer.toBranchId);
    if (!toBranchCheck.authenticated) return toBranchCheck.response;

    return NextResponse.json({
      id: transfer.id,
      number: transfer.number,
      date: transfer.date.toISOString(),
      fromBranch: transfer.fromBranchId,
      toBranch: transfer.toBranchId,
      status: transfer.status,
      notes: transfer.notes,
      userId: transfer.userId,
      receivedBy: transfer.receivedBy,
      receivedAt: transfer.receivedAt ? transfer.receivedAt.toISOString() : null,
      items: transfer.items.map((item) => ({
        id: item.id,
        productId: item.productId,
        productName: item.product.name,
        productNameEn: item.product.nameEn,
        productSku: item.product.sku,
        productBranch: item.product.branchId,
        quantity: toNumber(item.quantity),
        costPrice: toNumber(item.costPrice),
        totalCost: toNumber(item.totalCost),
        notes: item.notes,
      })),
      totalCost: transfer.items.reduce(
        (sum, item) => sum + toNumber(item.totalCost),
        0
      ),
      createdAt: transfer.createdAt.toISOString(),
      updatedAt: transfer.updatedAt.toISOString(),
    });
  } catch (error: any) {
    console.error('Error fetching stock transfer:', error);
    return NextResponse.json(
      { error: 'فشل في جلب تحويل المخزون' },
      { status: 500 }
    );
  }
}

// PUT /api/inventory/stock-transfer/[id] - Update stock transfer (items, notes, send)
// KNOWN LIMITATION: Inter-branch stock transfers do not create accounting journal entries.
// This is because inter-branch accounting requires per-branch inventory sub-accounts and
// inter-company elimination entries, which adds significant complexity. The stock take
// route (stock-take/[id]/post) correctly handles this for inventory adjustments.
// TODO: Implement inter-branch accounting entries when multi-branch accounting is supported.
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireRole('MANAGER', request);
    if (!auth.authenticated) return auth.response;

    const writeCheck = checkWriteAccess(auth, 'products-inventory'); if (!writeCheck.authenticated) return writeCheck.response;

    const { id } = await params;
    const body = await request.json();
    const { items, notes, status } = body;

    // Fetch existing transfer
    const existing = await db.stockTransfer.findUnique({
      where: { id },
      include: { items: true },
    });

    if (!existing) {
      return NextResponse.json(
        { error: 'تحويل المخزون غير موجود' },
        { status: 404 }
      );
    }

    // Only DRAFT transfers can be updated
    if (existing.status !== 'DRAFT') {
      return NextResponse.json(
        { error: 'لا يمكن تعديل تحويل ليس في حالة مسودة' },
        { status: 400 }
      );
    }

    // Verify the user has access to this transfer's branches
    const fromBranchCheck = assertBranchAccess(auth, existing.fromBranchId);
    if (!fromBranchCheck.authenticated) return fromBranchCheck.response;
    const toBranchCheck = assertBranchAccess(auth, existing.toBranchId);
    if (!toBranchCheck.authenticated) return toBranchCheck.response;

    // ─── Handle status change to IN_TRANSIT (send the transfer) ──
    if (status === 'IN_TRANSIT') {
      // Re-fetch with products to check stock
      const transferWithItems = await db.stockTransfer.findUnique({
        where: { id },
        include: {
          items: { include: { product: true } },
        },
      });

      if (!transferWithItems) {
        return NextResponse.json(
          { error: 'تحويل المخزون غير موجود' },
          { status: 404 }
        );
      }

      // Validate sufficient stock for each item
      for (const item of transferWithItems.items) {
        const currentStock = toNumber(item.product.currentStock);
        if (currentStock < toNumber(item.quantity)) {
          return NextResponse.json(
            {
              error: `الرصيد غير كافي للمنتج "${item.product.name}". الرصيد الحالي: ${currentStock}, الكمية المطلوبة: ${toNumber(item.quantity)}`,
            },
            { status: 400 }
          );
        }
      }

      // Execute send in transaction
      const updated = await db.$transaction(async (tx) => {
        // Create TRANSFER_OUT stock transactions and decrement stock at source
        for (const item of transferWithItems.items) {
          const qty = toNumber(item.quantity);
          const costPrice = toNumber(item.costPrice);

          await tx.stockTransaction.create({
            data: {
              productId: item.productId,
              type: 'TRANSFER_OUT',
              quantity: -qty, // Negative for outgoing
              costPrice,
              totalCost: qty * costPrice,
              reference: transferWithItems.number,
              referenceType: 'STOCK_TRANSFER',
              referenceId: transferWithItems.id,
              notes: `تحويل خارج إلى ${transferWithItems.toBranchId}`,
              branchId: transferWithItems.fromBranchId,
            },
          });

          // Decrement product stock at source branch
          await tx.product.update({
            where: { id: item.productId },
            data: {
              currentStock: { decrement: qty },
            },
          });
        }

        // Update transfer status
        return tx.stockTransfer.update({
          where: { id },
          data: { status: 'IN_TRANSIT' },
          include: {
            items: {
              include: {
                product: {
                  select: { id: true, name: true, nameEn: true, sku: true },
                },
              },
            },
          },
        });
      });

      // AUDIT-9-18 — IN_TRANSIT (sending a transfer) moves stock between branches
      auditLog({
        action: 'FINALIZE',
        entity: 'STOCK_TRANSFER',
        entityId: updated.id,
        entityNumber: updated.number,
        description: `إرسال تحويل مخزون ${updated.number} من ${updated.fromBranchId} إلى ${updated.toBranchId}`,
        userId: auth.userId,
        userName: auth.email,
        userRole: auth.role,
        branchId: updated.fromBranchId,
        severity: 'WARNING',
        category: 'INVENTORY',
        details: { itemCount: updated.items.length, fromBranch: updated.fromBranchId, toBranch: updated.toBranchId },
      }).catch(() => {});

      return NextResponse.json({
        id: updated.id,
        number: updated.number,
        date: updated.date.toISOString(),
        fromBranch: updated.fromBranchId,
        toBranch: updated.toBranchId,
        status: updated.status,
        notes: updated.notes,
        userId: updated.userId,
        items: updated.items.map((item) => ({
          id: item.id,
          productId: item.productId,
          productName: item.product.name,
          productNameEn: item.product.nameEn,
          productSku: item.product.sku,
          quantity: toNumber(item.quantity),
          costPrice: toNumber(item.costPrice),
          totalCost: toNumber(item.totalCost),
          notes: item.notes,
        })),
        message: 'تم إرسال التحويل بنجاح',
      });
    }

    // ─── Handle item/notes updates (still DRAFT) ──────────────
    if (items !== undefined || notes !== undefined) {
      // If items are being updated, validate them
      if (items && Array.isArray(items)) {
        for (const item of items) {
          if (!item.productId) {
            return NextResponse.json(
              { error: 'معرف المنتج مطلوب لكل عنصر' },
              { status: 400 }
            );
          }
          if (!item.quantity || item.quantity <= 0) {
            return NextResponse.json(
              { error: 'الكمية يجب أن تكون أكبر من صفر' },
              { status: 400 }
            );
          }
        }

        // Verify products exist and belong to fromBranch
        const productIds = items.map((i: any) => i.productId);
        const products = await db.product.findMany({
          where: { id: { in: productIds } },
        }) as any[];
        const productMap = new Map(products.map((p) => [p.id, p]));

        for (const item of items) {
          const product = productMap.get(item.productId);
          if (!product) {
            return NextResponse.json(
              { error: `المنتج غير موجود: ${item.productId}` },
              { status: 404 }
            );
          }
          if (product.branchId !== existing.fromBranchId) {
            return NextResponse.json(
              { error: `المنتج "${product.name}" لا ينتمي إلى فرع المصدر` },
              { status: 400 }
            );
          }
          const currentStock = toNumber(product.currentStock);
          if (currentStock < item.quantity) {
            return NextResponse.json(
              {
                error: `الرصيد غير كافي للمنتج "${product.name}". الرصيد الحالي: ${currentStock}, الكمية المطلوبة: ${item.quantity}`,
              },
              { status: 400 }
            );
          }
        }
      }

      const updated = await db.$transaction(async (tx) => {
        // Delete existing items and recreate if items provided
        if (items && Array.isArray(items)) {
          await tx.stockTransferItem.deleteMany({
            where: { transferId: id },
          });

          // Get product cost prices
          const productIds = items.map((i: any) => i.productId);
          const products = await tx.product.findMany({
            where: { id: { in: productIds } },
          }) as any[];
          const productMap = new Map(products.map((p) => [p.id, p]));

          const newItems = items.map((item: any) => {
            const product = productMap.get(item.productId)!;
            const costPrice = toNumber(product.costPrice);
            const quantity = parseFloat(String(item.quantity));
            return {
              transferId: id,
              productId: item.productId,
              quantity,
              costPrice,
              totalCost: quantity * costPrice,
              notes: item.notes || null,
            };
          });

          await tx.stockTransferItem.createMany({ data: newItems });
        }

        // Update notes if provided
        const updateData: any = {};
        if (notes !== undefined) updateData.notes = notes || null;

        if (Object.keys(updateData).length > 0) {
          await tx.stockTransfer.update({
            where: { id },
            data: updateData,
          });
        }

        return tx.stockTransfer.findUnique({
          where: { id },
          include: {
            items: {
              include: {
                product: {
                  select: { id: true, name: true, nameEn: true, sku: true },
                },
              },
            },
          },
        });
      });

      if (!updated) {
        return NextResponse.json(
          { error: 'فشل في تحديث التحويل' },
          { status: 500 }
        );
      }

      return NextResponse.json({
        id: updated.id,
        number: updated.number,
        date: updated.date.toISOString(),
        fromBranch: updated.fromBranchId,
        toBranch: updated.toBranchId,
        status: updated.status,
        notes: updated.notes,
        userId: updated.userId,
        items: updated.items.map((item) => ({
          id: item.id,
          productId: item.productId,
          productName: item.product.name,
          productNameEn: item.product.nameEn,
          productSku: item.product.sku,
          quantity: toNumber(item.quantity),
          costPrice: toNumber(item.costPrice),
          totalCost: toNumber(item.totalCost),
          notes: item.notes,
        })),
      });
    }

    return NextResponse.json(
      { error: 'لم يتم تقديم بيانات للتحديث' },
      { status: 400 }
    );
  } catch (error: any) {
    console.error('Error updating stock transfer:', error);
    return NextResponse.json(
      { error: 'فشل في تحديث تحويل المخزون' },
      { status: 500 }
    );
  }
}

// DELETE /api/inventory/stock-transfer/[id] - Cancel a stock transfer
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireRole('ADMIN', request);
    if (!auth.authenticated) return auth.response;

    const writeCheck = checkWriteAccess(auth, 'products-inventory'); if (!writeCheck.authenticated) return writeCheck.response;

    const { id } = await params;

    const existing = await db.stockTransfer.findUnique({
      where: { id },
    });

    if (!existing) {
      return NextResponse.json(
        { error: 'تحويل المخزون غير موجود' },
        { status: 404 }
      );
    }

    // Only DRAFT transfers can be cancelled
    if (existing.status !== 'DRAFT') {
      return NextResponse.json(
        { error: 'لا يمكن إلغاء تحويل ليس في حالة مسودة' },
        { status: 400 }
      );
    }

    // Verify the user has access to this transfer's branches
    const fromBranchCheck = assertBranchAccess(auth, existing.fromBranchId);
    if (!fromBranchCheck.authenticated) return fromBranchCheck.response;
    const toBranchCheck = assertBranchAccess(auth, existing.toBranchId);
    if (!toBranchCheck.authenticated) return toBranchCheck.response;

    const cancelled = await db.stockTransfer.update({
      where: { id },
      data: { status: 'CANCELLED' },
    });

    // AUDIT-9-18 — cancelling a stock transfer (soft-void)
    auditLog({
      action: 'DELETE',
      entity: 'STOCK_TRANSFER',
      entityId: cancelled.id,
      entityNumber: cancelled.number,
      description: `إلغاء تحويل مخزون ${cancelled.number}`,
      userId: auth.userId,
      userName: auth.email,
      userRole: auth.role,
      branchId: cancelled.fromBranchId,
      severity: 'WARNING',
      category: 'INVENTORY',
    }).catch(() => {});

    return NextResponse.json({
      id: cancelled.id,
      number: cancelled.number,
      status: cancelled.status,
      message: 'تم إلغاء التحويل بنجاح',
    });
  } catch (error: any) {
    console.error('Error cancelling stock transfer:', error);
    return NextResponse.json(
      { error: 'فشل في إلغاء تحويل المخزون' },
      { status: 500 }
    );
  }
}
