import { db } from '@/lib/db';
import bcrypt from 'bcryptjs';
import { NextRequest, NextResponse } from 'next/server';
import { requireRole, checkWriteAccess } from '@/lib/api-auth';
import { normalizeAllowedBranches } from '@/lib/branch-resolver';
import { auditLog } from '@/lib/audit-log';

// GET /api/users/[id] — Get single user with permissions
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireRole('ADMIN'); if (!auth.authenticated) return auth.response;
    const { id } = await params;
    const user = await db.user.findUnique({
      where: { id },
      include: { permissions: true },
    });

    if (!user) {
      return NextResponse.json({ error: 'المستخدم غير موجود' }, { status: 404 });
    }

    const { password, ...safe } = user;
    return NextResponse.json({ user: safe });
  } catch (error: any) {
    console.error('[GET /api/users/[id]]', error);
    return NextResponse.json({ error: 'فشل في تحميل بيانات المستخدم' }, { status: 500 });
  }
}

// PUT /api/users/[id] — Update user
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireRole('ADMIN'); if (!auth.authenticated) return auth.response;
    const writeCheck = checkWriteAccess(auth, 'users'); if (!writeCheck.authenticated) return writeCheck.response;
    const { id } = await params;
    const body = await req.json();
    const { email, name, nameEn, password, role, isActive, permissions, allowedBranches } = body;

    const existing = await db.user.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: 'المستخدم غير موجود' }, { status: 404 });
    }

    // Check email uniqueness if changed
    if (email && email !== existing.email) {
      const emailTaken = await db.user.findUnique({ where: { email } });
      if (emailTaken) {
        return NextResponse.json({ error: 'البريد الإلكتروني مستخدم بالفعل' }, { status: 409 });
      }
    }

    // Build update data
    const updateData: any = {};
    if (email !== undefined) updateData.email = email;
    if (name !== undefined) updateData.name = name;
    if (nameEn !== undefined) updateData.nameEn = nameEn || null;
    if (role !== undefined) updateData.role = role;
    if (isActive !== undefined) updateData.isActive = isActive;
    if (allowedBranches !== undefined) {
      // Normalize allowedBranches to canonical UUIDs before saving so that
      // assertBranchAccess can compare UUID-to-UUID without DB lookups.
      const normalizedBranches = await normalizeAllowedBranches(allowedBranches);
      updateData.allowedBranches = normalizedBranches.length > 0
        ? JSON.stringify(normalizedBranches)
        : null;
    }
    if (password) {
      if (password.length < 4) {
        return NextResponse.json({ error: 'كلمة المرور يجب أن تكون 4 أحرف على الأقل' }, { status: 400 });
      }
      updateData.password = await bcrypt.hash(password, 10);
    }

    // If permissions provided, replace them
    if (permissions !== undefined) {
      // Delete existing permissions
      await db.userPermission.deleteMany({ where: { userId: id } });

      // Create new permissions
      updateData.permissions = {
        create: (permissions || []).map((p: { screen: string; accessLevel: string }) => ({
          screen: p.screen,
          accessLevel: p.accessLevel,
        })),
      };
    }

    const user = await db.user.update({
      where: { id },
      data: updateData,
      include: { permissions: true },
    });

    const { password: _, ...safe } = user;
    // AUDIT-9-18 — user/permissions changes are CRITICAL (compliance + access control)
    auditLog({
      action: 'UPDATE',
      entity: 'USER',
      entityId: id,
      entityNumber: existing.email,
      description: `تحديث مستخدم: ${existing.email} (fields: ${Object.keys(updateData).join(', ') || 'none'})`,
      userId: auth.userId,
      userName: auth.email,
      userRole: auth.role,
      severity: 'CRITICAL',
      category: 'USERS',
      details: {
        updatedFields: Object.keys(updateData),
        permissionsChanged: permissions !== undefined,
        roleChanged: role !== undefined ? { from: existing.role, to: role } : null,
      },
    }).catch(() => {});
    return NextResponse.json({ user: safe });
  } catch (error: any) {
    console.error('[PUT /api/users/[id]]', error);
    const isConflict = error?.code === 'P2002';
    return NextResponse.json(
      { error: isConflict ? 'البريد الإلكتروني مستخدم بالفعل' : 'فشل في تحديث المستخدم' },
      { status: isConflict ? 409 : 500 }
    );
  }
}

// DELETE /api/users/[id] — Delete user (ADMIN absolute power)
// Idempotent: returns success even if user not found
// Shifts are preserved with userId set to null (onDelete: SetNull in schema)
// Permissions are cascade-deleted automatically
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireRole('ADMIN'); if (!auth.authenticated) return auth.response;
    const { id } = await params;

    // Check if user exists
    const existing = await db.user.findUnique({ where: { id } });
    if (!existing) {
      // Idempotent: return success even if not found
      return NextResponse.json({ success: true });
    }

    // Prevent deleting yourself
    if (existing.id === auth.userId) {
      return NextResponse.json({ error: 'لا يمكنك حذف حسابك الخاص' }, { status: 400 });
    }

    // Delete user in a transaction
    // - UserPermission records are cascade-deleted automatically (onDelete: Cascade)
    // - Shift records have onDelete: SetNull, so userId will be set to null
    await db.$transaction(async (tx) => {
      // Explicitly delete permissions first for safety (even though cascade should handle it)
      await tx.userPermission.deleteMany({ where: { userId: id } });
      // Delete the user — shifts will automatically get userId = null via SetNull
      await tx.user.delete({ where: { id } });
    });

    // AUDIT-9-18 — user deletion is CRITICAL (compliance + access control)
    auditLog({
      action: 'DELETE',
      entity: 'USER',
      entityId: id,
      entityNumber: existing.email,
      description: `حذف مستخدم: ${existing.email} (${existing.name}) — كان دور: ${existing.role}`,
      userId: auth.userId,
      userName: auth.email,
      userRole: auth.role,
      severity: 'CRITICAL',
      category: 'USERS',
      details: { deletedUserEmail: existing.email, deletedUserRole: existing.role },
    }).catch(() => {});

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[DELETE /api/users/[id]]', error);
    return NextResponse.json({ error: 'فشل في حذف المستخدم' }, { status: 500 });
  }
}
