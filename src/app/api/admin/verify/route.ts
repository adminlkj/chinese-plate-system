import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/api-auth';
import { normalizeAllowedBranches } from '@/lib/branch-resolver';

/**
 * Verify endpoint: checks if a user ID is still valid and active.
 * Called on page load to verify the persisted session.
 * SECURITY: Requires authentication — users can only verify their own session.
 */
export async function POST(request: NextRequest) {
  try {
    // SECURITY FIX: Require authentication before allowing verification
    const auth = await requireAuth();
    if (!auth.authenticated) return auth.response;

    const body = await request.json();
    const { userId } = body;

    if (!userId) {
      return NextResponse.json(
        { success: false, valid: false },
        { status: 401 }
      );
    }

    // SECURITY: Only allow users to verify their own ID, unless they're admin
    if (auth.userId !== userId && auth.role !== 'ADMIN') {
      return NextResponse.json(
        { success: false, valid: false, error: 'غير مصرح' },
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

    // Return fresh user data (exclude password hash)
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
        allowedBranches: normalizedBranches,
        permissions: user.permissions.map((p) => ({
          screen: p.screen,
          accessLevel: p.accessLevel,
        })),
      },
    });
  } catch (error) {
    console.error('[admin/verify] Error:', error);
    return NextResponse.json(
      { success: false, valid: false },
      { status: 500 }
    );
  }
}
