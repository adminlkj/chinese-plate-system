import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/api-auth';
import { normalizeAllowedBranches } from '@/lib/branch-resolver';

/**
 * Verify endpoint: checks if a user ID is still valid and active.
 * Called on page load to verify the persisted session.
 *
 * SECURITY: Requires authentication. Users can only verify their own session,
 * unless they are an ADMIN (who can verify any user).
 */
export async function POST(request: NextRequest) {
  try {
    // Require authentication first
    const auth = await requireAuth(request);
    if (!auth.authenticated) {
      return NextResponse.json(
        { success: false, valid: false },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { userId } = body;

    if (!userId) {
      return NextResponse.json(
        { success: false, valid: false },
        { status: 401 }
      );
    }

    // Non-admin users can only verify their own session
    if (auth.role !== 'ADMIN' && auth.userId !== userId) {
      return NextResponse.json(
        { success: false, valid: false },
        { status: 403 }
      );
    }

    const user = await db.user.findUnique({
      where: { id: userId },
      include: { permissions: true },
    });

    if (!user || !user.isActive) {
      return NextResponse.json(
        { success: false, valid: false },
        { status: 401 }
      );
    }

    // Return fresh user data (never include password)
    // Normalize allowedBranches to UUIDs (handles legacy branch codes from pre-migration users)
    const normalizedBranches = await normalizeAllowedBranches(user.allowedBranches);
    return NextResponse.json({
      success: true,
      valid: true,
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
    console.error('[auth/verify] Error:', error);
    return NextResponse.json(
      { success: false, valid: false },
      { status: 500 }
    );
  }
}
