import { NextRequest, NextResponse } from 'next/server';
import { requireRole, checkWriteAccess } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { auditBackup } from '@/lib/audit-log';

// POST /api/data/import - Import a JSON database backup (restore from backup)
export async function POST(request: NextRequest) {
  try {
    const auth = await requireRole('ADMIN');
    if (!auth.authenticated) return auth.response;

    const writeCheck = checkWriteAccess(auth, 'settings'); if (!writeCheck.authenticated) return writeCheck.response;

    const formData = await request.formData();
    const file = formData.get('backup') as File | null;

    if (!file) {
      return NextResponse.json(
        { error: 'لم يتم اختيار ملف / No file uploaded' },
        { status: 400 }
      );
    }

    // Validate file type
    const fileName = file.name.toLowerCase();
    if (!fileName.endsWith('.json')) {
      return NextResponse.json(
        { error: 'يجب اختيار ملف JSON صالح / Invalid file type. Only .json files are accepted.' },
        { status: 400 }
      );
    }

    // Validate file size (max 50MB)
    const MAX_SIZE = 50 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      return NextResponse.json(
        { error: 'حجم الملف كبير جداً (الحد الأقصى 50 ميجابايت) / File too large' },
        { status: 400 }
      );
    }

    // Parse the JSON backup
    let backup: any;
    try {
      const text = await file.text();
      backup = JSON.parse(text);
    } catch {
      return NextResponse.json(
        { error: 'الملف المرفوع ليس ملف JSON صالح / Invalid JSON file' },
        { status: 400 }
      );
    }

    // Validate backup structure
    if (!backup.data) {
      return NextResponse.json(
        { error: 'هيكل النسخة الاحتياطية غير صالح / Invalid backup structure' },
        { status: 400 }
      );
    }

    const data = backup.data;

    // Restore data in a transaction, respecting foreign key order
    await db.$transaction(async (tx) => {
      // 1. Clear existing data (children first)
      await tx.pOSInvoiceItemProduct.deleteMany();
      await tx.pOSInvoicePayment.deleteMany();
      await tx.pOSInvoiceItem.deleteMany();
      await tx.stockTransaction.deleteMany();
      await tx.journalLine.deleteMany();

      // Clear self-referencing FKs
      await tx.$executeRaw`UPDATE "POSInvoice" SET "originalInvoiceId" = NULL WHERE "originalInvoiceId" IS NOT NULL`;
      await tx.$executeRaw`UPDATE "POSInvoice" SET "transactionId" = NULL WHERE "transactionId" IS NOT NULL`;
      await tx.pOSInvoice.deleteMany();

      await tx.journalEntry.deleteMany();
      await tx.transaction.deleteMany();
      await tx.stockTakeItem.deleteMany();
      await tx.stockTake.deleteMany();
      await tx.stockTransferItem.deleteMany();
      await tx.stockTransfer.deleteMany();
      await tx.shift.deleteMany();
      await tx.auditLog.deleteMany();
      await tx.userPermission.deleteMany();
      await tx.user.deleteMany();

      // Clear self-referencing FK on Account
      await tx.$executeRaw`UPDATE "Account" SET "parentId" = NULL WHERE "parentId" IS NOT NULL`;
      await tx.account.deleteMany();
      await tx.product.deleteMany();
      await tx.productCategory.deleteMany();
      await tx.restaurantTable.deleteMany();
      await tx.customer.deleteMany();
      await tx.supplier.deleteMany();
      await tx.fiscalPeriod.deleteMany();
      await tx.branch.deleteMany();
      await tx.setting.deleteMany();

      // 2. Restore data (parents first)
      if (data.branches?.length) await tx.branch.createMany({ data: data.branches, skipDuplicates: true });
      if (data.settings?.length) await tx.setting.createMany({ data: data.settings, skipDuplicates: true });
      if (data.fiscalPeriods?.length) await tx.fiscalPeriod.createMany({ data: data.fiscalPeriods, skipDuplicates: true });
      if (data.accounts?.length) await tx.account.createMany({ data: data.accounts.map((a: any) => ({ ...a, parentId: null })), skipDuplicates: true });
      if (data.customers?.length) await tx.customer.createMany({ data: data.customers, skipDuplicates: true });
      if (data.suppliers?.length) await tx.supplier.createMany({ data: data.suppliers, skipDuplicates: true });
      if (data.productCategories?.length) await tx.productCategory.createMany({ data: data.productCategories, skipDuplicates: true });
      if (data.products?.length) await tx.product.createMany({ data: data.products, skipDuplicates: true });
      if (data.restaurantTables?.length) await tx.restaurantTable.createMany({ data: data.restaurantTables, skipDuplicates: true });

      // Restore users (without passwords that might be incompatible)
      if (data.users?.length) {
        for (const user of data.users) {
          const { permissions, ...userData } = user;
          await tx.user.create({ data: userData });
          if (permissions?.length) {
            await tx.userPermission.createMany({ data: permissions, skipDuplicates: true });
          }
        }
      }

      if (data.transactions?.length) await tx.transaction.createMany({ data: data.transactions, skipDuplicates: true });

      // Restore journal entries with lines
      if (data.journalEntries?.length) {
        for (const je of data.journalEntries) {
          const { lines, ...jeData } = je;
          await tx.journalEntry.create({ data: jeData });
          if (lines?.length) {
            await tx.journalLine.createMany({ data: lines, skipDuplicates: true });
          }
        }
      }

      if (data.shifts?.length) await tx.shift.createMany({ data: data.shifts, skipDuplicates: true });

      // Restore POS invoices with items and payments
      if (data.posInvoices?.length) {
        for (const inv of data.posInvoices) {
          const { items, payments, ...invData } = inv;
          await tx.pOSInvoice.create({ data: { ...invData, originalInvoiceId: null, transactionId: null } });
          if (items?.length) {
            await tx.pOSInvoiceItem.createMany({ data: items, skipDuplicates: true });
          }
          if (payments?.length) {
            await tx.pOSInvoicePayment.createMany({ data: payments, skipDuplicates: true });
          }
        }
      }

      if (data.posInvoiceItemProducts?.length) await tx.pOSInvoiceItemProduct.createMany({ data: data.posInvoiceItemProducts, skipDuplicates: true });
      if (data.stockTransactions?.length) await tx.stockTransaction.createMany({ data: data.stockTransactions, skipDuplicates: true });

      if (data.stockTakes?.length) {
        for (const st of data.stockTakes) {
          const { items, ...stData } = st;
          await tx.stockTake.create({ data: stData });
          if (items?.length) {
            await tx.stockTakeItem.createMany({ data: items, skipDuplicates: true });
          }
        }
      }

      if (data.stockTransfers?.length) {
        for (const st of data.stockTransfers) {
          const { items, ...stData } = st;
          await tx.stockTransfer.create({ data: stData });
          if (items?.length) {
            await tx.stockTransferItem.createMany({ data: items, skipDuplicates: true });
          }
        }
      }

      if (data.auditLogs?.length) await tx.auditLog.createMany({ data: data.auditLogs, skipDuplicates: true });

      // Restore account hierarchy (update parentIds)
      if (data.accounts?.length) {
        for (const account of data.accounts) {
          if (account.parentId) {
            await tx.account.update({
              where: { id: account.id },
              data: { parentId: account.parentId },
            }).catch(() => {});
          }
        }
      }

      // Restore POS invoice references
      if (data.posInvoices?.length) {
        for (const inv of data.posInvoices) {
          const updates: any = {};
          if (inv.originalInvoiceId) updates.originalInvoiceId = inv.originalInvoiceId;
          if (inv.transactionId) updates.transactionId = inv.transactionId;
          if (Object.keys(updates).length > 0) {
            await tx.pOSInvoice.update({
              where: { id: inv.id },
              data: updates,
            }).catch(() => {});
          }
        }
      }
    }, { timeout: 60000 });

    // Audit log the import
    if (auth.authenticated) {
      auditBackup('IMPORT', `استعادة من نسخة احتياطية JSON: ${file.name}`, auth.userId, auth.email).catch(() => {});
    }

    return NextResponse.json({
      success: true,
      message: 'تم استعادة قاعدة البيانات بنجاح / Database restored successfully',
    });
  } catch (error: any) {
    console.error('Error importing database:', error);
    return NextResponse.json(
      { error: 'فشل في استعادة قاعدة البيانات. يرجى المحاولة لاحقاً.' },
      { status: 500 }
    );
  }
}
