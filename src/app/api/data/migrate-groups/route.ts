import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { toNumber } from '@/lib/decimal';
import { requireRole, checkWriteAccess } from '@/lib/api-auth';

// POST /api/data/migrate-groups - Backfill groupId and totalAmount for existing journal entries
// This is a one-time migration to add the new fields to existing data
export async function POST() {
  try {
    const auth = await requireRole('ADMIN'); if (!auth.authenticated) return auth.response;
    const writeCheck = checkWriteAccess(auth, 'settings'); if (!writeCheck.authenticated) return writeCheck.response;
    const result = await db.$transaction(async (tx) => {
      // Get all entries that don't have a groupId yet
      const entries = await tx.journalEntry.findMany({
        where: { groupId: null },
        orderBy: { date: 'asc' },
      });

      let migratedCount = 0;

      for (const entry of entries) {
        // Calculate totalAmount (base + tax - discount)
        const totalAmount = toNumber(entry.amount) + toNumber(entry.taxAmount) - toNumber(entry.discountAmount);

        // Generate a groupId for each existing entry
        let groupRole: string;

        if (['COLLECTION', 'PAYMENT'].includes(entry.type)) {
          groupRole = 'SETTLEMENT';
        } else {
          groupRole = 'PRIMARY';
        }

        const groupId = `TXN-MIG-${String(migratedCount + 1).padStart(4, '0')}`;

        await tx.journalEntry.update({
          where: { id: entry.id },
          data: { groupId, groupRole, totalAmount },
        });

        migratedCount++;
      }

      return { migratedCount };
    });

    return NextResponse.json({
      success: true,
      message: `تم ترحيل ${result.migratedCount} قيد بنجاح`,
      migratedCount: result.migratedCount,
    });
  } catch (error: any) {
    console.error('[POST /api/data/migrate-groups]', error);
    return NextResponse.json({ error: 'فشل في ترحيل البيانات' }, { status: 500 });
  }
}
