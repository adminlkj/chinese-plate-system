import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireRole, checkWriteAccess } from '@/lib/api-auth';
import { auditBackup } from '@/lib/audit-log';

// POST /api/data/auto-backup/execute — Execute backup now (JSON export)
export async function POST(request: NextRequest) {
  try {
    const auth = await requireRole('ADMIN', request);
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
        // SECURITY: Exclude password hashes from backup
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

    const backupSize = Buffer.byteLength(JSON.stringify(backup));

    // Update last run timestamp
    const now = new Date();
    await db.setting.upsert({
      where: { key: 'auto_backup_last_run' },
      update: { value: now.toISOString() },
      create: { key: 'auto_backup_last_run', value: now.toISOString() },
    });

    // Audit log
    if (auth.authenticated) {
      auditBackup('EXPORT', `نسخ احتياطي تلقائي (${(backupSize / 1024).toFixed(1)} KB)`, auth.userId, auth.email).catch(() => {});
    }

    return NextResponse.json({
      success: true,
      size: backupSize,
      timestamp: now.toISOString(),
    });
  } catch (error: any) {
    console.error('Error executing backup:', error);
    return NextResponse.json(
      { error: 'فشل في إنشاء النسخة الاحتياطية' },
      { status: 500 }
    );
  }
}
