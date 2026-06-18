import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { db } from '@/lib/db';
import { requireAuth, requireRole, checkWriteAccess, checkReadAccess } from '@/lib/api-auth';
import { auditLog } from '@/lib/audit-log';

// GET /api/settings
export async function GET() {
  try {
    const auth = await requireAuth(); if (!auth.authenticated) return auth.response;
    const readCheck = checkReadAccess(auth, 'settings'); if (!readCheck.authenticated) return readCheck.response;
    const settings = await db.setting.findMany();
    const settingsMap: Record<string, string> = {};
    for (const s of settings) {
      // SECURITY: Never return the supervisor password in plain text
      if (s.key === 'supervisorPassword') {
        settingsMap[s.key] = '••••'; // Masked placeholder
      } else {
        settingsMap[s.key] = s.value;
      }
    }
    // CACHE: Prevent stale settings from being cached by browser/CDN
    const response = NextResponse.json(settingsMap);
    response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    return response;
  } catch (error) {
    return NextResponse.json({ error: 'فشل في جلب الإعدادات' }, { status: 500 });
  }
}

// POST /api/settings - Update settings
// WRAPPED IN $transaction for atomicity: all settings upserts must succeed or fail together
export async function POST(request: NextRequest) {
  try {
    const auth = await requireRole('ADMIN'); if (!auth.authenticated) return auth.response;
    const writeCheck = checkWriteAccess(auth, 'settings'); if (!writeCheck.authenticated) return writeCheck.response;
    const body = await request.json();

    // Whitelist of allowed setting keys
    const ALLOWED_KEYS = [
      'companyName', 'companyNameEn', 'taxNumber', 'crNumber', 'phone', 'email', 'address', 'addressEn',
      'logo', 'currencySymbolImage', 'taxRate', 'fiscalYearStart',
      'receiptWidth', 'receiptFontSize', 'logoWidth', 'logoHeight',
      'maxDiscountPercentage', 'supervisorPassword', 'printLogoOnReceipt',
      'defaultPaymentMethod', 'allowNegativeStock',
    ];

    // Filter to only allowed keys
    const filteredEntries = Object.entries(body).filter(([key]) => ALLOWED_KEYS.includes(key));
    if (filteredEntries.length === 0) {
      return NextResponse.json({ error: 'لا توجد إعدادات صالحة للتحديث' }, { status: 400 });
    }

    await db.$transaction(async (tx) => {
      for (const [key, value] of filteredEntries) {
        let storedValue = String(value);
        // SECURITY: Hash the supervisor password with bcrypt before storing
        if (key === 'supervisorPassword') {
          // Only hash if it's not already a bcrypt hash (starts with $2a$, $2b$, or $2y$)
          if (!/^\$2[aby]\$/.test(storedValue)) {
            storedValue = await bcrypt.hash(storedValue, 10);
          }
        }
        await tx.setting.upsert({
          where: { key },
          update: { value: storedValue },
          create: { key, value: storedValue },
        });
      }
    });

    // AUDIT-9-18: Audit log settings change (WARNING severity — compliance-sensitive)
    auditLog({
      action: 'SETTINGS_CHANGE',
      entity: 'SETTING',
      description: `تحديث الإعدادات: ${filteredEntries.map(([k]) => k).join(', ')}`,
      userId: auth.userId,
      userName: auth.email,
      userRole: auth.role,
      severity: 'WARNING',
      category: 'SETTINGS',
      details: { keys: filteredEntries.map(([k]) => k) },
    }).catch(() => {});

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[settings] Error:', error);
    return NextResponse.json({ error: 'حدث خطأ في الخادم' }, { status: 500 });
  }
}
