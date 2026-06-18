import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth, requireRole, checkWriteAccess } from '@/lib/api-auth';

// GET /api/settings/currency-symbol - Get the currency symbol image
export async function GET() {
  try {
    const auth = await requireAuth(); if (!auth.authenticated) return auth.response;
    const key = 'currencySymbolImage';
    const setting = await db.setting.findUnique({ where: { key } });

    if (!setting) {
      return NextResponse.json({ imageData: null }, { status: 200 });
    }

    return NextResponse.json({ imageData: setting.value });
  } catch (error: unknown) {
    console.error('Error fetching currency symbol:', error);
    return NextResponse.json(
      { error: 'فشل في جلب رمز العملة' },
      { status: 500 }
    );
  }
}

// POST /api/settings/currency-symbol - Upload the currency symbol image
// SECURITY: Requires ADMIN + write access to settings
export async function POST(request: NextRequest) {
  try {
    const auth = await requireRole('ADMIN', request);
    if (!auth.authenticated) return auth.response;

    const writeCheck = checkWriteAccess(auth, 'settings');
    if (!writeCheck.authenticated) return writeCheck.response;

    const body = await request.json();
    const { imageData } = body;

    if (!imageData) {
      return NextResponse.json(
        { error: 'بيانات الصورة مطلوبة' },
        { status: 400 }
      );
    }

    // Validate image data size (max 500KB base64)
    if (imageData.length > 700000) {
      return NextResponse.json(
        { error: 'حجم الصورة كبير جداً (الحد الأقصى 500 كيلوبايت)' },
        { status: 400 }
      );
    }

    const key = 'currencySymbolImage';

    const setting = await db.setting.upsert({
      where: { key },
      update: { value: imageData },
      create: { key, value: imageData },
    });

    return NextResponse.json({
      imageData: setting.value,
      message: 'تم حفظ رمز العملة بنجاح',
    });
  } catch (error: unknown) {
    console.error('Error uploading currency symbol:', error);
    return NextResponse.json(
      { error: 'فشل في حفظ رمز العملة' },
      { status: 500 }
    );
  }
}

// DELETE /api/settings/currency-symbol - Remove the currency symbol image
// SECURITY: Requires ADMIN + write access to settings
export async function DELETE() {
  try {
    const auth = await requireRole('ADMIN');
    if (!auth.authenticated) return auth.response;

    const writeCheck = checkWriteAccess(auth, 'settings');
    if (!writeCheck.authenticated) return writeCheck.response;

    const key = 'currencySymbolImage';
    const setting = await db.setting.findUnique({ where: { key } });

    if (!setting) {
      return NextResponse.json(
        { error: 'رمز العملة غير موجود' },
        { status: 404 }
      );
    }

    await db.setting.delete({ where: { key } });

    return NextResponse.json({
      message: 'تم حذف رمز العملة بنجاح',
    });
  } catch (error: unknown) {
    console.error('Error deleting currency symbol:', error);
    return NextResponse.json(
      { error: 'فشل في حذف رمز العملة' },
      { status: 500 }
    );
  }
}
