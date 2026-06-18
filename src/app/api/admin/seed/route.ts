import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import bcrypt from 'bcryptjs';

/**
 * Admin Seed Endpoint — SECURED WITH CRYPTOGRAPHIC TOKEN
 *
 * SECURITY: This endpoint only creates an admin when NO admin exists.
 * ALWAYS requires the ADMIN_SEED_TOKEN environment variable regardless of environment.
 * If ADMIN_SEED_TOKEN is not configured, returns 503 Service Unavailable.
 *
 * The default credentials come from environment variables:
 * - DEFAULT_ADMIN_EMAIL (defaults to 'admin@example.com')
 * - DEFAULT_ADMIN_PASSWORD (defaults to a random string in production)
 */
export async function POST(request: NextRequest) {
  try {
    const serverSeedToken = process.env.ADMIN_SEED_TOKEN;

    // SECURITY: ALWAYS require cryptographic token regardless of environment
    if (!serverSeedToken) {
      return NextResponse.json(
        { error: 'Admin seeding is not available — ADMIN_SEED_TOKEN not configured' },
        { status: 503 }
      );
    }

    let clientSeedToken: string | null = null;
    try {
      const body = await request.json();
      clientSeedToken = body?.seedToken || null;
    } catch {
      // No body or invalid JSON
    }

    if (!clientSeedToken) {
      return NextResponse.json(
        { error: 'Admin seeding requires authentication token' },
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

    // Check if any admin exists
    const existingAdmin = await db.user.findFirst({
      where: { role: 'ADMIN', isActive: true },
    });

    if (existingAdmin) {
      return NextResponse.json({ exists: true, message: 'Admin already exists' });
    }

    // Use environment variables for credentials (never hardcode)
    const defaultEmail = process.env.DEFAULT_ADMIN_EMAIL || 'admin@example.com';
    const defaultPassword = process.env.DEFAULT_ADMIN_PASSWORD;
    if (!defaultPassword) {
      return NextResponse.json(
        { error: 'DEFAULT_ADMIN_PASSWORD environment variable is required for initial setup' },
        { status: 500 }
      );
    }

    const hashedPassword = await bcrypt.hash(defaultPassword, 12);

    const admin = await db.user.create({
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
      include: { permissions: true },
    });

    return NextResponse.json({ created: true, adminId: admin.id });
  } catch (error: any) {
    // Handle race condition: another process may have created admin
    if (error.code === 'P2002') {
      return NextResponse.json({ exists: true, message: 'Admin created by another process' });
    }
    console.error('[admin/seed] Error:', error);
    return NextResponse.json({ error: 'فشل في إنشاء المدير' }, { status: 500 });
  }
}
