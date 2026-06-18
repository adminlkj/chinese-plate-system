import { NextResponse } from 'next/server';
import { getDashboardData } from '@/lib/accounting-engine';
import { requireAuth, checkReadAccess } from '@/lib/api-auth';

export async function GET() {
  try {
    const auth = await requireAuth(); if (!auth.authenticated) return auth.response;
    const readCheck = checkReadAccess(auth, 'dashboard'); if (!readCheck.authenticated) return readCheck.response;
    const data = await getDashboardData();
    return NextResponse.json(data);
  } catch (error: any) {
    console.error('[GET /api/dashboard]', error);
    return NextResponse.json({ error: 'فشل في جلب بيانات لوحة التحكم' }, { status: 500 });
  }
}
