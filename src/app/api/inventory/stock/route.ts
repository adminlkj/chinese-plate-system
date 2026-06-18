import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { toNumber, round2 } from '@/lib/decimal';
import { requireAuth, safePageSize, checkWriteAccess, checkReadAccess, assertBranchAccess } from '@/lib/api-auth';
import { createTransaction } from '@/lib/accounting-engine';
import { resolveBranchId, resolveBranchIdOrNull } from '@/lib/branch-resolver';
import type { Branch } from '@/lib/types';
import { auditLog } from '@/lib/audit-log';

// GET /api/inventory/stock - List stock transactions with filters
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(); if (!auth.authenticated) return auth.response;
    const readCheck = checkReadAccess(auth, 'products-inventory'); if (!readCheck.authenticated) return readCheck.response;
    const { searchParams } = new URL(request.url);
    const productId = searchParams.get('productId');
    const branchInput = searchParams.get('branch') || searchParams.get('branchId');
    const type = searchParams.get('type');
    // AUDIT-9-18 (Phase 18): cap page size to prevent DoS via huge limit= param
    const limit = safePageSize(parseInt(searchParams.get('limit') || '50'), 200, 50);
    const offset = parseInt(searchParams.get('offset') || '0') || 0;

    const where: any = {};
    if (productId) where.productId = productId;
    const branchId = await resolveBranchIdOrNull(branchInput);
    if (branchId) {
      // Verify branch access if branch filter is specified
      const branchCheck = assertBranchAccess(auth, branchId);
      if (!branchCheck.authenticated) return branchCheck.response;
      where.branchId = branchId;
    }
    if (type) where.type = type;

    const [transactions, total] = await Promise.all([
      db.stockTransaction.findMany({
        where,
        include: {
          product: {
            include: { category: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      db.stockTransaction.count({ where }),
    ]);

    return NextResponse.json({
      transactions: transactions.map((t) => ({
        id: t.id,
        productId: t.productId,
        productName: t.product.name,
        productNameEn: t.product.nameEn,
        category: t.product.category?.name || '',
        type: t.type,
        quantity: toNumber(t.quantity),
        costPrice: toNumber(t.costPrice),
        totalCost: toNumber(t.totalCost),
        reference: t.reference,
        referenceType: t.referenceType,
        referenceId: t.referenceId,
        notes: t.notes,
        branch: t.branchId,
        createdAt: t.createdAt.toISOString(),
      })),
      total,
    });
  } catch (error: any) {
    console.error('Error fetching stock transactions:', error);
    return NextResponse.json(
      { error: 'فشل في جلب حركات المخزون' },
      { status: 500 }
    );
  }
}

// POST /api/inventory/stock - Create a stock transaction (manual adjustment, opening stock, etc.)
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(); if (!auth.authenticated) return auth.response;
    const writeCheck = checkWriteAccess(auth, 'products-inventory'); if (!writeCheck.authenticated) return writeCheck.response;
    const body = await request.json();
    const { productId, type, quantity, costPrice, reference, referenceType, referenceId, notes } = body;

    if (!productId) {
      return NextResponse.json({ error: 'المنتج مطلوب' }, { status: 400 });
    }
    if (!type) {
      return NextResponse.json({ error: 'نوع الحركة مطلوب' }, { status: 400 });
    }
    if (quantity === undefined || quantity === null) {
      return NextResponse.json({ error: 'الكمية مطلوبة' }, { status: 400 });
    }

    const product = await db.product.findUnique({ where: { id: productId } });
    if (!product) {
      return NextResponse.json({ error: 'المنتج غير موجود' }, { status: 404 });
    }

    // Resolve branchId (UUID) from body.branch (code/name/id) or body.branchId (UUID)
    let branchId: string;
    try {
      branchId = await resolveBranchId(body.branch || body.branchId || product.branchId);
    } catch (e: any) {
      return NextResponse.json({ error: e.message || 'الفرع غير صالح' }, { status: 400 });
    }

    // Verify the user has access to this branch
    const branchCheck = assertBranchAccess(auth, branchId);
    if (!branchCheck.authenticated) return branchCheck.response;

    const effectiveCostPrice = costPrice ?? toNumber(product.costPrice);
    const effectiveQuantity = parseFloat(String(quantity));
    const totalCost = effectiveQuantity * effectiveCostPrice;

    // Determine stock change direction
    let stockDelta = 0;
    switch (type) {
      case 'PURCHASE':
      case 'RETURN':
      case 'OPENING':
        stockDelta = Math.abs(effectiveQuantity);
        break;
      case 'SALE':
      case 'TRANSFER':
        stockDelta = -Math.abs(effectiveQuantity);
        break;
      case 'ADJUSTMENT':
        stockDelta = effectiveQuantity; // Can be positive or negative
        break;
      default:
        stockDelta = effectiveQuantity;
    }

    // Use transaction to ensure consistency
    const result = await db.$transaction(async (tx) => {
      const transaction = await tx.stockTransaction.create({
        data: {
          productId,
          type,
          quantity: effectiveQuantity,
          costPrice: effectiveCostPrice,
          totalCost: Math.abs(totalCost),
          reference: reference || null,
          referenceType: referenceType || null,
          referenceId: referenceId || null,
          notes: notes || null,
          branchId,
        },
      });

      // Update product stock
      const updatedProduct = await tx.product.update({
        where: { id: productId },
        data: {
          currentStock: { increment: stockDelta },
        },
      });

      // ─── Create accounting journal entry for ADJUSTMENT type ───
      // Inventory value changes must be reflected in the general ledger.
      // For SURPLUS (positive): Debit Inventory (1300), Credit Other Revenue (4900)
      // For SHORTAGE (negative): Debit COGS (5950), Credit Inventory (1300)
      if (type === 'ADJUSTMENT' && Math.abs(totalCost) >= 0.005) {
        const inventoryAccount = await tx.account.findFirst({ where: { code: '1300' } });
        const cogsAccount = await tx.account.findFirst({ where: { code: '5950' } });
        // For surplus: look for 4900 (Other Revenue) first, fallback to 4400
        let otherRevenueAccount = await tx.account.findFirst({ where: { code: '4900' } });
        if (!otherRevenueAccount) {
          otherRevenueAccount = await tx.account.findFirst({ where: { code: '4400' } });
        }

        const adjustmentAmount = round2(Math.abs(totalCost));

        if (stockDelta > 0) {
          // SURPLUS: Debit Inventory, Credit Other Revenue
          if (!inventoryAccount) {
            throw new Error('حساب المخزون (1300) غير موجود. يجب تهيئة شجرة الحسابات أولاً.');
          }
          if (!otherRevenueAccount) {
            throw new Error('حساب الإيرادات الأخرى غير موجود. يجب إنشاء حساب 4900 (إيرادات أخرى) أو التأكد من وجود حساب 4400.');
          }
          await createTransaction({
            type: 'MANUAL',
            date: new Date(),
            description: `تسوية مخزون (زيادة) - ${product.name}`,
            amount: adjustmentAmount,
            branch: branchId as Branch,
            status: 'POSTED',
            lines: [
              { accountId: inventoryAccount.id, debit: adjustmentAmount, credit: 0, description: `زيادة مخزون - ${product.name}` },
              { accountId: otherRevenueAccount.id, debit: 0, credit: adjustmentAmount, description: `إيراد فائض مخزون - ${product.name}` },
            ],
            tx,
          });
        } else if (stockDelta < 0) {
          // SHORTAGE: Debit COGS, Credit Inventory
          if (!inventoryAccount) {
            throw new Error('حساب المخزون (1300) غير موجود. يجب تهيئة شجرة الحسابات أولاً.');
          }
          if (!cogsAccount) {
            throw new Error('حساب تكلفة البضاعة المباعة (5950) غير موجود. يجب تهيئة شجرة الحسابات أولاً.');
          }
          await createTransaction({
            type: 'MANUAL',
            date: new Date(),
            description: `تسوية مخزون (نقص) - ${product.name}`,
            amount: adjustmentAmount,
            branch: branchId as Branch,
            status: 'POSTED',
            lines: [
              { accountId: cogsAccount.id, debit: adjustmentAmount, credit: 0, description: `نقص مخزون - ${product.name}` },
              { accountId: inventoryAccount.id, debit: 0, credit: adjustmentAmount, description: `تخفيض مخزون بسبب النقص - ${product.name}` },
            ],
            tx,
          });
        }
      }

      return { transaction, updatedProduct };
    });

    // AUDIT-9-18 — stock adjustment is a WARNING (inventory valuation change)
    auditLog({
      action: 'CREATE',
      entity: 'PRODUCT',
      entityId: result.transaction.id,
      entityNumber: result.transaction.reference || undefined,
      description: `حركة مخزون (${type}) - ${product.name}: ${effectiveQuantity} × ${effectiveCostPrice} = ${totalCost}`,
      userId: auth.userId,
      userName: auth.email,
      userRole: auth.role,
      branchId,
      severity: type === 'ADJUSTMENT' ? 'WARNING' : 'INFO',
      category: 'INVENTORY',
      details: {
        stockTransactionId: result.transaction.id,
        productId,
        productName: product.name,
        type,
        quantity: effectiveQuantity,
        costPrice: effectiveCostPrice,
        totalCost,
        stockDelta,
        newStock: toNumber(result.updatedProduct.currentStock),
        reference: reference || null,
      },
    }).catch(() => {});

    return NextResponse.json({
      id: result.transaction.id,
      productId: result.transaction.productId,
      type: result.transaction.type,
      quantity: toNumber(result.transaction.quantity),
      costPrice: toNumber(result.transaction.costPrice),
      totalCost: toNumber(result.transaction.totalCost),
      reference: result.transaction.reference,
      referenceType: result.transaction.referenceType,
      referenceId: result.transaction.referenceId,
      notes: result.transaction.notes,
      branch: result.transaction.branchId,
      newStock: toNumber(result.updatedProduct.currentStock),
      createdAt: result.transaction.createdAt.toISOString(),
    }, { status: 201 });
  } catch (error: any) {
    console.error('Error creating stock transaction:', error);
    return NextResponse.json(
      { error: 'فشل في إنشاء حركة المخزون' },
      { status: 500 }
    );
  }
}
