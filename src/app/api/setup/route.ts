import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { db } from '@/lib/db';
import { DEFAULT_ACCOUNTS } from '@/lib/seed-data';
import { sanitizeInput } from '@/lib/api-auth';

// GET /api/setup — Check if system needs initial setup
export async function GET() {
  try {
    const hasAdmin = (await db.user.findFirst({ where: { role: 'ADMIN', isActive: true } })) !== null;

    // SECURITY: Only return whether setup is needed, not user counts or admin status details
    return NextResponse.json({
      needsSetup: !hasAdmin,
    });
  } catch (error: any) {
    // If DB is not connected, needs setup
    return NextResponse.json({
      needsSetup: true,
    });
  }
}

// POST /api/setup — Execute full system setup in a single transaction
export async function POST(request: NextRequest) {
  try {
    // Safety check: if admin already exists, reject
    const existingAdmin = await db.user.findFirst({ where: { role: 'ADMIN', isActive: true } });
    if (existingAdmin) {
      return NextResponse.json(
        { error: 'النظام مهيأ بالفعل - System is already set up' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const {
      companyName: rawCompanyName,
      companyNameEn: rawCompanyNameEn,
      taxNumber: rawTaxNumber,
      address: rawAddress,
      phone: rawPhone,
      branchName: rawBranchName,
      branchNameEn: rawBranchNameEn,
      branchCode: rawBranchCode,
      adminEmail: rawAdminEmail,
      adminName: rawAdminName,
      adminNameEn: rawAdminNameEn,
      adminPassword,
      taxRate,
      supervisorPassword: rawSupervisorPassword,
    } = body;

    // Sanitize all text inputs to prevent XSS
    const companyName = sanitizeInput(rawCompanyName);
    const companyNameEn = sanitizeInput(rawCompanyNameEn);
    const taxNumber = sanitizeInput(rawTaxNumber);
    const address = sanitizeInput(rawAddress);
    const phone = sanitizeInput(rawPhone);
    const branchName = sanitizeInput(rawBranchName);
    const branchNameEn = sanitizeInput(rawBranchNameEn);
    const branchCode = sanitizeInput(rawBranchCode);
    const adminEmail = sanitizeInput(rawAdminEmail);
    const adminName = sanitizeInput(rawAdminName);
    const adminNameEn = sanitizeInput(rawAdminNameEn);
    const supervisorPassword = rawSupervisorPassword; // Don't sanitize password — would alter it

    // Validation
    if (!companyName) {
      return NextResponse.json({ error: 'اسم الشركة مطلوب' }, { status: 400 });
    }
    if (!branchName) {
      return NextResponse.json({ error: 'اسم الفرع مطلوب' }, { status: 400 });
    }
    if (!adminEmail) {
      return NextResponse.json({ error: 'البريد الإلكتروني للمدير مطلوب' }, { status: 400 });
    }
    // Email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(adminEmail)) {
      return NextResponse.json({ error: 'صيغة البريد الإلكتروني غير صحيحة' }, { status: 400 });
    }
    if (!adminName) {
      return NextResponse.json({ error: 'اسم المدير مطلوب' }, { status: 400 });
    }
    if (!adminPassword || adminPassword.length < 8) {
      return NextResponse.json({ error: 'كلمة المرور يجب أن تكون 8 أحرف على الأقل' }, { status: 400 });
    }

    const effectiveTaxRate = taxRate !== undefined ? Number(taxRate) : 15;
    if (isNaN(effectiveTaxRate) || effectiveTaxRate < 0 || effectiveTaxRate > 100) {
      return NextResponse.json({ error: 'نسبة الضريبة غير صحيحة' }, { status: 400 });
    }

    const effectiveBranchCode = branchCode || 'MAIN';


    // Execute everything in a single transaction
    const result = await db.$transaction(async (tx) => {
      // 1. Create company settings
      const settingsData: { key: string; value: string }[] = [
        { key: 'companyName', value: companyName },
        { key: 'companyNameEn', value: companyNameEn || '' },
        { key: 'taxNumber', value: taxNumber || '' },
        { key: 'address', value: address || '' },
        { key: 'phone', value: phone || '' },
        { key: 'taxRate', value: String(effectiveTaxRate) },
      ];

      if (supervisorPassword && supervisorPassword.trim()) {
        const hashedSupervisorPwd = await bcrypt.hash(supervisorPassword.trim(), 10);
        settingsData.push({ key: 'supervisorPassword', value: hashedSupervisorPwd });
      }

      for (const setting of settingsData) {
        await tx.setting.upsert({
          where: { key: setting.key },
          update: { value: setting.value },
          create: { key: setting.key, value: setting.value },
        });
      }

      // 2. Create the user's first branch
      const branch = await tx.branch.create({
        data: {
          code: effectiveBranchCode,
          name: branchName,
          nameEn: branchNameEn || null,
          address: address || null,
          phone: phone || null,
          sortOrder: 1,
        },
      });

      // 3. Create admin user with hashed password and FULL permissions
      const hashedPassword = await bcrypt.hash(adminPassword, 12);
      const admin = await tx.user.create({
        data: {
          email: adminEmail,
          name: adminName,
          nameEn: adminNameEn || null,
          password: hashedPassword,
          role: 'ADMIN',
          isActive: true,
          permissions: {
            create: [
              { screen: 'dashboard', accessLevel: 'FULL' },
              { screen: 'pos', accessLevel: 'FULL' },
              { screen: 'chart-of-accounts', accessLevel: 'FULL' },
              { screen: 'transactions', accessLevel: 'FULL' },
              { screen: 'journal', accessLevel: 'FULL' },
              { screen: 'ledger', accessLevel: 'FULL' },
              { screen: 'trial-balance', accessLevel: 'FULL' },
              { screen: 'financial-center', accessLevel: 'FULL' },
              { screen: 'income-statement', accessLevel: 'FULL' },
              { screen: 'cash-flow', accessLevel: 'FULL' },
              { screen: 'customers', accessLevel: 'FULL' },
              { screen: 'suppliers', accessLevel: 'FULL' },
              { screen: 'products-inventory', accessLevel: 'FULL' },
              { screen: 'sales-invoices', accessLevel: 'FULL' },
              { screen: 'settings', accessLevel: 'FULL' },
              { screen: 'users', accessLevel: 'FULL' },
            ],
          },
        },
        include: { permissions: true },
      });

      // 4. Seed default chart of accounts
      const codeToIdMap = new Map<string, string>();
      const accountsCreated: string[] = [];

      for (const accountData of DEFAULT_ACCOUNTS) {
        const parentId = accountData.parentId ? codeToIdMap.get(accountData.parentId) : null;

        const account = await tx.account.upsert({
          where: { code: accountData.code },
          update: {
            name: accountData.name,
            nameEn: accountData.nameEn || null,
            type: accountData.type,
            level: accountData.level,
            isSystem: accountData.isSystem || false,
            isActive: true,
          },
          create: {
            code: accountData.code,
            name: accountData.name,
            nameEn: accountData.nameEn || null,
            type: accountData.type,
            parentId: parentId,
            // All seeded accounts are attached to the freshly-created branch
            // (accountData.branch in seed-data.ts is a legacy branch CODE that
            // is no longer used — UUID is the only identifier).
            branchId: branch.id,
            level: accountData.level,
            isSystem: accountData.isSystem || false,
            isComputed: accountData.isComputed || false,
            computedSource: accountData.computedSource || null,
            openingBalance: 0,
            currentBalance: 0,
            isActive: true,
          },
        });

        codeToIdMap.set(accountData.code, account.id);
        accountsCreated.push(account.code);
      }

      // Ensure account 2600 is a regular account (NOT computed)
      const account2600 = await tx.account.findFirst({ where: { code: '2600' } });
      if (account2600 && (account2600.isComputed || account2600.computedSource)) {
        await tx.account.update({
          where: { id: account2600.id },
          data: {
            name: 'ضريبة مستحقة',
            nameEn: 'Tax Payable',
            isComputed: false,
            computedSource: null,
          },
        });
      }

      // 5. Create fiscal period for current year
      const currentYear = new Date().getFullYear();
      const fiscalPeriod = await tx.fiscalPeriod.create({
        data: {
          name: `السنة المالية ${currentYear} / FY ${currentYear}`,
          startDate: new Date(currentYear, 0, 1),
          endDate: new Date(currentYear, 11, 31),
          status: 'OPEN',
        },
      });

      return {
        branch,
        admin: { id: admin.id, email: admin.email, name: admin.name },
        accountsCount: accountsCreated.length,
        fiscalPeriod: { id: fiscalPeriod.id, name: fiscalPeriod.name },
      };
    });

    return NextResponse.json({
      success: true,
      message: 'تم إعداد النظام بنجاح',
      data: result,
    });
  } catch (error: any) {
    console.error('[setup] Error:', error);

    // Handle unique constraint violations
    if (error.code === 'P2002') {
      return NextResponse.json(
        { error: 'النظام مهيأ بالفعل - System is already set up' },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: 'حدث خطأ في الخادم' },
      { status: 500 }
    );
  }
}
