import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { toNumber } from '@/lib/decimal';
import { requireRole, checkWriteAccess, assertBranchAccess } from '@/lib/api-auth';
import { resolveBranchIdOrNull } from '@/lib/branch-resolver';
import { auditLog } from '@/lib/audit-log';

// POST /api/inventory/stock-transfer/[id]/receive - Receive a stock transfer at destination
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireRole('MANAGER', request);
    if (!auth.authenticated) return auth.response;

    const writeCheck = checkWriteAccess(auth, 'products-inventory'); if (!writeCheck.authenticated) return writeCheck.response;

    const { id } = await params;

    // Fetch transfer with items
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
                costPrice: true,
                price: true,
                unit: true,
                categoryId: true,
                isActive: true,
                sortOrder: true,
                minStock: true,
                maxStock: true,
                reorderQuantity: true,
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

    // Only IN_TRANSIT transfers can be received
    if (transfer.status !== 'IN_TRANSIT') {
      return NextResponse.json(
        { error: 'لا يمكن استلام تحويل ليس في حالة قيد الترحيل' },
        { status: 400 }
      );
    }

    // Verify the user has access to both branches involved in the transfer
    const fromBranchCheck = assertBranchAccess(auth, transfer.fromBranchId);
    if (!fromBranchCheck.authenticated) return fromBranchCheck.response;
    const toBranchCheck = assertBranchAccess(auth, transfer.toBranchId);
    if (!toBranchCheck.authenticated) return toBranchCheck.response;

    // Execute receive in transaction
    const result = await db.$transaction(async (tx) => {
      const skippedItems: string[] = [];
      const receivedItems: any[] = [];

      for (const item of transfer.items) {
        const qty = toNumber(item.quantity);
        const costPrice = toNumber(item.costPrice);
        const sourceProduct = item.product;

        // Find matching product at destination branch (same SKU or same name)
        let destProduct: Awaited<ReturnType<typeof tx.product.findFirst>> = null;

        if (sourceProduct.sku) {
          destProduct = await tx.product.findFirst({
            where: {
              sku: sourceProduct.sku,
              branchId: transfer.toBranchId,
            },
          });
        }

        if (!destProduct) {
          // Try matching by name
          destProduct = await tx.product.findFirst({
            where: {
              name: sourceProduct.name,
              branchId: transfer.toBranchId,
            },
          });
        }

        if (!destProduct) {
          // Create a new product at destination branch with same details
          destProduct = await tx.product.create({
            data: {
              name: sourceProduct.name,
              nameEn: sourceProduct.nameEn,
              sku: sourceProduct.sku
                ? `${sourceProduct.sku}-${transfer.toBranchId}`
                : null,
              categoryId: sourceProduct.categoryId,
              branchId: transfer.toBranchId,
              costPrice: sourceProduct.costPrice,
              price: sourceProduct.price,
              unit: sourceProduct.unit,
              currentStock: 0,
              minStock: sourceProduct.minStock,
              maxStock: sourceProduct.maxStock,
              reorderQuantity: sourceProduct.reorderQuantity,
              isActive: sourceProduct.isActive,
              sortOrder: sourceProduct.sortOrder,
            },
          });
        }

        // Create TRANSFER_IN stock transaction at destination
        if (!destProduct) continue;
        await tx.stockTransaction.create({
          data: {
            productId: destProduct.id,
            type: 'TRANSFER_IN',
            quantity: qty, // Positive for incoming
            costPrice,
            totalCost: qty * costPrice,
            reference: transfer.number,
            referenceType: 'STOCK_TRANSFER',
            referenceId: transfer.id,
            notes: `تحويل وارد من ${transfer.fromBranchId}`,
            branchId: transfer.toBranchId,
          },
        });

        // Increment product stock at destination branch
        const updatedProduct = await tx.product.update({
          where: { id: destProduct.id },
          data: {
            currentStock: { increment: qty },
          },
        });

        receivedItems.push({
          productId: destProduct.id,
          productName: destProduct.name,
          productNameEn: destProduct.nameEn,
          productSku: destProduct.sku,
          quantity: qty,
          costPrice,
          totalCost: qty * costPrice,
          newStock: toNumber(updatedProduct.currentStock),
          isNewProduct: toNumber(updatedProduct.currentStock) === qty, // was just created with 0 stock
        });
      }

      // Update transfer status
      const updatedTransfer = await tx.stockTransfer.update({
        where: { id },
        data: {
          status: 'RECEIVED',
          receivedAt: new Date(),
          receivedBy: auth.userId,
        },
      });

      return {
        transfer: updatedTransfer,
        receivedItems,
        skippedItems,
      };
    });

    // AUDIT-9-18 — stock-transfer receipt (WARNING — inventory movement between branches)
    auditLog({
      action: 'FINALIZE',
      entity: 'STOCK_TRANSFER',
      entityId: result.transfer.id,
      entityNumber: result.transfer.number,
      description: `استلام تحويل مخزون ${result.transfer.number} (${result.receivedItems.length} أصناف مستلمة، ${result.skippedItems.length} متخطاة)`,
      userId: auth.userId,
      userName: auth.email,
      userRole: auth.role,
      branchId: result.transfer.toBranchId,
      severity: 'WARNING',
      category: 'INVENTORY',
      details: {
        receivedCount: result.receivedItems.length,
        skippedCount: result.skippedItems.length,
        fromBranchId: result.transfer.fromBranchId,
        toBranchId: result.transfer.toBranchId,
      },
    }).catch(() => {});

    return NextResponse.json({
      id: result.transfer.id,
      number: result.transfer.number,
      date: result.transfer.date.toISOString(),
      fromBranch: result.transfer.fromBranchId,
      toBranch: result.transfer.toBranchId,
      status: result.transfer.status,
      receivedBy: result.transfer.receivedBy,
      receivedAt: result.transfer.receivedAt
        ? result.transfer.receivedAt.toISOString()
        : null,
      receivedItems: result.receivedItems,
      skippedItems: result.skippedItems,
      message: 'تم استلام التحويل بنجاح',
    });
  } catch (error: any) {
    console.error('Error receiving stock transfer:', error);
    return NextResponse.json(
      { error: 'فشل في استلام تحويل المخزون' },
      { status: 500 }
    );
  }
}
