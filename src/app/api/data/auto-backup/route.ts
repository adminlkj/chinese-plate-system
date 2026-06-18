import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireRole, checkWriteAccess } from '@/lib/api-auth';

// GET /api/data/auto-backup — Get auto-backup settings
export async function GET(request: NextRequest) {
  try {
    const auth = await requireRole('ADMIN', request);
    if (!auth.authenticated) return auth.response;

    const settings = await db.setting.findMany({
      where: { key: { startsWith: 'auto_backup_' } } },
    );

    const getSetting = (key: string, fallback: string) => {
      const s = settings.find(s => s.key === key);
      return s?.value || fallback;
    };

    // Count backup records from audit log
    let backupCount = 0;
    let backupList: { filename: string; date: string }[] = [];
    try {
      const backupLogs = await db.auditLog.findMany({
        where: { action: 'EXPORT', entity: 'BACKUP' },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
      backupCount = backupLogs.length;
      backupList = backupLogs.map(log => ({
        filename: log.entityNumber || log.description,
        date: log.createdAt.toISOString(),
      }));
    } catch { /* ignore */ }

    return NextResponse.json({
      enabled: getSetting('auto_backup_enabled', 'false') === 'true',
      intervalHours: parseInt(getSetting('auto_backup_interval_hours', '24')) || 24,
      maxCopies: parseInt(getSetting('auto_backup_max_copies', '7')) || 7,
      lastRun: getSetting('auto_backup_last_run', '') || null,
      backupCount,
      backupList,
    });
  } catch (error: any) {
    console.error('Error fetching auto-backup settings:', error);
    return NextResponse.json(
      { error: 'حدث خطأ في الخادم' },
      { status: 500 }
    );
  }
}

// PUT /api/data/auto-backup — Update auto-backup settings
export async function PUT(request: NextRequest) {
  try {
    const auth = await requireRole('ADMIN', request);
    if (!auth.authenticated) return auth.response;

    const writeCheck = checkWriteAccess(auth, 'settings'); if (!writeCheck.authenticated) return writeCheck.response;

    const body = await request.json();
    const { enabled, intervalHours, maxCopies } = body;

    if (typeof enabled !== 'boolean') {
      return NextResponse.json({ error: 'enabled يجب أن يكون true أو false' }, { status: 400 });
    }
    const hours = parseInt(String(intervalHours));
    if (isNaN(hours) || hours < 1) {
      return NextResponse.json({ error: 'فترة النسخ الاحتياطي يجب أن تكون ساعة على الأقل' }, { status: 400 });
    }
    const copies = parseInt(String(maxCopies));
    if (isNaN(copies) || copies < 1 || copies > 30) {
      return NextResponse.json({ error: 'الحد الأقصى للنسخ يجب أن يكون بين 1 و 30' }, { status: 400 });
    }

    await db.$transaction([
      db.setting.upsert({
        where: { key: 'auto_backup_enabled' },
        update: { value: String(enabled) },
        create: { key: 'auto_backup_enabled', value: String(enabled) },
      }),
      db.setting.upsert({
        where: { key: 'auto_backup_interval_hours' },
        update: { value: String(hours) },
        create: { key: 'auto_backup_interval_hours', value: String(hours) },
      }),
      db.setting.upsert({
        where: { key: 'auto_backup_max_copies' },
        update: { value: String(copies) },
        create: { key: 'auto_backup_max_copies', value: String(copies) },
      }),
    ]);

    return NextResponse.json({ success: true, enabled, intervalHours: hours, maxCopies: copies });
  } catch (error: any) {
    console.error('Error updating auto-backup settings:', error);
    return NextResponse.json(
      { error: 'حدث خطأ في الخادم' },
      { status: 500 }
    );
  }
}
