import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth, checkWriteAccess, assertBranchAccess } from '@/lib/api-auth';
import { resolveBranchId, resolveBranchIdOrNull, getDefaultBranchId } from '@/lib/branch-resolver';

// POST /api/pos/products/import - Bulk import products from Excel/CSV
// Required columns: Name (or Name Arabic)
// Optional columns: Name (Arabic), Cost Price, Selling Price, Category, Branch, SKU, Unit
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(); if (!auth.authenticated) return auth.response;
    const writeCheck = checkWriteAccess(auth, 'products-inventory'); if (!writeCheck.authenticated) return writeCheck.response;
    const body = await request.json();
    const { products, defaultBranch, defaultBranchId: bodyDefaultBranchId, defaultCategoryId } = body;

    // The frontend (products-inventory.tsx) sends `defaultBranchId` (UUID).
    // For backward compatibility, also accept the legacy `defaultBranch` field
    // (which may be a code or UUID — resolveBranchId handles both).
    const rawBranchInput = bodyDefaultBranchId || defaultBranch;

    // Resolve the default branch to a branchId (UUID)
    const defaultBranchId = await (async () => {
      if (rawBranchInput) return resolveBranchId(rawBranchInput);
      try { return await getDefaultBranchId(); } catch { return null; }
    })();

    // Verify the user has access to the default branch (use the resolved UUID)
    if (defaultBranchId) {
      const branchCheck = assertBranchAccess(auth, defaultBranchId);
      if (!branchCheck.authenticated) return branchCheck.response;
    }

    if (!Array.isArray(products) || products.length === 0) {
      return NextResponse.json(
        { error: 'لا توجد بيانات للاستيراد' },
        { status: 400 }
      );
    }

    // Resolve or create a default category if needed
    let defaultCategory = defaultCategoryId;
    if (!defaultCategory) {
      // Find or create an "Imported" category
      const existing = await db.productCategory.findFirst({
        where: { name: 'أصناف مستوردة', ...(defaultBranchId ? { branchId: defaultBranchId } : {}) },
      });
      if (existing) {
        defaultCategory = existing.id;
      } else {
        if (!defaultBranchId) {
          return NextResponse.json(
            { error: 'branchId مطلوب للاستيراد' },
            { status: 400 }
          );
        }
        const created = await db.productCategory.create({
          data: {
            name: 'أصناف مستوردة',
            nameEn: 'Imported Items',
            branchId: defaultBranchId,
            icon: '📦',
            color: '#64748b',
            sortOrder: 999,
          },
        });
        defaultCategory = created.id;
      }
    }

    // Verify the default category exists
    const catExists = await db.productCategory.findUnique({
      where: { id: defaultCategory },
    });
    if (!catExists) {
      return NextResponse.json(
        { error: 'التصنيف الافتراضي غير موجود' },
        { status: 400 }
      );
    }

    // Map of category names to IDs for quick lookup
    const categoryMap = new Map<string, string>();
    const allCategories = await db.productCategory.findMany();
    for (const cat of allCategories) {
      categoryMap.set(cat.name.toLowerCase(), cat.id);
      if (cat.nameEn) categoryMap.set(cat.nameEn!.toLowerCase(), cat.id);
    }

    const results = {
      total: products.length,
      success: 0,
      failed: 0,
      errors: [] as { row: number; name: string; error: string }[],
      created: [] as { id: string; name: string; nameEn?: string | null }[],
    };

    for (let i = 0; i < products.length; i++) {
      const row = products[i];
      const rowNum = i + 2; // Excel row number (1 = header)

      try {
        // Extract fields - support both English and Arabic column names
        const name = (row.name || row.Name || row['name (arabic)'] || row['Name (Arabic)'] || row['الاسم'] || row['اسم المنتج'] || '').toString().trim();
        const nameEn = (row.nameEn || row['nameEn'] || row.Name || row['Name (Arabic)'] || row['الاسم انجليزي'] || row['اسم انجليزي'] || '').toString().trim();
        const costPrice = parseFloat(String(row.costPrice || row['Cost Price'] || row['Cost Prise'] || row['cost price'] || row['سعر التكلفة'] || row['تكلفة'] || '0')) || 0;
        const price = parseFloat(String(row.price || row.Price || row['Selling Price'] || row['selling price'] || row['سعر البيع'] || row['سعر'] || '0')) || 0;
        const sku = (row.sku || row.SKU || row['رمز المنتج'] || '').toString().trim();
        const unit = (row.unit || row.Unit || row['الوحدة'] || '').toString().trim();
        const categoryName = (row.category || row.Category || row['القسم'] || row['التصنيف'] || '').toString().trim();
        const rowBranchInput = (row.branch || row.branchId || row.Branch || row['الفرع'] || rawBranchInput || '').toString().trim();
        const rowBranchId = await resolveBranchIdOrNull(rowBranchInput) || defaultBranchId;
        if (!rowBranchId) {
          results.failed++;
          results.errors.push({ row: rowNum, name: name || nameEn || `صف ${rowNum}`, error: 'branchId مطلوب' });
          continue;
        }

        // Only name is required - price defaults to 0 if not provided
        if (!name && !nameEn) {
          results.failed++;
          results.errors.push({ row: rowNum, name: `صف ${rowNum}`, error: 'الاسم مطلوب' });
          continue;
        }

        // Resolve category
        let categoryId = defaultCategory;
        if (categoryName) {
          const found = categoryMap.get(categoryName.toLowerCase());
          if (found) {
            categoryId = found;
          } else {
            // Auto-create the category
            const newCat = await db.productCategory.create({
              data: {
                name: categoryName,
                nameEn: categoryName,
                branchId: rowBranchId,
                icon: '📦',
                color: '#10b981',
                sortOrder: 0,
              },
            });
            categoryMap.set(categoryName.toLowerCase(), newCat.id);
            categoryId = newCat.id;
          }
        }

        // Create the product
        const product = await db.product.create({
          data: {
            name: name || nameEn,
            nameEn: nameEn || null,
            sku: sku || null,
            categoryId,
            branchId: rowBranchId,
            costPrice,
            price,
            unit: unit || 'قطعة',
            minStock: 0,
            sortOrder: 0,
          },
        });

        results.success++;
        results.created.push({
          id: product.id,
          name: product.name,
          nameEn: product.nameEn,
        });
      } catch (err: any) {
        results.failed++;
        results.errors.push({
          row: rowNum,
          name: row.name || row.Name || `صف ${rowNum}`,
          error: err.message || 'خطأ غير معروف',
        });
      }
    }

    return NextResponse.json(results, { status: 200 });
  } catch (error: any) {
    console.error('Error importing products:', error);
    return NextResponse.json(
      { error: 'فشل في استيراد المنتجات' },
      { status: 500 }
    );
  }
}
