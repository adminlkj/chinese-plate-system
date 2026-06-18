import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { toNumber, round2 } from '@/lib/decimal';
import { requireAuth, checkReadAccess, assertBranchAccess } from '@/lib/api-auth';
import { resolveBranchIdOrNull } from '@/lib/branch-resolver';

// GET /api/reports/product-performance
// Product performance report: revenue, quantity, profit, margin per product
// Query params: dateFrom, dateTo, branch, categoryId, sortBy (revenue|quantity|profit|margin), limit
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth();
    if (!auth.authenticated) return auth.response;
    const readCheck = checkReadAccess(auth, 'products-inventory'); if (!readCheck.authenticated) return readCheck.response;

    const { searchParams } = new URL(request.url);
    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');
    const branchInput = searchParams.get('branch') || searchParams.get('branchId');
    const categoryId = searchParams.get('categoryId');
    const sortBy = searchParams.get('sortBy') || 'revenue'; // revenue | quantity | profit | margin
    const limit = Math.max(1, Math.min(parseInt(searchParams.get('limit') || '100', 10), 500));

    // Resolve branchId (UUID) or null if 'all'/not specified
    const branchId = (branchInput && branchInput !== 'all')
      ? await resolveBranchIdOrNull(branchInput)
      : null;

    // Verify branch access if branch filter is specified
    if (branchId) {
      const branchCheck = assertBranchAccess(auth, branchId);
      if (!branchCheck.authenticated) return branchCheck.response;
    }

    // Build invoice where clause — only FINALIZED, not returns
    const invoiceWhere: any = {
      status: 'FINALIZED',
      isReturn: false,
    };

    if (branchId) {
      invoiceWhere.branchId = branchId;
    }

    if (dateFrom || dateTo) {
      invoiceWhere.createdAt = {};
      if (dateFrom) {
        const from = new Date(dateFrom);
        from.setHours(0, 0, 0, 0);
        invoiceWhere.createdAt.gte = from;
      }
      if (dateTo) {
        const to = new Date(dateTo);
        to.setHours(23, 59, 59, 999);
        invoiceWhere.createdAt.lte = to;
      }
    }

    // Fetch finalized (non-return) invoices with items and product info
    const invoices = await db.pOSInvoice.findMany({
      where: invoiceWhere,
      include: {
        items: {
          include: {
            product: {
              include: {
                category: { select: { id: true, name: true, nameEn: true } },
              },
            },
          },
        },
      },
    });

    // Aggregate per product
    const productMap = new Map<string, {
      productId: string;
      name: string;
      nameEn: string | null;
      sku: string | null;
      category: string;
      categoryId: string;
      quantitySold: number;
      totalRevenue: number;
      totalCost: number;
      branch: string;
    }>();

    for (const invoice of invoices) {
      for (const item of invoice.items) {
        const productId = item.productId || `no-product-${item.id}`;
        const product = item.product;

        // Category filter
        if (categoryId && product?.categoryId !== categoryId) continue;

        const quantity = toNumber(item.quantity);
        const revenue = toNumber(item.totalPrice);
        const costPrice = product ? toNumber(product.costPrice) : 0;
        const cost = round2(quantity * costPrice);

        if (productMap.has(productId)) {
          const existing = productMap.get(productId)!;
          existing.quantitySold += quantity;
          existing.totalRevenue += revenue;
          existing.totalCost += cost;
        } else {
          productMap.set(productId, {
            productId,
            name: product?.name || item.name,
            nameEn: product?.nameEn || item.nameEn || null,
            sku: product?.sku || null,
            category: product?.category?.name || 'غير مصنف',
            categoryId: product?.category?.id || '',
            quantitySold: quantity,
            totalRevenue: revenue,
            totalCost: cost,
            branch: invoice.branchId,
          });
        }
      }
    }

    // Build result array with profit and margin calculations
    let products = Array.from(productMap.values()).map((p) => {
      const grossProfit = round2(p.totalRevenue - p.totalCost);
      const profitMargin = p.totalRevenue > 0 ? round2((grossProfit / p.totalRevenue) * 100) : 0;
      return {
        ...p,
        totalRevenue: round2(p.totalRevenue),
        totalCost: round2(p.totalCost),
        grossProfit,
        profitMargin,
      };
    });

    // Sort based on sortBy param
    const sortFn: Record<string, (a: typeof products[0], b: typeof products[0]) => number> = {
      revenue: (a, b) => b.totalRevenue - a.totalRevenue,
      quantity: (a, b) => b.quantitySold - a.quantitySold,
      profit: (a, b) => b.grossProfit - a.grossProfit,
      margin: (a, b) => b.profitMargin - a.profitMargin,
    };

    products.sort(sortFn[sortBy] || sortFn.revenue);

    // Apply limit
    const limited = products.slice(0, limit);

    // Top 5 and Bottom 5
    const top5 = products.slice(0, 5);
    const bottom5 = products.length > 5 ? products.slice(-5).reverse() : [];

    // Summary
    const totalRevenue = round2(products.reduce((s, p) => s + p.totalRevenue, 0));
    const totalCost = round2(products.reduce((s, p) => s + p.totalCost, 0));
    const totalProfit = round2(totalRevenue - totalCost);
    const totalQuantity = round2(products.reduce((s, p) => s + p.quantitySold, 0));

    return NextResponse.json({
      dateFrom: dateFrom || null,
      dateTo: dateTo || null,
      branch: branchId || branchInput || 'all',
      categoryId: categoryId || null,
      sortBy,
      summary: {
        totalProducts: products.length,
        totalRevenue,
        totalCost,
        totalProfit,
        totalQuantity,
        averageMargin: totalRevenue > 0 ? round2((totalProfit / totalRevenue) * 100) : 0,
      },
      products: limited,
      top5,
      bottom5,
    });
  } catch (error: any) {
    console.error('[product-performance] Error:', error);
    return NextResponse.json(
      { error: 'فشل في إنشاء تقرير أداء المنتجات' },
      { status: 500 }
    );
  }
}
