import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth, requireRole, checkWriteAccess } from '@/lib/api-auth';

/**
 * Branch Logo API (legacy, kept for backward compatibility with existing callers).
 *
 * The PRIMARY source of truth for a branch logo is now the `logo` field on the
 * Branch record itself (see /api/branches PUT). This endpoint continues to
 * accept requests in the new `branchId` (UUID) shape and mirrors the logo to
 * the matching Branch record so that POS / receipts continue to work while
 * callers migrate to the unified Branch API.
 */

// GET /api/settings/logo?branchId=<UUID> — get logo for a branch
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(); if (!auth.authenticated) return auth.response;
    const { searchParams } = new URL(request.url);
    // Accept branchId (UUID, preferred) — fall back to legacy `branch` param (code/id)
    const branchId = searchParams.get('branchId') || searchParams.get('branch');

    if (!branchId) {
      return NextResponse.json(
        { error: 'الفرع مطلوب' },
        { status: 400 }
      );
    }

    // Try to resolve a Branch record by id (UUID) or code
    const branch = await db.branch.findFirst({
      where: { OR: [{ id: branchId }, { code: branchId }] },
      select: { id: true, logo: true },
    });

    // If we have a Branch record with a logo, return it
    if (branch?.logo) {
      return NextResponse.json({ branchId: branch.id, logoData: branch.logo });
    }

    // Fallback to legacy Setting key `logo_<branchId>` (covers logos stored
    // before the migration to the Branch.logo column)
    const legacyKey = `logo_${branchId}`;
    const setting = await db.setting.findUnique({ where: { key: legacyKey } });
    if (setting?.value) {
      return NextResponse.json({ branchId, logoData: setting.value });
    }

    return NextResponse.json({ branchId, logoData: null });
  } catch (error: unknown) {
    console.error('Error fetching logo:', error);
    return NextResponse.json(
      { error: 'فشل في جلب الشعار' },
      { status: 500 }
    );
  }
}

// POST /api/settings/logo — upload a logo for a branch
// SECURITY: Requires ADMIN + write access to settings
export async function POST(request: NextRequest) {
  try {
    const auth = await requireRole('ADMIN', request);
    if (!auth.authenticated) return auth.response;

    const writeCheck = checkWriteAccess(auth, 'settings');
    if (!writeCheck.authenticated) return writeCheck.response;

    const body = await request.json();
    // Accept branchId (preferred) — fall back to legacy `branch` field
    const branchId = body.branchId || body.branch;
    const { logoData } = body;

    if (!branchId) {
      return NextResponse.json(
        { error: 'الفرع مطلوب' },
        { status: 400 }
      );
    }

    if (!logoData) {
      return NextResponse.json(
        { error: 'بيانات الشعار مطلوبة' },
        { status: 400 }
      );
    }

    // Validate image data size (max 1MB base64)
    if (logoData.length > 1400000) {
      return NextResponse.json(
        { error: 'حجم الشعار كبير جداً (الحد الأقصى 1 ميجابايت)' },
        { status: 400 }
      );
    }

    // Resolve the Branch record (by id or code)
    const branch = await db.branch.findFirst({
      where: { OR: [{ id: branchId }, { code: branchId }] },
      select: { id: true },
    });

    if (branch) {
      // Store on the Branch record (primary source of truth)
      await db.branch.update({
        where: { id: branch.id },
        data: { logo: logoData },
      });
      return NextResponse.json({
        branchId: branch.id,
        logoData,
        message: 'تم حفظ الشعار بنجاح',
      });
    }

    // Fallback: store in Setting table under legacy key (branch not yet in DB)
    const key = `logo_${branchId}`;
    await db.setting.upsert({
      where: { key },
      update: { value: logoData },
      create: { key, value: logoData },
    });
    return NextResponse.json({
      branchId,
      logoData,
      message: 'تم حفظ الشعار بنجاح',
    });
  } catch (error: unknown) {
    console.error('Error uploading logo:', error);
    return NextResponse.json(
      { error: 'فشل في حفظ الشعار' },
      { status: 500 }
    );
  }
}

// DELETE /api/settings/logo?branchId=<UUID> — remove a logo for a branch
// SECURITY: Requires ADMIN + write access to settings
export async function DELETE(request: NextRequest) {
  try {
    const auth = await requireRole('ADMIN', request);
    if (!auth.authenticated) return auth.response;

    const writeCheck = checkWriteAccess(auth, 'settings');
    if (!writeCheck.authenticated) return writeCheck.response;

    // DELETE may use either query string (?branchId=) or JSON body
    const url = new URL(request.url);
    let branchId = url.searchParams.get('branchId') || url.searchParams.get('branch');

    if (!branchId) {
      try {
        const body = await request.json();
        branchId = body.branchId || body.branch;
      } catch {
        // No body — fall through to error below
      }
    }

    if (!branchId) {
      return NextResponse.json(
        { error: 'الفرع مطلوب' },
        { status: 400 }
      );
    }

    // Resolve the Branch record (by id or code)
    const branch = await db.branch.findFirst({
      where: { OR: [{ id: branchId }, { code: branchId }] },
      select: { id: true, logo: true },
    });

    if (branch?.logo) {
      await db.branch.update({
        where: { id: branch.id },
        data: { logo: null },
      });
      return NextResponse.json({
        branchId: branch.id,
        message: 'تم حذف الشعار بنجاح',
      });
    }

    // Legacy fallback
    const key = `logo_${branchId}`;
    const setting = await db.setting.findUnique({ where: { key } });
    if (setting) {
      await db.setting.delete({ where: { key } });
      return NextResponse.json({
        branchId,
        message: 'تم حذف الشعار بنجاح',
      });
    }

    return NextResponse.json(
      { error: 'الشعار غير موجود' },
      { status: 404 }
    );
  } catch (error: unknown) {
    console.error('Error deleting logo:', error);
    return NextResponse.json(
      { error: 'فشل في حذف الشعار' },
      { status: 500 }
    );
  }
}
