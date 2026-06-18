import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/api-auth';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';

// POST /api/settings/verify-supervisor - Verify supervisor password
// Used when a non-admin user needs supervisor approval for certain actions
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(); if (!auth.authenticated) return auth.response;

    // Rate limit: max 5 attempts per minute per IP
    const ip = getClientIp(request);
    const rateLimit = checkRateLimit(`supervisor-verify:${ip}`, 5, 60_000);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { valid: false, error: `تم تجاوز الحد الأقصى للمحاولات. حاول مرة أخرى بعد ${Math.ceil(rateLimit.retryAfterMs / 1000)} ثانية` },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(rateLimit.retryAfterMs / 1000)) } }
      );
    }

    const body = await request.json();
    const { password } = body;

    // Trim the password to handle accidental whitespace
    const trimmedPassword = (password || '').trim();
    if (!trimmedPassword) {
      return NextResponse.json({ valid: false, error: 'كلمة المرور مطلوبة' }, { status: 400 });
    }

    const setting = await db.setting.findUnique({ where: { key: 'supervisorPassword' } });
    if (!setting) {
      // No supervisor password set — deny access
      return NextResponse.json({ valid: false, error: 'لم يتم تعيين كلمة مرور المشرف. يرجى تعيينها من الإعدادات.' }, { status: 403 });
    }

    // Check if the stored value is a bcrypt hash
    const storedValue = setting.value;
    let isValid = false;

    // Guard: if the stored value is the masked placeholder, the real password was lost
    if (storedValue === '••••' || storedValue === '') {
      return NextResponse.json(
        { valid: false, error: 'كلمة مرور المشرف تالفة. يرجى إعادة تعيينها من الإعدادات.' },
        { status: 403 }
      );
    }

    if (/^\$2[aby]\$/.test(storedValue)) {
      // Bcrypt hash — compare securely
      isValid = await bcrypt.compare(trimmedPassword, storedValue);
    } else {
      // Plain text (legacy) — direct comparison (will be migrated on next save)
      isValid = trimmedPassword === storedValue;
    }

    if (!isValid) {
      return NextResponse.json({ valid: false, error: 'كلمة المرور غير صحيحة' }, { status: 403 });
    }

    return NextResponse.json({ valid: true });
  } catch (error: any) {
    console.error('[verify-supervisor] Error:', error);
    return NextResponse.json({ error: 'حدث خطأ في الخادم' }, { status: 500 });
  }
}
