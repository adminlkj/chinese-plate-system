import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { toNumber } from '@/lib/decimal';
import { requireRole, checkWriteAccess } from '@/lib/api-auth';

// POST /api/data/migrate-transactions
// Creates Transaction header records for existing JournalEntries that don't have one.
// This is a one-time migration to backfill the Transaction table.
export async function POST() {
  try {
    const auth = await requireRole('ADMIN'); if (!auth.authenticated) return auth.response;
    const writeCheck = checkWriteAccess(auth, 'settings'); if (!writeCheck.authenticated) return writeCheck.response;
    // Find all journal entries without a transactionId
    const orphanEntries = await db.journalEntry.findMany({
      where: { transactionId: null },
      include: { lines: true, customer: true, supplier: true },
      orderBy: { date: 'asc' },
    });

    if (orphanEntries.length === 0) {
      return NextResponse.json({ 
        message: 'لا توجد قيود تحتاج ترحيل - جميع القيود مرتبطة بعمليات بالفعل',
        migrated: 0 
      });
    }

    let migrated = 0;
    const errors: string[] = [];

    for (const entry of orphanEntries) {
      try {
        const { type, subType } = mapEntryTypeToTransactionType(entry.type);
        const groupRole = ['COLLECTION', 'PAYMENT'].includes(type) ? 'SETTLEMENT' : 'PRIMARY';

        const lastTxn = await db.transaction.findFirst({
          orderBy: { transactionNumber: 'desc' },
          select: { transactionNumber: true },
        });
        const num = lastTxn ? parseInt(lastTxn.transactionNumber.replace('TXN-', '')) + 1 : 1;
        const transactionNumber = `TXN-${String(num).padStart(4, '0')}`;

        const netAmount = toNumber(entry.amount) + toNumber(entry.taxAmount) - toNumber(entry.discountAmount);

        const transaction = await db.transaction.create({
          data: {
            transactionNumber,
            type,
            subType,
            date: entry.date,
            description: entry.description,
            referenceCode: entry.reference,
            branchId: entry.branchId,
            customerId: entry.customerId,
            supplierId: entry.supplierId,
            totalAmount: toNumber(entry.amount),
            taxAmount: toNumber(entry.taxAmount),
            discountAmount: toNumber(entry.discountAmount),
            netAmount,
            status: entry.status === 'POSTED' ? 'POSTED' : entry.status === 'DRAFT' ? 'DRAFT' : 'CANCELLED',
            paymentMethod: entry.paymentMethod,
            counterParty: entry.counterParty,
            invoiceNumber: entry.invoiceNumber,
          },
        });

        await db.journalEntry.update({
          where: { id: entry.id },
          data: {
            transactionId: transaction.id,
            groupId: transaction.transactionNumber,
            groupRole,
          },
        });

        migrated++;
      } catch (err: any) {
        errors.push(`JE ${entry.entryNumber}: ${err.message}`);
      }
    }

    return NextResponse.json({ 
      message: `تم ترحيل ${migrated} من ${orphanEntries.length} قيد`,
      migrated,
      total: orphanEntries.length,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error: any) {
    console.error('Migration error:', error);
    return NextResponse.json({ error: 'فشل في ترحيل البيانات' }, { status: 500 });
  }
}

function mapEntryTypeToTransactionType(entryType: string): { type: string; subType: string | null } {
  switch (entryType) {
    case 'SALE_CASH': return { type: 'SALE', subType: 'CASH' };
    case 'SALE_BANK': return { type: 'SALE', subType: 'BANK' };
    case 'SALE_PLATFORM': return { type: 'SALE', subType: 'PLATFORM' };
    case 'EXPENSE_CASH': return { type: 'EXPENSE', subType: 'CASH' };
    case 'EXPENSE_BANK': return { type: 'EXPENSE', subType: 'BANK' };
    case 'EXPENSE_SADAD': return { type: 'EXPENSE', subType: 'SADAD' };
    case 'PURCHASE_CASH': return { type: 'PURCHASE', subType: 'CASH' };
    case 'PURCHASE_BANK': return { type: 'PURCHASE', subType: 'BANK' };
    case 'PURCHASE_CREDIT': return { type: 'PURCHASE', subType: 'CREDIT' };
    case 'COLLECTION': return { type: 'COLLECTION', subType: null };
    case 'PAYMENT': return { type: 'PAYMENT', subType: null };
    case 'DEPOSIT': return { type: 'DEPOSIT', subType: null };
    case 'WITHDRAWAL': return { type: 'WITHDRAWAL', subType: null };
    case 'TRANSFER': return { type: 'TRANSFER', subType: null };
    case 'MANUAL': return { type: 'MANUAL', subType: null };
    case 'OPENING_BALANCE': return { type: 'OPENING_BALANCE', subType: null };
    default: return { type: 'MANUAL', subType: null };
  }
}
