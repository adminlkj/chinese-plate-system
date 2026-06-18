import { db } from '@/lib/db';
import bcrypt from 'bcryptjs';
import { NextRequest, NextResponse } from 'next/server';
import { requireRole, checkWriteAccess, sanitizeInput } from '@/lib/api-auth';
import { normalizeAllowedBranches } from '@/lib/branch-resolver';
import { auditLog } from '@/lib/audit-log';

// Deprecated: use sanitizeInput from api-auth instead
function sanitize(str: string): string {
  return sanitizeInput(str);
}

// GET /api/users — List all users with permissions
export async function GET() {
  try {
    const auth = await requireRole('ADMIN'); if (!auth.authenticated) return auth.response;
    const users = await db.user.findMany({
      include: { permissions: true },
      orderBy: { createdAt: 'desc' },
    });

    // Remove password from response
    const safe = users.map(({ password, ...user }) => user);

    return NextResponse.json({ users: safe });
  } catch (error: any) {
    console.error('[GET /api/users]', error);
    return NextResponse.json({ error: 'فشل في تحميل المستخدمين' }, { status: 500 });
  }
}

// POST /api/users — Create new user
export async function POST(req: NextRequest) {
  try {
    const auth = await requireRole('ADMIN'); if (!auth.authenticated) return auth.response;
    const writeCheck = checkWriteAccess(auth, 'users'); if (!writeCheck.authenticated) return writeCheck.response;
    const body = await req.json();
    let { email, name, nameEn, password, role, isActive, permissions, allowedBranches } = body;

    // Sanitize string inputs to prevent stored XSS
    email = sanitize(email);
    name = sanitize(name);
    nameEn = nameEn ? sanitize(nameEn) : null;

    if (!email || !name || !password) {
      return NextResponse.json({ error: 'البريد الإلكتروني والاسم وكلمة المرور مطلوبة' }, { status: 400 });
    }

    if (password.length < 4) {
      return NextResponse.json({ error: 'كلمة المرور يجب أن تكون 4 أحرف على الأقل' }, { status: 400 });
    }

    // Check if email already exists
    const existing = await db.user.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json({ error: 'البريد الإلكتروني مستخدم بالفعل' }, { status: 409 });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    // Normalize allowedBranches to canonical UUIDs before saving so that
    // assertBranchAccess can compare UUID-to-UUID without DB lookups.
    // Accepts: JSON string, array of codes/UUIDs, or null.
    const normalizedBranches = await normalizeAllowedBranches(allowedBranches);
    const normalizedBranchesJson = normalizedBranches.length > 0
      ? JSON.stringify(normalizedBranches)
      : null;

    const user = await db.user.create({
      data: {
        email,
        name,
        nameEn: nameEn || null,
        password: hashedPassword,
        role: role || 'VIEWER',
        allowedBranches: normalizedBranchesJson, // JSON string of UUIDs, or null
        isActive: isActive !== false,
        permissions: {
          create: (permissions || []).map((p: { screen: string; accessLevel: string }) => ({
            screen: p.screen,
            accessLevel: p.accessLevel,
          })),
        },
      },
      include: { permissions: true },
    });

    const { password: _, ...safe } = user;
    // AUDIT-9-18 — user creation is CRITICAL (compliance + access control)
    auditLog({
      action: 'CREATE',
      entity: 'USER',
      entityId: user.id,
      entityNumber: user.email,
      description: `إنشاء مستخدم: ${user.email} (${user.name}) - الدور: ${user.role}`,
      userId: auth.userId,
      userName: auth.email,
      userRole: auth.role,
      severity: 'CRITICAL',
      category: 'USERS',
      details: {
        newUserEmail: user.email,
        newUserRole: user.role,
        permissionsCount: user.permissions?.length || 0,
        allowedBranches: normalizedBranches,
      },
    }).catch(() => {});
    return NextResponse.json({ user: safe }, { status: 201 });
  } catch (error: any) {
    console.error('[POST /api/users]', error);
    const msg = error?.message || '';
    const isConflict = error?.code === 'P2002' || /already exists|unique/i.test(msg);
    return NextResponse.json(
      { error: isConflict ? 'اسم المستخدم أو البريد موجود مسبقًا' : 'فشل في إنشاء المستخدم' },
      { status: isConflict ? 409 : 500 }
    );
  }
}
