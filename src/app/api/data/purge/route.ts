import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireRole, checkWriteAccess } from '@/lib/api-auth';

// POST /api/data/purge - Delete ALL data from all tables (except Settings)
export async function POST() {
  try {
    const auth = await requireRole('ADMIN'); if (!auth.authenticated) return auth.response;
    const writeCheck = checkWriteAccess(auth, 'settings'); if (!writeCheck.authenticated) return writeCheck.response;
    await db.$transaction(async (tx) => {
      // === Level 1: Leaf nodes ===
      await tx.pOSInvoiceItemProduct.deleteMany();
      await tx.pOSInvoicePayment.deleteMany();
      await tx.pOSInvoiceItem.deleteMany();
      await tx.stockTransaction.deleteMany();
      await tx.journalLine.deleteMany();

      // === Level 2: Mid-level entities ===
      await tx.journalEntry.deleteMany();

      // Clear self-referencing FK on POSInvoice
      await tx.$executeRaw`UPDATE "POSInvoice" SET "originalInvoiceId" = NULL WHERE "originalInvoiceId" IS NOT NULL`;
      await tx.$executeRaw`UPDATE "POSInvoice" SET "transactionId" = NULL WHERE "transactionId" IS NOT NULL`;
      await tx.pOSInvoice.deleteMany();

      await tx.transaction.deleteMany();

      // === Level 3: Top-level entities ===
      await tx.fiscalPeriod.deleteMany();
      await tx.stockTakeItem.deleteMany();
      await tx.stockTake.deleteMany();
      await tx.stockTransferItem.deleteMany();
      await tx.stockTransfer.deleteMany();
      await tx.product.deleteMany();
      await tx.productCategory.deleteMany();
      await tx.restaurantTable.deleteMany();
      await tx.customer.deleteMany();
      await tx.supplier.deleteMany();
      await tx.shift.deleteMany();

      // Clear self-referencing FK on Account
      await tx.$executeRaw`UPDATE "Account" SET "parentId" = NULL WHERE "parentId" IS NOT NULL`;
      await tx.account.deleteMany();

      await tx.branch.deleteMany();
      await tx.auditLog.deleteMany();

      // === Keep Settings ===
    }, { timeout: 30000 });

    return NextResponse.json({ success: true, message: 'تم حذف جميع البيانات بنجاح' });
  } catch (error: any) {
    console.error('[PURGE] Error:', error);
    return NextResponse.json({ error: 'فشل في حذف البيانات' }, { status: 500 });
  }
}
