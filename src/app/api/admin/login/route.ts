import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { encode } from 'next-auth/jwt';
import { db } from '@/lib/db';
import { auditLogin } from '@/lib/audit-log';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { normalizeAllowedBranches } from '@/lib/branch-resolver';

const SESSION_COOKIE_NAME = process.env.NODE_ENV === 'production'
  ? '__Secure-next-auth.session-token'
  : 'next-auth.session-token';

export async function POST(request: NextRequest) {
  try {
    // Rate limit: max 10 login attempts per minute per IP
    const ip = getClientIp(request);
    const rateLimit = checkRateLimit(`login:${ip}`, 10, 60_000);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { success: false, error: `تم تجاوز الحد الأقصى لمحاولات الدخول. حاول مرة أخرى بعد ${Math.ceil(rateLimit.retryAfterMs / 1000)} ثانية` },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(rateLimit.retryAfterMs / 1000)) } }
      );
    }

    const body = await request.json();
    const { email, password } = body;

    if (!email || !password) {
      return NextResponse.json(
        { success: false, error: 'البريد الإلكتروني وكلمة المرور مطلوبان' },
        { status: 400 }
      );
    }

    // Find user
    const user = await db.user.findUnique({
      where: { email },
      include: { permissions: true },
    });

    if (!user) {
      return NextResponse.json(
        { success: false, error: 'بيانات الدخول غير صحيحة' },
        { status: 401 }
      );
    }

    if (!user.isActive) {
      return NextResponse.json(
        { success: false, error: 'الحساب معطل' },
        { status: 401 }
      );
    }

    // Verify password
    const isValid = await bcrypt.compare(password, user.password);

    if (!isValid) {
      return NextResponse.json(
        { success: false, error: 'بيانات الدخول غير صحيحة' },
        { status: 401 }
      );
    }

    // Create a NextAuth-compatible JWT token
    const secret = process.env.NEXTAUTH_SECRET;
    if (!secret) {
      console.error('[admin/login] NEXTAUTH_SECRET is not configured');
      return NextResponse.json(
        { success: false, error: 'حدث خطأ في الخادم' },
        { status: 500 }
      );
    }

    // Normalize allowedBranches to canonical UUIDs at login time so that
    // assertBranchAccess can do a simple UUID-to-UUID comparison in the hot
    // path without any DB lookup. Legacy stored values may be branch codes
    // (e.g. "CHINA_TOWN") — we resolve them to UUIDs here.
    const normalizedBranches = await normalizeAllowedBranches(user.allowedBranches);
    const normalizedBranchesJson = JSON.stringify(normalizedBranches);

    const token = await encode({
      token: {
        id: user.id,
        email: user.email,
        name: user.name,
        nameEn: user.nameEn ?? undefined,
        role: user.role,
        allowedBranches: normalizedBranchesJson, // JSON string of UUIDs — parsed by api-auth
        permissions: user.permissions.map((p) => ({
          screen: p.screen,
          accessLevel: p.accessLevel,
        })),
      },
      secret,
      maxAge: 24 * 60 * 60, // 24 hours - matches auth.ts session.maxAge
    });

    // Build response with user data AND the raw token
    // The token is stored in localStorage and sent via Authorization header
    const userData = {
      id: user.id,
      email: user.email,
      name: user.name,
      nameEn: user.nameEn,
      role: user.role,
      allowedBranches: normalizedBranches, // array of UUIDs
      permissions: user.permissions.map((p) => ({
        screen: p.screen,
        accessLevel: p.accessLevel,
      })),
    };

    // Audit log the login event (non-blocking)
    auditLogin(user.id, user.name, user.role).catch(() => {});

    const response = NextResponse.json({
      success: true,
      user: userData,
      token, // Client stores this in localStorage for Authorization header
    });

    // Also set the session cookie as a fallback
    // (works for same-origin requests where cookies aren't blocked)
    response.cookies.set({
      name: SESSION_COOKIE_NAME,
      value: token,
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 24 * 60 * 60, // 24 hours
    });

    return response;
  } catch (error: any) {
    console.error('[admin/login] Error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ في تسجيل الدخول' },
      { status: 500 }
    );
  }
}
