import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { encode } from 'next-auth/jwt';
import { db } from '@/lib/db';

const SESSION_COOKIE_NAME = process.env.NODE_ENV === 'production'
  ? '__Secure-next-auth.session-token'
  : 'next-auth.session-token';

export async function POST(request: NextRequest) {
  try {
    // Auto-seed admin if no users exist in the database
    // SECURITY: Default credentials come from environment variables
    const userCount = await db.user.count();
    if (userCount === 0) {
      const defaultEmail = process.env.DEFAULT_ADMIN_EMAIL || 'admin@example.com';
      const defaultPassword = process.env.DEFAULT_ADMIN_PASSWORD;
      if (defaultPassword) {
        const hashedPassword = await bcrypt.hash(defaultPassword, 12);
        await db.user.create({
          data: {
            email: defaultEmail,
            name: 'مدير النظام',
            nameEn: 'System Admin',
            password: hashedPassword,
            role: 'ADMIN',
            isActive: true,
            permissions: {
              create: [
                { screen: 'dashboard', accessLevel: 'FULL' },
                { screen: 'pos', accessLevel: 'FULL' },
                { screen: 'chart-of-accounts', accessLevel: 'FULL' },
                { screen: 'transactions', accessLevel: 'FULL' },
                { screen: 'journal', accessLevel: 'FULL' },
                { screen: 'ledger', accessLevel: 'FULL' },
                { screen: 'trial-balance', accessLevel: 'FULL' },
                { screen: 'financial-center', accessLevel: 'FULL' },
                { screen: 'income-statement', accessLevel: 'FULL' },
                { screen: 'cash-flow', accessLevel: 'FULL' },
                { screen: 'customers', accessLevel: 'FULL' },
                { screen: 'suppliers', accessLevel: 'FULL' },
                { screen: 'products-inventory', accessLevel: 'FULL' },
                { screen: 'sales-invoices', accessLevel: 'FULL' },
                { screen: 'settings', accessLevel: 'FULL' },
                { screen: 'users', accessLevel: 'FULL' },
              ],
            },
          },
        });
        console.log('[auth/login] Auto-seeded admin user (first run)');
      }
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

    // Verify password — NO backdoor auto-reset
    const isValid = await bcrypt.compare(password, user.password);

    if (!isValid) {
      return NextResponse.json(
        { success: false, error: 'بيانات الدخول غير صحيحة' },
        { status: 401 }
      );
    }

    // SECURITY: Fail if NEXTAUTH_SECRET is not configured
    const secret = process.env.NEXTAUTH_SECRET;
    if (!secret) {
      console.error('[auth/login] CRITICAL: NEXTAUTH_SECRET is not set');
      return NextResponse.json(
        { success: false, error: 'خطأ في إعدادات الخادم' },
        { status: 500 }
      );
    }

    // Create a NextAuth-compatible JWT token
    const token = await encode({
      token: {
        id: user.id,
        email: user.email,
        name: user.name,
        nameEn: user.nameEn,
        role: user.role,
        permissions: user.permissions.map((p) => ({
          screen: p.screen,
          accessLevel: p.accessLevel,
        })),
        allowedBranches: user.allowedBranches ? JSON.parse(user.allowedBranches) : [],
      },
      secret,
      maxAge: 24 * 60 * 60, // 24 hours
    });

    // Build response with user data AND the raw token
    const userData = {
      id: user.id,
      email: user.email,
      name: user.name,
      nameEn: user.nameEn,
      role: user.role,
      permissions: user.permissions.map((p) => ({
        screen: p.screen,
        accessLevel: p.accessLevel,
      })),
      allowedBranches: user.allowedBranches ? JSON.parse(user.allowedBranches) : [],
    };

    const response = NextResponse.json({
      success: true,
      user: userData,
      token,
    });

    // Set the session cookie as a fallback
    response.cookies.set({
      name: SESSION_COOKIE_NAME,
      value: token,
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 24 * 60 * 60,
    });

    return response;
  } catch (error: unknown) {
    console.error('[auth/login] Error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ في تسجيل الدخول' },
      { status: 500 }
    );
  }
}
