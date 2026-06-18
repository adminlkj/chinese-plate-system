import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireRole, checkWriteAccess } from '@/lib/api-auth';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

/**
 * System Recovery endpoint — auto-fixes common issues.
 * Requires ADMIN role.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireRole('ADMIN', request);
    if (!auth.authenticated) return auth.response;

    const writeCheck = checkWriteAccess(auth, 'settings'); if (!writeCheck.authenticated) return writeCheck.response;

    const fixes: string[] = [];
    const errors: string[] = [];

    // 1. Verify database connectivity
    try {
      await db.$connect();
      fixes.push('Database connection OK');
    } catch (err: any) {
      errors.push('فشل الاتصال بقاعدة البيانات');
      return NextResponse.json({ fixes, errors }, { status: 500 });
    }

    // 2. Create admin user if none exists
    try {
      const adminCount = await db.user.count({ where: { role: 'ADMIN', isActive: true } });
      if (adminCount === 0) {
        const defaultEmail = process.env.DEFAULT_ADMIN_EMAIL || 'admin@system-recover.local';
        const defaultPassword = process.env.DEFAULT_ADMIN_PASSWORD || crypto.randomBytes(24).toString('base64');
        const hashedPassword = await bcrypt.hash(defaultPassword, 12);
        await db.user.create({
          data: {
            email: defaultEmail,
            name: 'مدير النظام',
            nameEn: 'System Admin',
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
        });
        fixes.push('Created default admin user');
      } else {
        fixes.push(`Admin user exists (${adminCount} found)`);
      }
    } catch (err: any) {
      if (err.code === 'P2002') {
        fixes.push('Admin user already exists (race condition handled)');
      } else {
        errors.push('فشل التحقق من المستخدم الإداري أو إنشاؤه');
      }
    }

    // 3. Fix missing settings
    try {
      const requiredSettings = [
        { key: 'companyName', defaultValue: '' },
        { key: 'companyNameEn', defaultValue: '' },
        { key: 'taxNumber', defaultValue: '' },
        { key: 'defaultCurrency', defaultValue: 'SAR' },
        { key: 'taxRate', defaultValue: '15' },
        { key: 'fiscalYearStart', defaultValue: '1' },
        { key: 'receiptWidth', defaultValue: '80' },
        { key: 'receiptFontSize', defaultValue: '11' },
      ];

      for (const setting of requiredSettings) {
        const existing = await db.setting.findUnique({ where: { key: setting.key } });
        if (!existing) {
          await db.setting.create({ data: { key: setting.key, value: setting.defaultValue } });
          fixes.push(`Created missing setting: ${setting.key}`);
        }
      }
      fixes.push('Settings check complete');
    } catch (err: any) {
      errors.push('فشل إصلاح الإعدادات');
    }

    // 4. Check fiscal periods
    try {
      const periodCount = await db.fiscalPeriod.count();
      if (periodCount === 0) {
        fixes.push('No fiscal periods found — consider creating one in Settings');
      } else {
        fixes.push(`Fiscal periods exist (${periodCount} found)`);
      }
    } catch (err: any) {
      errors.push('فشل التحقق من الفترات المالية');
    }

    // 5. Check chart of accounts
    try {
      const accountCount = await db.account.count();
      if (accountCount === 0) {
        fixes.push('No accounts found — consider seeding in Settings');
      } else {
        fixes.push(`Accounts exist (${accountCount} found)`);
      }
    } catch (err: any) {
      errors.push('فشل التحقق من الحسابات');
    }

    return NextResponse.json({ fixes, errors });
  } catch (error: any) {
    console.error('System recovery error:', error);
    return NextResponse.json(
      { fixes: [], errors: ['حدث خطأ غير متوقع أثناء استرداد النظام'] },
      { status: 500 }
    );
  }
}
