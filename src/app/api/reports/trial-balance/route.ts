import { NextRequest, NextResponse } from 'next/server';
import { getTrialBalance } from '@/lib/accounting-engine';
import { requireAuth, checkReadAccess } from '@/lib/api-auth';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(); if (!auth.authenticated) return auth.response;
    const readCheck = checkReadAccess(auth, 'trial-balance'); if (!readCheck.authenticated) return readCheck.response;
    const { searchParams } = new URL(request.url);
    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');

    const data = await getTrialBalance(
      dateFrom ? new Date(dateFrom) : undefined,
      dateTo ? new Date(dateTo) : undefined
    );

    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json({ error: 'فشل في جلب ميزان المراجعة' }, { status: 500 });
  }
}
