import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { normalizeAllowedBranches } from '@/lib/branch-resolver';

/**
 * Check current authentication status from the session cookie.
 * Returns user data if authenticated, or 401 if not.
 * Used by AuthGate to restore session from cookie on page reload.
 */
export async function GET() {
  try {
    const auth = await requireAuth();

    if (!auth.authenticated) {
      return NextResponse.json(
        { authenticated: false },
        { status: 401 }
      );
    }

    // Fetch fresh user data from DB to ensure it's still active
    const { db } = await import('@/lib/db');
    const user = await db.user.findUnique({
      where: { id: auth.userId },
      include: { permissions: true },
    });

    if (!user || !user.isActive) {
      return NextResponse.json(
        { authenticated: false },
        { status: 401 }
      );
    }

    // Normalize allowedBranches to UUIDs (handles legacy branch codes from pre-migration users)
    const normalizedBranches = await normalizeAllowedBranches(user.allowedBranches);
    return NextResponse.json({
      authenticated: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        nameEn: user.nameEn,
        role: user.role,
        permissions: user.permissions.map((p) => ({
          screen: p.screen,
          accessLevel: p.accessLevel,
        })),
        allowedBranches: normalizedBranches,
      },
    });
  } catch (error) {
    console.error('[auth/me] Error:', error);
    return NextResponse.json(
      { authenticated: false },
      { status: 401 }
    );
  }
}
