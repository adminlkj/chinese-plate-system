import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireRole } from '@/lib/api-auth';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireRole('ADMIN', request);
    if (!auth.authenticated) return auth.response;

    const [userCount, accountCount, branchCount, invoiceCount, journalEntryCount, productCount, customerCount] = await Promise.all([
      db.user.count(),
      db.account.count(),
      db.branch.count(),
      db.pOSInvoice.count(),
      db.journalEntry.count(),
      db.product.count(),
      db.customer.count(),
    ]);

    const settings = await db.setting.findMany({
      where: { key: { in: ['companyName', 'companyNameEn', 'taxNumber', 'currency'] } },
    });
    const settingsMap = Object.fromEntries(settings.map(s => [s.key, s.value]));

    const dbUrl = process.env.DATABASE_URL || '';
    const isConfigured = dbUrl.length > 0;
    const isPostgreSQL = dbUrl.startsWith('postgresql://') || dbUrl.startsWith('postgres://');

    return NextResponse.json({
      database: {
        configured: isConfigured,
        provider: isPostgreSQL ? 'PostgreSQL' : 'unknown',
        users: userCount,
        accounts: accountCount,
        branches: branchCount,
        invoices: invoiceCount,
        journalEntries: journalEntryCount,
        products: productCount,
        customers: customerCount,
      },
      settings: {
        companyName: settingsMap.companyName || 'not set',
        companyNameEn: settingsMap.companyNameEn || 'not set',
        taxNumber: settingsMap.taxNumber || 'not set',
        currency: settingsMap.currency || 'SAR',
      },
      server: {
        nodeEnv: process.env.NODE_ENV || 'not set',
      },
    });
  } catch (error: any) {
    console.error('[GET /api/admin/diagnostics]', error);
    return NextResponse.json({ error: 'فشل في جلب تشخيصات النظام' }, { status: 500 });
  }
}
