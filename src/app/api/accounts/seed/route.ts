import { NextResponse } from 'next/server';
import { seedDefaultAccounts } from '@/lib/seed-data';
import { db } from '@/lib/db';
import { requireRole } from '@/lib/api-auth';

// POST /api/accounts/seed - Seed default chart of accounts
// Also ensures Tax Payable (2600) is a regular account (not computed)
// Also seeds Branch table if empty
export async function POST() {
  try {
    const auth = await requireRole('ADMIN'); if (!auth.authenticated) return auth.response;
    const result = await seedDefaultAccounts();

    // Ensure account 2600 is a regular account (NOT computed)
    // Previously it was isComputed=true with computedSource='VAT_NET'
    // Now it receives actual journal lines during VAT settlement
    const account2600 = await db.account.findFirst({ where: { code: '2600' } });
    if (account2600) {
      const updateData: any = {
        name: 'ضريبة مستحقة',
        nameEn: 'Tax Payable',
      };
      // Remove computed flags if they exist
      if (account2600.isComputed || account2600.computedSource) {
        updateData.isComputed = false;
        updateData.computedSource = null;
      }
      // Update if name changed or computed flags need clearing
      if (account2600.name !== 'ضريبة مستحقة' ||
          account2600.nameEn !== 'Tax Payable' ||
          account2600.isComputed ||
          account2600.computedSource) {
        await db.account.update({
          where: { id: account2600.id },
          data: updateData,
        });
      }
    }

    // Seed branches if not already seeded
    const existingBranches = await db.branch.count();
    if (existingBranches === 0) {
      await db.branch.createMany({
        data: [
          { code: 'CHINA_TOWN', name: 'تشاينا تاون', nameEn: 'China Town', sortOrder: 1 },
          { code: 'PALACE_INDIA', name: 'بالاس إنديا', nameEn: 'Palace India', sortOrder: 2 },
        ],
      });
    }

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('[POST /api/accounts/seed]', error);
    return NextResponse.json({ error: 'فشل في إنشاء الحسابات الافتراضية' }, { status: 500 });
  }
}
