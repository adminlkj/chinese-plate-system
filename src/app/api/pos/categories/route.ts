import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { toNumber } from '@/lib/decimal';
import { requireAuth, checkWriteAccess, checkReadAccess, sanitizeInput, assertBranchAccess } from '@/lib/api-auth';
import { resolveBranchId, resolveBranchIdOrNull } from '@/lib/branch-resolver';

// GET /api/pos/categories - List categories with optional filters
// Query params: branch, activeOnly, summary (if true, returns count instead of full products)
// When summary=true: uses _count for product count instead of loading full product objects
// Default mode (backward compat): includes products with a take limit (default 100)
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(); if (!auth.authenticated) return auth.response;
    // Context-aware: POS users get READ access via POS_CONTEXT (Layer 2)
    const readCheck = checkReadAccess(auth, 'products-inventory', 'pos'); if (!readCheck.authenticated) return readCheck.response;
    const { searchParams } = new URL(request.url);
    const branchInput = searchParams.get('branch') || searchParams.get('branchId');
    const activeOnly = searchParams.get('activeOnly') === 'true';
    const summary = searchParams.get('summary') === 'true';
    const productsTake = Math.min(500, Math.max(1, parseInt(searchParams.get('productsTake') || '100')));

    const branchId = await resolveBranchIdOrNull(branchInput);

    // Verify branch access if branch filter is specified
    if (branchInput) {
      const branchCheck = assertBranchAccess(auth, branchInput);
      if (!branchCheck.authenticated) return branchCheck.response;
    }

    const where: any = {};
    if (branchId) where.branchId = branchId;
    if (activeOnly) where.isActive = true;

    if (summary) {
      // Summary mode: return categories with product COUNT only (no full product objects)
      const categories = await db.productCategory.findMany({
        where,
        include: {
          _count: { select: { products: activeOnly ? { where: { isActive: true } } : true } },
        },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      });

      return NextResponse.json({
        categories: categories.map((c) => ({
          id: c.id,
          name: c.name,
          nameEn: c.nameEn,
          branchId: c.branchId,
          icon: c.icon,
          color: c.color,
          isActive: c.isActive,
          sortOrder: c.sortOrder,
          productsCount: c._count.products,
          products: [],
          createdAt: c.createdAt.toISOString(),
          updatedAt: c.updatedAt.toISOString(),
        })),
      });
    }

    // Default mode (backward compatible): include products with take limit
    const categories = await db.productCategory.findMany({
      where,
      include: {
        products: {
          where: activeOnly ? { isActive: true } : {},
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          take: productsTake,
        },
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });

    return NextResponse.json({
      categories: categories.map((c) => ({
        id: c.id,
        name: c.name,
        nameEn: c.nameEn,
        branchId: c.branchId,
        icon: c.icon,
        color: c.color,
        isActive: c.isActive,
        sortOrder: c.sortOrder,
        productsCount: c.products.length,
        products: c.products.map((p) => ({
          id: p.id,
          name: p.name,
          nameEn: p.nameEn,
          price: toNumber(p.price),
          branchId: p.branchId,
          isActive: p.isActive,
          sortOrder: p.sortOrder,
        })),
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
      })),
    });
  } catch (error: any) {
    console.error('Error fetching categories:', error);
    return NextResponse.json(
      { error: 'فشل في جلب التصنيفات' },
      { status: 500 }
    );
  }
}

// POST /api/pos/categories - Create a new category
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(); if (!auth.authenticated) return auth.response;
    const writeCheck = checkWriteAccess(auth, 'products-inventory'); if (!writeCheck.authenticated) return writeCheck.response;
    const body = await request.json();
    const { name, nameEn, icon, color, sortOrder } = body;

    if (!name) {
      return NextResponse.json(
        { error: 'اسم التصنيف مطلوب' },
        { status: 400 }
      );
    }

    // Resolve branchId (UUID) from body.branch (code/name/id) or body.branchId
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

    const category = await db.productCategory.create({
      data: {
        name: sanitizeInput(name),
        nameEn: nameEn ? sanitizeInput(nameEn) : null,
        branchId,
        icon: icon || null,
        color: color || null,
        sortOrder: sortOrder ?? 0,
      },
      include: {
        products: true,
      },
    });

    return NextResponse.json({
      id: category.id,
      name: category.name,
      nameEn: category.nameEn,
      branchId: category.branchId,
      icon: category.icon,
      color: category.color,
      isActive: category.isActive,
      sortOrder: category.sortOrder,
      productsCount: category.products.length,
      products: [],
      createdAt: category.createdAt.toISOString(),
      updatedAt: category.updatedAt.toISOString(),
    }, { status: 201 });
  } catch (error: any) {
    console.error('Error creating category:', error);
    // Handle unique constraint violations with 409 Conflict
    if (error.code === 'P2002') {
      const fields = error.meta?.target?.join(', ') || 'الحقول الفريدة';
      return NextResponse.json(
        { error: `قيمة مكررة في ${fields}` },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: 'فشل في إنشاء التصنيف' },
      { status: 500 }
    );
  }
}
