import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

/**
 * System Status — PUBLIC endpoint for setup detection
 *
 * SECURITY: Only returns minimal information needed for the client
 * to determine if the system needs initial setup.
 * No sensitive data (user count, admin status) is exposed.
 */
export async function GET() {
  try {
    let needsSetup = false;

    try {
      await db.$connect();
      const hasAdmin = (await db.user.findFirst({ where: { role: 'ADMIN', isActive: true } })) !== null;
      needsSetup = !hasAdmin;
    } catch (dbError: unknown) {
      const message = dbError instanceof Error ? dbError.message : 'Unknown error';
      console.error('[system/status] Database connection failed:', message);
      return NextResponse.json({ needsSetup: false, databaseConnected: false }, { status: 503 });
    }

    return NextResponse.json({
      needsSetup,
      databaseConnected: true,
    });
  } catch (error: unknown) {
    console.error('[system/status] Error:', error);
    return NextResponse.json({
      needsSetup: false,
      databaseConnected: false,
    }, { status: 500 });
  }
}
