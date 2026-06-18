import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { toNumber } from '@/lib/decimal';
import { requireAuth, checkWriteAccess, checkReadAccess, sanitizeInput, assertBranchAccess, getAccessGrantingContext } from '@/lib/api-auth';
import { resolveBranchId, resolveBranchIdOrNull } from '@/lib/branch-resolver';

// GET /api/pos/products - List products with optional filters
// Context-aware: POS users get READ access via POS_CONTEXT (Layer 2)
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(); if (!auth.authenticated) return auth.response;
    // checkReadAccess now supports context: if user has POS access but not explicit products-inventory READ,
    // the POS_CONTEXT (Layer 2) will grant READ access for product listing within POS
    const readCheck = checkReadAccess(auth, 'products-inventory', 'pos'); if (!readCheck.authenticated) return readCheck.response;

    // Audit: Log if access was granted via context (Layer 2) rather than explicit permission (Layer 1)
    if (process.env.NODE_ENV === 'development') {
      const grantingContext = getAccessGrantingContext(auth, 'products-inventory');
      if (grantingContext) {
        console.log(`[PERM] User ${auth.email} accessed products-inventory via ${grantingContext.id} context (${grantingContext.labelAr})`);
      }
    }
    const { searchParams } = new URL(request.url);
    const branchInput = searchParams.get('branch') || searchParams.get('branchId');
    const categoryId = searchParams.get('categoryId');
    const activeOnly = searchParams.get('activeOnly') === 'true';
    const search = searchParams.get('search');
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const take = Math.min(1000, Math.max(1, parseInt(searchParams.get('take') || '200')));

    const branchId = await resolveBranchIdOrNull(branchInput);

    // Verify branch access if branch filter is specified
    if (branchInput) {
      const branchCheck = assertBranchAccess(auth, branchInput);
      if (!branchCheck.authenticated) return branchCheck.response;
    }

    const where: any = {};
    if (branchId) where.branchId = branchId;
    if (categoryId) where.categoryId = categoryId;
    if (activeOnly) where.isActive = true;
    if (search) {
      where.OR = [
        { name: { contains: search } },
        { nameEn: { contains: search } },
        { sku: { contains: search } },
      ];
    }

    const [products, totalCount] = await Promise.all([
      db.product.findMany({
        where,
        include: {
          category: true,
        },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        skip: (page - 1) * take,
        take,
      }),
      db.product.count({ where }),
    ]);

    return NextResponse.json({
      products: products.map((p) => ({
        id: p.id,
        name: p.name,
        nameEn: p.nameEn,
        sku: p.sku,
        categoryId: p.categoryId,
        branchId: p.branchId,
        costPrice: toNumber(p.costPrice),
        price: toNumber(p.price),
        unit: p.unit,
        currentStock: toNumber(p.currentStock),
        minStock: toNumber(p.minStock),
        isActive: p.isActive,
        sortOrder: p.sortOrder,
        category: p.category
          ? {
              id: p.category.id,
              name: p.category.name,
              nameEn: p.category.nameEn,
              icon: p.category.icon,
              color: p.category.color,
            }
          : null,
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
      })),
      totalCount,
      page,
      take,
    });
  } catch (error: any) {
    console.error('Error fetching products:', error);
    return NextResponse.json(
      { error: 'فشل في جلب المنتجات' },
      { status: 500 }
    );
  }
}

// POST /api/pos/products - Create a new product
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(); if (!auth.authenticated) return auth.response;
    const writeCheck = checkWriteAccess(auth, 'products-inventory'); if (!writeCheck.authenticated) return writeCheck.response;
    const body = await request.json();
    const { name, nameEn, sku, categoryId, costPrice, cost, price, unit, sortOrder, minStock } = body;
    // Support both 'cost' and 'costPrice' field names
    const effectiveCostPrice = costPrice ?? cost ?? 0;

    // Resolve branchId from body.branch (code/name/id) or body.branchId (UUID)
    const branchId = await resolveBranchId(body.branch || body.branchId);
    if (!branchId) {
      return NextResponse.json(
        { error: 'branchId مطلوب' },
        { status: 400 }
      );
    }

    // Verify the user has access to this branch
    const branchCheck = assertBranchAccess(auth, body.branch || body.branchId);
    if (!branchCheck.authenticated) return branchCheck.response;

    const sanitizedName = sanitizeInput(name);
    if (!sanitizedName) {
      return NextResponse.json(
        { error: 'اسم المنتج مطلوب' },
        { status: 400 }
      );
    }

    if (!categoryId) {
      return NextResponse.json(
        { error: 'التصنيف مطلوب' },
        { status: 400 }
      );
    }

    if (price === undefined || price === null) {
      return NextResponse.json(
        { error: 'سعر البيع مطلوب' },
        { status: 400 }
      );
    }

    // Verify category exists
    const category = await db.productCategory.findUnique({
      where: { id: categoryId },
    });

    if (!category) {
      return NextResponse.json(
        { error: 'التصنيف غير موجود' },
        { status: 404 }
      );
    }

    const product = await db.product.create({
      data: {
        name: sanitizedName,
        nameEn: nameEn ? sanitizeInput(nameEn) : null,
        sku: sku || null,
        categoryId,
        branchId,
        costPrice: parseFloat(String(effectiveCostPrice)),
        price: parseFloat(String(price)),
        unit: unit || 'قطعة',
        minStock: parseFloat(String(minStock || 0)),
        sortOrder: sortOrder ?? 0,
      },
      include: {
        category: true,
      },
    });

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
    }, { status: 201 });
  } catch (error: any) {
    console.error('Error creating product:', error);
    return NextResponse.json(
      { error: 'فشل في إنشاء المنتج' },
      { status: 500 }
    );
  }
}
