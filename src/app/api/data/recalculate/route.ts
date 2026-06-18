import { NextResponse } from 'next/server';
import { recalculateAllBalances } from '@/lib/accounting-engine';
import { requireRole, checkWriteAccess } from '@/lib/api-auth';

// POST /api/data/recalculate - Recalculate all account balances
export async function POST() {
  try {
    const auth = await requireRole('ADMIN'); if (!auth.authenticated) return auth.response;
    const writeCheck = checkWriteAccess(auth, 'settings'); if (!writeCheck.authenticated) return writeCheck.response;
    await recalculateAllBalances();
    return NextResponse.json({ success: true, message: 'تم إعادة حساب الأرصدة بنجاح' });
  } catch (error: any) {
    console.error('[POST /api/data/recalculate]', error);
    return NextResponse.json({ error: 'فشل في إعادة حساب الأرصدة' }, { status: 500 });
  }
}
