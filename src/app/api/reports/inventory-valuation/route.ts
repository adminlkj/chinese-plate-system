import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { toNumber, round2 } from '@/lib/decimal';
import { requireAuth, checkReadAccess, assertBranchAccess } from '@/lib/api-auth';
import { resolveBranchIdOrNull } from '@/lib/branch-resolver';

// GET /api/reports/inventory-valuation
// Inventory valuation report: current stock, cost, value per product
// Query params: branch, categoryId
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth();
    if (!auth.authenticated) return auth.response;
    const readCheck = checkReadAccess(auth, 'products-inventory'); if (!readCheck.authenticated) return readCheck.response;

    const { searchParams } = new URL(request.url);
    const branchInput = searchParams.get('branch') || searchParams.get('branchId');
    const categoryId = searchParams.get('categoryId');

    // Resolve branchId (UUID) or null if 'all'/not specified
    const branchId = (branchInput && branchInput !== 'all')
      ? await resolveBranchIdOrNull(branchInput)
      : null;

    // Verify branch access if branch filter is specified
    if (branchId) {
      const branchCheck = assertBranchAccess(auth, branchId);
      if (!branchCheck.authenticated) return branchCheck.response;
    }

    // Build product where clause
    const productWhere: any = {
      isActive: true,
    };

    if (branchId) {
      productWhere.branchId = branchId;
    }

    if (categoryId) {
      productWhere.categoryId = categoryId;
    }

    // Fetch products with category info
    const products = await db.product.findMany({
      where: productWhere,
      include: {
        category: { select: { id: true, name: true, nameEn: true } },
      },
      orderBy: { name: 'asc' },
    });

    // Build valuation data
    const valuationData = products.map((p) => {
      const currentStock = toNumber(p.currentStock);
      const costPrice = toNumber(p.costPrice);
      const price = toNumber(p.price);
      const stockValue = round2(currentStock * costPrice);
      const potentialRevenue = round2(currentStock * price);

      return {
        productId: p.id,
        name: p.name,
        nameEn: p.nameEn,
        sku: p.sku,
        category: p.category?.name || 'غير مصنف',
        categoryId: p.categoryId,
        branch: p.branchId,
        currentStock,
        costPrice,
        price,
        stockValue,
        potentialRevenue,
        unit: p.unit,
      };
    });

    // Summary totals
    const totalProducts = valuationData.length;
    const totalStockValue = round2(valuationData.reduce((s, p) => s + p.stockValue, 0));
    const totalPotentialRevenue = round2(valuationData.reduce((s, p) => s + p.potentialRevenue, 0));
    const totalPotentialProfit = round2(totalPotentialRevenue - totalStockValue);
    const averageMargin = totalPotentialRevenue > 0
      ? round2((totalPotentialProfit / totalPotentialRevenue) * 100)
      : 0;

    // Category breakdown
    const categoryMap = new Map<string, {
      categoryId: string;
      categoryName: string;
      categoryNameEn: string | null;
      productCount: number;
      totalStockValue: number;
      totalPotentialRevenue: number;
      totalCurrentStock: number;
    }>();

    for (const item of valuationData) {
      if (!categoryMap.has(item.categoryId)) {
        categoryMap.set(item.categoryId, {
          categoryId: item.categoryId,
          categoryName: item.category,
          categoryNameEn: products.find((p) => p.categoryId === item.categoryId)?.category?.nameEn || null,
          productCount: 0,
          totalStockValue: 0,
          totalPotentialRevenue: 0,
          totalCurrentStock: 0,
        });
      }
      const cat = categoryMap.get(item.categoryId)!;
      cat.productCount += 1;
      cat.totalStockValue += item.stockValue;
      cat.totalPotentialRevenue += item.potentialRevenue;
      cat.totalCurrentStock += item.currentStock;
    }

    const categoryBreakdown = Array.from(categoryMap.values()).map((cat) => ({
      ...cat,
      totalStockValue: round2(cat.totalStockValue),
      totalPotentialRevenue: round2(cat.totalPotentialRevenue),
      totalCurrentStock: round2(cat.totalCurrentStock),
    }));

    return NextResponse.json({
      branch: branchId || branchInput || 'all',
      categoryId: categoryId || null,
      summary: {
        totalProducts,
        totalStockValue,
        totalPotentialRevenue,
        totalPotentialProfit,
        averageMargin,
      },
      products: valuationData,
      categoryBreakdown,
    });
  } catch (error: any) {
    console.error('[inventory-valuation] Error:', error);
    return NextResponse.json(
      { error: 'فشل في إنشاء تقرير تقييم المخزون' },
      { status: 500 }
    );
  }
}
