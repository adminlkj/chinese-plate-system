import { NextResponse } from 'next/server';
import { requireRole, checkWriteAccess } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { auditBackup } from '@/lib/audit-log';

// GET /api/data/export - Export the database as JSON for PostgreSQL backup
export async function GET() {
  try {
    const auth = await requireRole('ADMIN');
    if (!auth.authenticated) return auth.response;

    const writeCheck = checkWriteAccess(auth, 'settings'); if (!writeCheck.authenticated) return writeCheck.response;

    // Export all data as JSON
    const backup = {
      version: '2.0.0',
      format: 'postgresql-json',
      exportedAt: new Date().toISOString(),
      data: {
        branches: await db.branch.findMany(),
        accounts: await db.account.findMany(),
        customers: await db.customer.findMany(),
        suppliers: await db.supplier.findMany(),
        transactions: await db.transaction.findMany(),
        journalEntries: await db.journalEntry.findMany({ include: { lines: true } }),
        products: await db.product.findMany(),
        productCategories: await db.productCategory.findMany(),
        posInvoices: await db.pOSInvoice.findMany({ include: { items: true, payments: true } }),
        posInvoiceItemProducts: await db.pOSInvoiceItemProduct.findMany(),
        stockTransactions: await db.stockTransaction.findMany(),
        stockTakes: await db.stockTake.findMany({ include: { items: true } }),
        stockTransfers: await db.stockTransfer.findMany({ include: { items: true } }),
        shifts: await db.shift.findMany(),
        // SECURITY: Exclude password hashes from export
        users: await db.user.findMany({
          include: { permissions: true },
          select: {
            id: true, email: true, name: true, nameEn: true, role: true,
            allowedBranches: true, isActive: true, createdAt: true, updatedAt: true,
            permissions: { select: { id: true, screen: true, accessLevel: true, createdAt: true, updatedAt: true } },
          },
        }),
        settings: await db.setting.findMany(),
        fiscalPeriods: await db.fiscalPeriod.findMany(),
        restaurantTables: await db.restaurantTable.findMany(),
        auditLogs: await db.auditLog.findMany(),
      },
    };

    // Audit log the export
    if (auth.authenticated) {
      auditBackup('EXPORT', `تصدير نسخة احتياطية JSON`, auth.userId, auth.email).catch(() => {});
    }

    const jsonStr = JSON.stringify(backup, null, 2);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `accounting-backup-${timestamp}.json`;

    return new NextResponse(jsonStr, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': Buffer.byteLength(jsonStr).toString(),
      },
    });
  } catch (error: any) {
    console.error('Error exporting database:', error);
    return NextResponse.json(
      { error: 'فشل في تصدير قاعدة البيانات' },
      { status: 500 }
    );
  }
}
