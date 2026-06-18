import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { toNumber } from '@/lib/decimal';
import { requireAuth, requireRole, safePageSize, checkWriteAccess, checkReadAccess, assertBranchAccess } from '@/lib/api-auth';
import { resolveBranchId, resolveBranchIdOrNull } from '@/lib/branch-resolver';

// Helper: Auto-generate transfer number STR-0001 format
async function generateTransferNumber(tx: any): Promise<string> {
  const last = await tx.stockTransfer.findFirst({
    orderBy: { createdAt: 'desc' },
    select: { number: true },
  });
  if (!last) return 'STR-0001';
  const num = parseInt(last.number.split('-')[1]) + 1;
  return `STR-${num.toString().padStart(4, '0')}`;
}

// GET /api/inventory/stock-transfer - List stock transfers with filters
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth.authenticated) return auth.response;
    const readCheck = checkReadAccess(auth, 'products-inventory'); if (!readCheck.authenticated) return readCheck.response;

    const { searchParams } = new URL(request.url);
    const fromBranchInput = searchParams.get('fromBranch') || searchParams.get('fromBranchId');
    const toBranchInput = searchParams.get('toBranch') || searchParams.get('toBranchId');
    const branchInput = searchParams.get('branch') || searchParams.get('branchId'); // matches either fromBranchId or toBranchId
    const status = searchParams.get('status');
    const limit = safePageSize(parseInt(searchParams.get('limit') || '50'));
    const offset = parseInt(searchParams.get('offset') || '0');

    const where: any = {};
    const fromBranchId = await resolveBranchIdOrNull(fromBranchInput);
    if (fromBranchId) {
      // Verify branch access for fromBranch filter
      const branchCheck = assertBranchAccess(auth, fromBranchId);
      if (!branchCheck.authenticated) return branchCheck.response;
      where.fromBranchId = fromBranchId;
    }
    const toBranchId = await resolveBranchIdOrNull(toBranchInput);
    if (toBranchId) {
      // Verify branch access for toBranch filter
      const branchCheck = assertBranchAccess(auth, toBranchId);
      if (!branchCheck.authenticated) return branchCheck.response;
      where.toBranchId = toBranchId;
    }
    const anyBranchId = await resolveBranchIdOrNull(branchInput);
    if (anyBranchId) {
      // Verify branch access for generic branch filter
      const branchCheck = assertBranchAccess(auth, anyBranchId);
      if (!branchCheck.authenticated) return branchCheck.response;
      where.OR = [{ fromBranchId: anyBranchId }, { toBranchId: anyBranchId }];
    }
    if (status) where.status = status;

    const [transfers, total] = await Promise.all([
      db.stockTransfer.findMany({
        where,
        include: {
          items: {
            select: { id: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      db.stockTransfer.count({ where }),
    ]);

    return NextResponse.json({
      transfers: transfers.map((t) => ({
        id: t.id,
        number: t.number,
        date: t.date.toISOString(),
        fromBranch: t.fromBranchId,
        toBranch: t.toBranchId,
        status: t.status,
        notes: t.notes,
        userId: t.userId,
        receivedBy: t.receivedBy,
        receivedAt: t.receivedAt ? t.receivedAt.toISOString() : null,
        itemCount: t.items.length,
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
      })),
      total,
    });
  } catch (error: any) {
    console.error('Error fetching stock transfers:', error);
    return NextResponse.json(
      { error: 'فشل في جلب تحويلات المخزون' },
      { status: 500 }
    );
  }
}

// POST /api/inventory/stock-transfer - Create a new stock transfer
export async function POST(request: NextRequest) {
  try {
    const auth = await requireRole('MANAGER', request);
    if (!auth.authenticated) return auth.response;

    const writeCheck = checkWriteAccess(auth, 'products-inventory'); if (!writeCheck.authenticated) return writeCheck.response;

    const body = await request.json();
    const { date, notes, items } = body;

    // ─── Resolve branchIds ────────────────────────
    let fromBranchId: string;
    let toBranchId: string;
    try {
      fromBranchId = await resolveBranchId(body.fromBranch || body.fromBranchId);
      toBranchId = await resolveBranchId(body.toBranch || body.toBranchId);
    } catch (e: any) {
      return NextResponse.json({ error: e.message || 'فرع غير صالح' }, { status: 400 });
    }

    // ─── Validation ────────────────────────────────────────────
    if (!fromBranchId) {
      return NextResponse.json({ error: 'فرع المصدر مطلوب' }, { status: 400 });
    }
    if (!toBranchId) {
      return NextResponse.json({ error: 'فرع الوجهة مطلوب' }, { status: 400 });
    }

    // Verify the user has access to BOTH fromBranchId and toBranchId
    const fromBranchCheck = assertBranchAccess(auth, fromBranchId);
    if (!fromBranchCheck.authenticated) return fromBranchCheck.response;
    const toBranchCheck = assertBranchAccess(auth, toBranchId);
    if (!toBranchCheck.authenticated) return toBranchCheck.response;

    if (fromBranchId === toBranchId) {
      return NextResponse.json(
        { error: 'لا يمكن التحويل بين نفس الفرع' },
        { status: 400 }
      );
    }
    if (!date) {
      return NextResponse.json({ error: 'تاريخ التحويل مطلوب' }, { status: 400 });
    }
    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { error: 'يجب إضافة عنصر واحد على الأقل' },
        { status: 400 }
      );
    }

    // Validate each item
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

    // ─── Verify products exist and belong to fromBranch ────────
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
      if (product.branchId !== fromBranchId) {
        return NextResponse.json(
          { error: `المنتج "${product.name}" لا ينتمي إلى فرع المصدر` },
          { status: 400 }
        );
      }
      // Check sufficient stock
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

    // ─── Create transfer in transaction ────────────────────────
    const transfer = await db.$transaction(async (tx) => {
      const number = await generateTransferNumber(tx);

      // Calculate total cost
      const transferItems = items.map((item: any) => {
        const product = productMap.get(item.productId)!;
        const costPrice = toNumber(product.costPrice);
        const quantity = parseFloat(String(item.quantity));
        return {
          productId: item.productId,
          quantity,
          costPrice,
          totalCost: quantity * costPrice,
          notes: item.notes || null,
        };
      });

      const totalCost = transferItems.reduce((sum: number, i: any) => sum + i.totalCost, 0);

      const newTransfer = await tx.stockTransfer.create({
        data: {
          number,
          date: new Date(date),
          fromBranchId,
          toBranchId,
          status: 'DRAFT',
          notes: notes || null,
          userId: auth.userId,
          items: {
            create: transferItems,
          },
        },
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

      return newTransfer;
    });

    return NextResponse.json(
      {
        id: transfer.id,
        number: transfer.number,
        date: transfer.date.toISOString(),
        fromBranch: transfer.fromBranchId,
        toBranch: transfer.toBranchId,
        status: transfer.status,
        notes: transfer.notes,
        userId: transfer.userId,
        items: transfer.items.map((item) => ({
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
        createdAt: transfer.createdAt.toISOString(),
      },
      { status: 201 }
    );
  } catch (error: any) {
    console.error('Error creating stock transfer:', error);
    return NextResponse.json(
      { error: 'فشل في إنشاء تحويل المخزون' },
      { status: 500 }
    );
  }
}
