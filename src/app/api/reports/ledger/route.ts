import { NextRequest, NextResponse } from 'next/server';
import { getLedger } from '@/lib/accounting-engine';
import { requireAuth, checkReadAccess } from '@/lib/api-auth';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(); if (!auth.authenticated) return auth.response;
    const readCheck = checkReadAccess(auth, 'ledger'); if (!readCheck.authenticated) return readCheck.response;
    const { searchParams } = new URL(request.url);
    const accountId = searchParams.get('accountId');
    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');

    if (!accountId) {
      return NextResponse.json({ error: 'يرجى تحديد الحساب' }, { status: 400 });
    }

    const data = await getLedger(
      accountId,
      dateFrom ? new Date(dateFrom) : undefined,
      dateTo ? new Date(dateTo) : undefined
    );

    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json({ error: 'فشل في جلب دفتر الأستاذ' }, { status: 500 });
  }
}
