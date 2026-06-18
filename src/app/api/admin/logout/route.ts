import { NextResponse } from 'next/server';

const isProduction = process.env.NODE_ENV === 'production';

// Clear ALL possible session cookie variants (dev + prod names)
const COOKIE_NAMES = isProduction
  ? ['__Secure-next-auth.session-token', '__Secure-next-auth.callback-url', '__Secure-next-auth.csrf-token']
  : ['next-auth.session-token', 'next-auth.callback-url', 'next-auth.csrf-token'];

/**
 * Logout endpoint: clears ALL session cookies (both dev and prod names)
 */
export async function POST() {
  try {
    const response = NextResponse.json({ success: true });

    // Clear every possible cookie name to handle environment transitions
    for (const name of COOKIE_NAMES) {
      response.cookies.set({
        name,
        value: '',
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: isProduction,
        maxAge: 0,
      });
    }

    return response;
  } catch (error) {
    console.error('[admin/logout] Error:', error);
    const response = NextResponse.json({ success: true });
    for (const name of COOKIE_NAMES) {
      response.cookies.set({
        name,
        value: '',
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: isProduction,
        maxAge: 0,
      });
    }
    return response;
  }
}
