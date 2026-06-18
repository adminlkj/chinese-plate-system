import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import bcrypt from 'bcryptjs';
import { encode } from 'next-auth/jwt';

/**
 * Auto-Login API — SECURED WITH CRYPTOGRAPHIC TOKEN
 *
 * SECURITY: Requires ADMIN_SEED_TOKEN in ALL environments (including development).
 * Only works when no admin exists (first-run only).
 *
 * Flow:
 * 1. A 64-byte random token is set via ADMIN_SEED_TOKEN env var
 * 2. Caller provides the token in the request body
 * 3. Server validates the token matches its own env var
 * 4. Only works when no admin exists (first-run only)
 * 5. After first admin is created, the API returns 403 for all subsequent calls
 */
export async function POST(request: NextRequest) {
  try {
    const serverSeedToken = process.env.ADMIN_SEED_TOKEN;

    // Require cryptographic token in ALL environments
    let clientSeedToken: string | null = null;
    try {
      const body = await request.json();
      clientSeedToken = body?.seedToken || null;
    } catch {
      // No body or invalid JSON
    }

    if (!serverSeedToken) {
      return NextResponse.json(
        { error: 'Auto-login is not available (ADMIN_SEED_TOKEN not configured)' },
        { status: 403 }
      );
    }

    if (!clientSeedToken) {
      return NextResponse.json(
        { error: 'Auto-login requires authentication token' },
        { status: 403 }
      );
    }

    // Constant-time comparison to prevent timing attacks
    const clientBuf = Buffer.from(clientSeedToken, 'utf-8');
    const serverBuf = Buffer.from(serverSeedToken, 'utf-8');
    if (clientBuf.length !== serverBuf.length ||
        !(await import('crypto')).timingSafeEqual(clientBuf, serverBuf)) {
      return NextResponse.json(
        { error: 'Invalid authentication token' },
        { status: 403 }
      );
    }

    // ─── Check if admin already exists ───
    let user = await db.user.findFirst({
      where: { role: 'ADMIN', isActive: true },
      include: { permissions: true },
    });

    const isFirstRun = !user;

    // Auto-create admin if none exists
    if (!user) {
      const defaultEmail = process.env.DEFAULT_ADMIN_EMAIL || 'admin@example.com';
      const defaultPassword = process.env.DEFAULT_ADMIN_PASSWORD;
      if (!defaultPassword) {
        return NextResponse.json(
          { error: 'DEFAULT_ADMIN_PASSWORD environment variable is required for initial setup' },
          { status: 500 }
        );
      }

      const hashedPassword = await bcrypt.hash(defaultPassword, 10);
      user = await db.user.create({
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
              { screen: 'chart-of-accounts', accessLevel: 'FULL' },
              { screen: 'transactions', accessLevel: 'FULL' },
              { screen: 'customers', accessLevel: 'FULL' },
              { screen: 'suppliers', accessLevel: 'FULL' },
              { screen: 'pos', accessLevel: 'FULL' },
              { screen: 'products-inventory', accessLevel: 'FULL' },
              { screen: 'sales-invoices', accessLevel: 'FULL' },
              { screen: 'journal', accessLevel: 'FULL' },
              { screen: 'ledger', accessLevel: 'FULL' },
              { screen: 'trial-balance', accessLevel: 'FULL' },
              { screen: 'financial-center', accessLevel: 'FULL' },
              { screen: 'income-statement', accessLevel: 'FULL' },
              { screen: 'cash-flow', accessLevel: 'FULL' },
              { screen: 'settings', accessLevel: 'FULL' },
              { screen: 'users', accessLevel: 'FULL' },
            ],
          },
        },
        include: { permissions: true },
      });
    }

    // Only auto-login if this was a first-run (admin just created)
    // After first run, user must use the login form
    if (!isFirstRun) {
      return NextResponse.json(
        { error: 'Auto-login only available on first run. Please use the login form.', isFirstRun: false },
        { status: 403 }
      );
    }

    // Generate a proper JWT token (not Base64)
    const secret = process.env.NEXTAUTH_SECRET;
    if (!secret) {
      return NextResponse.json(
        { error: 'Server configuration error' },
        { status: 500 }
      );
    }

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
      },
      secret,
      maxAge: 24 * 60 * 60,
    });

    return NextResponse.json({
      success: true,
      token,
      isFirstRun,
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
      },
    });
  } catch (error: unknown) {
    console.error('[auth/auto-login] Error:', error);
    return NextResponse.json({ error: 'فشل في تسجيل الدخول التلقائي' }, { status: 500 });
  }
}
