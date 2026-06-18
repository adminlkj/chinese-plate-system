import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth, requireRole, getUserAllowedBranches, checkWriteAccess, sanitizeInput } from '@/lib/api-auth';
import { auditLog } from '@/lib/audit-log';

// GET /api/branches — Fetch all active branches
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (!auth.authenticated) return auth.response;

  try {
    const branches = await db.branch.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });

    // Filter branches by user's allowedBranches
    // NOTE: allowedBranches is normalized to UUIDs at login (per AUDIT-5-6 fix),
    // so we filter by branch.id (UUID), not by branch.code.
    const allowedBranches = getUserAllowedBranches(auth);

    // If no Branch records yet, return default branches
    if (branches.length === 0) {
      const defaultBranches = [
        { id: 'default-ct', code: 'CHINA_TOWN', name: 'تشينا تاون', nameEn: 'China Town', isActive: true, sortOrder: 1 },
        { id: 'default-pi', code: 'PALACE_INDIA', name: 'بالاس إنديا', nameEn: 'Palace India', isActive: true, sortOrder: 2 },
      ];
      // For default branches (no DB rows yet) we cannot match UUIDs, so allow all
      // — these are pre-bootstrap defaults and assertBranchAccess will still gate mutations.
      return NextResponse.json(allowedBranches ? defaultBranches : defaultBranches);
    }

    const filteredBranches = allowedBranches
      ? branches.filter(b => allowedBranches.includes(b.id))
      : branches;
    return NextResponse.json(filteredBranches);
  } catch (error) {
    console.error('[API] Error fetching branches:', error);
    return NextResponse.json({ error: 'فشل في تحميل الفروع' }, { status: 500 });
  }
}

// POST /api/branches — Create a new branch with full system integration
// When a new branch is created, it automatically:
// 1. Creates a Branch record in the database
// 2. Creates a revenue account under 4000 (المبيعات) for the branch
// 3. Updates the branches setting JSON
// 4. Creates 10 default restaurant tables for the new branch
// 5. Copies product categories and products from an existing branch
export async function POST(request: NextRequest) {
  try {
    const auth = await requireRole('ADMIN', request);
    if (!auth.authenticated) return auth.response;

    const writeCheck = checkWriteAccess(auth, 'settings');
    if (!writeCheck.authenticated) return writeCheck.response;

    const body = await request.json();
    const {
      name, nameEn, code,
      address, addressEn,
      phone, email, manager,
      vatNumber, taxRate, maxDiscountPercentage,
      receiptHeader, receiptFooter,
    } = body;

    // Validate required fields
    if (!name || !name.trim()) {
      return NextResponse.json({ error: 'اسم الفرع مطلوب' }, { status: 400 });
    }

    // Generate branch code from name if not provided
    const branchCode = code || name.trim().toUpperCase().replace(/\s+/g, '_').replace(/[^A-Z0-9_]/g, '');

    if (!branchCode) {
      return NextResponse.json({ error: 'كود الفرع مطلوب' }, { status: 400 });
    }

    // Check if branch code already exists
    const existingBranch = await db.branch.findFirst({
      where: {
        OR: [
          { code: branchCode },
          { name: name.trim() },
        ],
      },
    });

    if (existingBranch) {
      return NextResponse.json(
        { error: 'كود الفرع أو الاسم موجود بالفعل' },
        { status: 409 }
      );
    }

    // Get the current max sortOrder
    const maxSortBranch = await db.branch.findFirst({
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    const nextSortOrder = (maxSortBranch?.sortOrder || 0) + 1;

    // Use transaction to ensure atomicity
    const result = await db.$transaction(async (tx) => {
      // 1. Create the Branch record
      const branch = await tx.branch.create({
        data: {
          code: branchCode,
          name: sanitizeInput(name.trim()),
          nameEn: nameEn ? sanitizeInput(nameEn.trim()) : null,
          address: address ? sanitizeInput(address) : null,
          addressEn: addressEn ? sanitizeInput(addressEn) : null,
          phone: phone ? sanitizeInput(phone) : null,
          email: email ? sanitizeInput(email) : null,
          manager: manager ? sanitizeInput(manager) : null,
          vatNumber: vatNumber ? sanitizeInput(vatNumber) : null,
          taxRate: taxRate ? parseFloat(String(taxRate)) : null,
          maxDiscountPercentage: maxDiscountPercentage ? parseFloat(String(maxDiscountPercentage)) : null,
          receiptHeader: receiptHeader ? sanitizeInput(receiptHeader) : null,
          receiptFooter: receiptFooter ? sanitizeInput(receiptFooter) : null,
          isActive: true,
          sortOrder: nextSortOrder,
        },
      });

      // 2. Create a revenue account for this branch under 4000 (المبيعات)
      // Find the parent sales account (4000)
      const salesParent = await tx.account.findFirst({
        where: { code: '4000' },
      });

      if (salesParent) {
        // Find the next available account code for branch sales
        // Existing pattern: 4100 = China Town, 4200 = Palace India
        // New branches get 4500, 4600, etc.
        const existingSalesAccounts = await tx.account.findMany({
          where: {
            parentId: salesParent.id,
            type: 'REVENUE',
          },
          orderBy: { code: 'asc' },
        });

        // Find next available code (4100+ in increments of 100)
        let nextCode = 4500; // Start after platform sales (4300) and discount received (4400)
        const usedCodes = new Set(existingSalesAccounts.map(a => parseInt(a.code)));
        while (usedCodes.has(nextCode)) {
          nextCode += 100;
        }

        await tx.account.create({
          data: {
            code: String(nextCode),
            name: `مبيعات ${name.trim()}`,
            nameEn: `${nameEn?.trim() || name.trim()} Sales`,
            type: 'REVENUE',
            parentId: salesParent.id,
            level: 2,
            branchId: branch.id,
            isSystem: true,
            isActive: true,
            openingBalance: 0,
            currentBalance: 0,
          },
        });
      }

      // 3. Update the branches setting JSON to include the new branch
      // This ensures the settings page shows the new branch
      const branchesSetting = await tx.setting.findUnique({
        where: { key: 'branches' },
      });

      let branchesList: Array<{ key: string; name: string; enabled: boolean }> = [];
      if (branchesSetting?.value) {
        try {
          branchesList = JSON.parse(branchesSetting.value);
        } catch {}
      }

      // Add new branch to settings if not already there
      if (!branchesList.some(b => b.key === branchCode)) {
        branchesList.push({
          key: branchCode,
          name: name.trim(),
          enabled: true,
        });

        await tx.setting.upsert({
          where: { key: 'branches' },
          update: { value: JSON.stringify(branchesList) },
          create: { key: 'branches', value: JSON.stringify(branchesList) },
        });
      }

      // 4. Create default restaurant tables for the new branch
      const tablePromises: Promise<any>[] = [];
      for (let i = 1; i <= 10; i++) {
        tablePromises.push(
          tx.restaurantTable.create({
            data: {
              name: String(i),
              branchId: branch.id,
              isActive: true,
              sortOrder: i,
            },
          })
        );
      }
      await Promise.all(tablePromises);

      // 5. Copy product categories from an existing branch (prefer CHINA_TOWN)
      const sourceBranch = await tx.branch.findFirst({
        where: {
          code: { not: branchCode },
          isActive: true,
        },
        orderBy: { sortOrder: 'asc' },
      });

      if (sourceBranch) {
        const sourceCategories = await tx.productCategory.findMany({
          where: { branchId: sourceBranch.id, isActive: true },
          include: { products: { where: { isActive: true } } },
          orderBy: { sortOrder: 'asc' },
        });

        for (const cat of sourceCategories) {
          // Check if category with same name already exists for this branch
          const existingCat = await tx.productCategory.findFirst({
            where: { name: cat.name, branchId: branch.id },
          });
          if (existingCat) continue;

          const newCat = await tx.productCategory.create({
            data: {
              name: cat.name,
              nameEn: cat.nameEn,
              branchId: branch.id,
              icon: cat.icon,
              color: cat.color,
              isActive: true,
              sortOrder: cat.sortOrder,
            },
          });

          // Copy products from this category
          for (const prod of cat.products) {
            await tx.product.create({
              data: {
                name: prod.name,
                nameEn: prod.nameEn,
                sku: prod.sku ? `${prod.sku}-${branchCode}` : null, // Avoid unique constraint
                categoryId: newCat.id,
                branchId: branch.id,
                costPrice: prod.costPrice,
                price: prod.price,
                unit: prod.unit,
                currentStock: 0, // New branch starts with 0 stock
                minStock: prod.minStock,
                maxStock: prod.maxStock,
                reorderQuantity: prod.reorderQuantity,
                isActive: true,
                sortOrder: prod.sortOrder,
              },
            });
          }
        }
      }

      return branch;
    });

    // AUDIT-9-18 — branch creation is CRITICAL (multi-branch entity + branch isolation boundary)
    auditLog({
      action: 'CREATE',
      entity: 'SETTING',
      entityId: result.id,
      entityNumber: result.code,
      description: `إنشاء فرع جديد: ${result.name} (${result.code})`,
      userId: auth.userId,
      userName: auth.email,
      userRole: auth.role,
      branchId: result.id,
      severity: 'CRITICAL',
      category: 'SETTINGS',
      details: { branchId: result.id, branchCode: result.code, branchName: result.name },
    }).catch(() => {});

    return NextResponse.json(result, { status: 201 });
  } catch (error: any) {
    console.error('[API] Error creating branch:', error);
    return NextResponse.json(
      { error: 'فشل في إنشاء الفرع' },
      { status: 500 }
    );
  }
}

// PUT /api/branches — Update a branch (including independent per-branch settings)
// Each branch holds its OWN independent config: logo, contact info, financial
// overrides (vatNumber, taxRate, maxDiscountPercentage), receipt custom text, etc.
export async function PUT(request: NextRequest) {
  try {
    const auth = await requireRole('ADMIN', request);
    if (!auth.authenticated) return auth.response;

    const body = await request.json();
    const {
      id,
      name, nameEn,
      address, addressEn,
      phone, email, manager,
      vatNumber, taxRate, maxDiscountPercentage,
      logo,
      receiptHeader, receiptFooter,
      isActive,
    } = body;

    if (!id) {
      return NextResponse.json({ error: 'معرف الفرع مطلوب' }, { status: 400 });
    }

    // Helper: safely convert numeric strings/numbers to Number, preserving null
    const toNumOrNull = (v: unknown): number | null => {
      if (v === null || v === undefined || v === '') return null;
      const n = typeof v === 'number' ? v : parseFloat(String(v));
      return Number.isFinite(n) ? n : null;
    };

    const branch = await db.branch.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name: sanitizeInput(name.trim()) } : {}),
        ...(nameEn !== undefined ? { nameEn: sanitizeInput(nameEn.trim()) } : {}),
        ...(address !== undefined ? { address: sanitizeInput(address) } : {}),
        ...(addressEn !== undefined ? { addressEn: sanitizeInput(addressEn) } : {}),
        ...(phone !== undefined ? { phone: sanitizeInput(phone) } : {}),
        ...(email !== undefined ? { email: sanitizeInput(email) } : {}),
        ...(manager !== undefined ? { manager: sanitizeInput(manager) } : {}),
        ...(vatNumber !== undefined ? { vatNumber: sanitizeInput(vatNumber) } : {}),
        ...(taxRate !== undefined ? { taxRate: toNumOrNull(taxRate) } : {}),
        ...(maxDiscountPercentage !== undefined ? { maxDiscountPercentage: toNumOrNull(maxDiscountPercentage) } : {}),
        ...(logo !== undefined ? { logo } : {}), // base64 data URL (validated upstream)
        ...(receiptHeader !== undefined ? { receiptHeader: sanitizeInput(receiptHeader) } : {}),
        ...(receiptFooter !== undefined ? { receiptFooter: sanitizeInput(receiptFooter) } : {}),
        ...(isActive !== undefined ? { isActive } : {}),
      },
    });

    // Also update the settings JSON
    if (name !== undefined || isActive !== undefined) {
      const branchesSetting = await db.setting.findUnique({
        where: { key: 'branches' },
      });

      if (branchesSetting?.value) {
        try {
          const branchesList = JSON.parse(branchesSetting.value);
          const idx = branchesList.findIndex((b: any) => b.key === branch.code);
          if (idx >= 0) {
            if (name !== undefined) branchesList[idx].name = name.trim();
            if (isActive !== undefined) branchesList[idx].enabled = isActive;
          }
          await db.setting.update({
            where: { key: 'branches' },
            data: { value: JSON.stringify(branchesList) },
          });
        } catch {}
      }
    }

    return NextResponse.json(branch);
  } catch (error: any) {
    console.error('[API] Error updating branch:', error);
    return NextResponse.json(
      { error: 'فشل في تحديث الفرع' },
      { status: 500 }
    );
  }
}
