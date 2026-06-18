import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';

/**
 * Check current authentication status.
 * Supports both Authorization header and cookie-based auth.
 */
export async function GET() {
  try {
    const auth = await requireAuth();

    if (!auth.authenticated) {
      return NextResponse.json({ authenticated: false }, { status: 401 });
    }

    return NextResponse.json({
      authenticated: true,
      user: {
        id: auth.userId,
        email: auth.email,
        role: auth.role,
        permissions: auth.permissions,
      },
    });
  } catch (error) {
    console.error('[session-check] Error:', error);
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }
}
