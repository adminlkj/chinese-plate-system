import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { toNumber } from '@/lib/decimal';
import { requireAuth, requireRole, safePageSize, checkWriteAccess, checkReadAccess, assertBranchAccess } from '@/lib/api-auth';
import { resolveBranchId, resolveBranchIdOrNull } from '@/lib/branch-resolver';

// ─── Auto-number generator ────────────────────────────────────────────
async function generateStockTakeNumber(tx: any): Promise<string> {
  const last = await tx.stockTake.findFirst({
    orderBy: { createdAt: 'desc' },
    select: { number: true },
  });
  if (!last) return 'ST-0001';
  const num = parseInt(last.number.split('-')[1]) + 1;
  return `ST-${num.toString().padStart(4, '0')}`;
}

// GET /api/inventory/stock-take — List stock takes with filters
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth();
    if (!auth.authenticated) return auth.response;
    const readCheck = checkReadAccess(auth, 'products-inventory'); if (!readCheck.authenticated) return readCheck.response;

    const { searchParams } = new URL(request.url);
    const branchInput = searchParams.get('branch') || searchParams.get('branchId');
    const status = searchParams.get('status');
    const limit = safePageSize(parseInt(searchParams.get('limit') || '50'));
    const offset = parseInt(searchParams.get('offset') || '0');

    const where: any = {};
    const branchId = await resolveBranchIdOrNull(branchInput);
    if (branchId) {
      // Verify branch access if branch filter is specified
      const branchCheck = assertBranchAccess(auth, branchId);
      if (!branchCheck.authenticated) return branchCheck.response;
      where.branchId = branchId;
    }
    if (status) where.status = status;

    const [stockTakes, total] = await Promise.all([
      db.stockTake.findMany({
        where,
        include: {
          _count: { select: { items: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      db.stockTake.count({ where }),
    ]);

    // Fetch user info for each stock take that has a userId
    const userIds = stockTakes
      .map((st) => st.userId)
      .filter(Boolean) as string[];
    const users = userIds.length
      ? await db.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, nameEn: true },
        }) as any[]
      : [];
    const userMap = new Map(users.map((u) => [u.id, u]));

    return NextResponse.json({
      stockTakes: stockTakes.map((st) => ({
        id: st.id,
        number: st.number,
        date: st.date.toISOString(),
        branch: st.branchId,
        status: st.status,
        notes: st.notes,
        userId: st.userId,
        userName: st.userId ? userMap.get(st.userId)?.name || null : null,
        postedAt: st.postedAt ? st.postedAt.toISOString() : null,
        postedBy: st.postedBy,
        itemCount: st._count.items,
        createdAt: st.createdAt.toISOString(),
        updatedAt: st.updatedAt.toISOString(),
      })),
      total,
    });
  } catch (error: any) {
    console.error('Error fetching stock takes:', error);
    return NextResponse.json(
      { error: 'فشل في جلب جرد المخزون' },
      { status: 500 }
    );
  }
}

// POST /api/inventory/stock-take — Create a new stock take
export async function POST(request: NextRequest) {
  try {
    const auth = await requireRole('MANAGER');
    if (!auth.authenticated) return auth.response;

    const writeCheck = checkWriteAccess(auth, 'products-inventory'); if (!writeCheck.authenticated) return writeCheck.response;

    const body = await request.json();
    const { date, notes, productIds } = body;

    // Resolve branchId (UUID) from body.branch (code/name/id) or body.branchId (UUID)
    let branchId: string;
    try {
      branchId = await resolveBranchId(body.branch || body.branchId);
    } catch (e: any) {
      return NextResponse.json(
        { error: e.message || 'الفرع مطلوب' },
        { status: 400 }
      );
    }

    // Verify the user has access to this branch
    const branchCheck = assertBranchAccess(auth, branchId);
    if (!branchCheck.authenticated) return branchCheck.response;

    if (!date) {
      return NextResponse.json(
        { error: 'التاريخ مطلوب' },
        { status: 400 }
      );
    }

    // Validate branch exists
    const branchRecord = await db.branch.findUnique({
      where: { id: branchId },
    });
    if (!branchRecord || !branchRecord.isActive) {
      return NextResponse.json(
        { error: 'الفرع غير صالح أو غير موجود' },
        { status: 400 }
      );
    }

    const result = await db.$transaction(async (tx) => {
      const number = await generateStockTakeNumber(tx);

      // Determine which products to include
      const productWhere: any = { isActive: true, branchId };
      if (productIds && Array.isArray(productIds) && productIds.length > 0) {
        productWhere.id = { in: productIds };
      }

      const products = await tx.product.findMany({
        where: productWhere,
        select: {
          id: true,
          currentStock: true,
          costPrice: true,
          name: true,
        },
      });

      if (products.length === 0) {
        throw new Error('لا توجد منتجات نشطة لهذا الفرع');
      }

      // Validate that all requested productIds exist and belong to the branch
      if (productIds && Array.isArray(productIds) && productIds.length > 0) {
        const foundIds = new Set(products.map((p) => p.id));
        const missingIds = productIds.filter((id: string) => !foundIds.has(id));
        if (missingIds.length > 0) {
          throw new Error(
            `بعض المنتجات غير موجودة أو لا تنتمي لهذا الفرع: ${missingIds.join(', ')}`
          );
        }
      }

      // Create stock take with items
      const stockTake = await tx.stockTake.create({
        data: {
          number,
          date: new Date(date),
          branchId,
          status: 'DRAFT',
          notes: notes || null,
          userId: auth.userId,
          items: {
            create: products.map((product) => ({
              productId: product.id,
              systemQty: product.currentStock,
              countedQty: null, // Not yet counted
              difference: 0,
              costPrice: product.costPrice,
              totalValue: 0,
            })),
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

      return stockTake;
    });

    return NextResponse.json(
      {
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
          systemQty: toNumber(item.systemQty),
          countedQty: item.countedQty !== null ? toNumber(item.countedQty) : null,
          difference: toNumber(item.difference),
          costPrice: toNumber(item.costPrice),
          totalValue: toNumber(item.totalValue),
          notes: item.notes,
        })),
        createdAt: result.createdAt.toISOString(),
        updatedAt: result.updatedAt.toISOString(),
      },
      { status: 201 }
    );
  } catch (error: any) {
    console.error('Error creating stock take:', error);
    return NextResponse.json(
      { error: 'فشل في إنشاء جرد المخزون' },
      { status: 500 }
    );
  }
}
