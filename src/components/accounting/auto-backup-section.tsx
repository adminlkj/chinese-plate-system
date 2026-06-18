'use client';

import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { Clock, Timer, Play, HardDrive, RotateCcw, Loader2, Save } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Switch,
} from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { formatNumber } from '@/lib/types';
import { CurrencyAmount } from '@/components/ui/currency-symbol';
import { useAppStore } from '@/lib/store';
import { useTranslation } from '@/lib/i18n';

interface BackupFile {
  filename: string;
  size: number;
  date: string;
}

interface AutoBackupSettings {
  enabled: boolean;
  intervalHours: number;
  maxCopies: number;
  lastRun: string | null;
  backupCount: number;
  backupList: BackupFile[];
}

export default function AutoBackupSection() {
  const { t, isRTL } = useTranslation();
  const { authToken } = useAppStore();

  const [settings, setSettings] = useState<AutoBackupSettings>({
    enabled: false,
    intervalHours: 24,
    maxCopies: 7,
    lastRun: null,
    backupCount: 0,
    backupList: [],
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [backupsDialogOpen, setBackupsDialogOpen] = useState(false);

  const fetchSettings = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/data/auto-backup', {
        headers: { 'Authorization': `Bearer ${authToken}` },
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setSettings(data);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [authToken]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const handleSave = async () => {
    try {
      setSaving(true);
      const res = await fetch('/api/data/auto-backup', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          enabled: settings.enabled,
          intervalHours: settings.intervalHours,
          maxCopies: settings.maxCopies,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error);
      }
      toast.success(t.autoBackupSettingsSaved);
    } catch (error: any) {
      toast.error(error.message || t.failedToSaveAutoBackup);
    } finally {
      setSaving(false);
    }
  };

  const handleRunNow = async () => {
    try {
      setRunning(true);
      const res = await fetch('/api/data/auto-backup/execute', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${authToken}` },
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      toast.success(`${t.backupCreated} - ${data.filename}`);
      fetchSettings();
    } catch {
      toast.error(t.backupFailed);
    } finally {
      setRunning(false);
    }
  };

  const handleRestore = async (filename: string) => {
    try {
      // Use the existing import endpoint with a special flag
      // For now, just inform the user to use the manual restore
      toast.info(`${t.restoreFromBackup}: ${filename}`);
    } catch {
      toast.error(t.databaseImportFailed);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatBackupDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleString(isRTL ? 'ar-SA-u-nu-latn' : 'en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return dateStr;
    }
  };

  const getNextRun = () => {
    if (!settings.enabled || !settings.lastRun) return null;
    try {
      const last = new Date(settings.lastRun);
      const next = new Date(last.getTime() + settings.intervalHours * 60 * 60 * 1000);
      return next;
    } catch {
      return null;
    }
  };

  if (loading) return null;

  return (
    <div className="space-y-4" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="flex items-center gap-3">
        <div className="flex size-9 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
          <Timer className="size-4" />
        </div>
        <div>
          <div className="font-medium text-sm">{t.autoBackup}</div>
          <div className="text-xs text-muted-foreground">
            {settings.lastRun
              ? `${t.autoBackupLastRun}: ${formatBackupDate(settings.lastRun)}`
              : t.noBackupsYet}
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {/* Enable Toggle */}
        <div className="flex items-center justify-between">
          <Label className="text-sm">{t.autoBackupEnabled}</Label>
          <Switch
            checked={settings.enabled}
            onCheckedChange={(checked) => setSettings(s => ({ ...s, enabled: checked }))}
          />
        </div>

        {/* Interval */}
        <div className="flex items-center gap-3">
          <Label className="text-sm shrink-0">{t.autoBackupInterval}</Label>
          <Input
            type="number"
            min={1}
            max={720}
            value={settings.intervalHours}
            onChange={(e) => setSettings(s => ({ ...s, intervalHours: parseInt(e.target.value) || 24 }))}
            className="w-20 h-8 text-center"
          />
          <span className="text-xs text-muted-foreground">
            {settings.intervalHours >= 24
              ? `${(settings.intervalHours / 24).toFixed(settings.intervalHours % 24 === 0 ? 0 : 1)} ${isRTL ? 'يوم' : 'day(s)'}`
              : ''}
          </span>
        </div>

        {/* Max Copies */}
        <div className="flex items-center gap-3">
          <Label className="text-sm shrink-0">{t.autoBackupMaxCopies}</Label>
          <Input
            type="number"
            min={1}
            max={30}
            value={settings.maxCopies}
            onChange={(e) => setSettings(s => ({ ...s, maxCopies: parseInt(e.target.value) || 7 }))}
            className="w-20 h-8 text-center"
          />
        </div>

        {/* Next Run */}
        {settings.enabled && getNextRun() && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Clock className="size-3.5" />
            {t.autoBackupNextRun}: {formatBackupDate(getNextRun()!.toISOString())}
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            className="gap-2"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
            {t.saveSettings}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-2 border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-400 dark:hover:bg-emerald-950/30"
            onClick={handleRunNow}
            disabled={running}
          >
            {running ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
            {t.runBackupNow}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-2"
            onClick={() => setBackupsDialogOpen(true)}
          >
            <HardDrive className="size-3.5" />
            {t.viewBackups}
            {settings.backupCount > 0 && (
              <Badge variant="secondary" className="text-[10px] ml-1">{settings.backupCount}</Badge>
            )}
          </Button>
        </div>
      </div>

      {/* Backups List Dialog */}
      <Dialog open={backupsDialogOpen} onOpenChange={setBackupsDialogOpen}>
        <DialogContent dir={isRTL ? 'rtl' : 'ltr'} className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <HardDrive className="size-5 text-emerald-600" />
              {t.existingBackups}
            </DialogTitle>
            <DialogDescription className="sr-only">عرض النسخ الاحتياطية</DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-96">
            {settings.backupList.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <HardDrive className="size-12 mx-auto mb-2 opacity-30" />
                <p className="text-sm">{t.noBackupsYet}</p>
              </div>
            ) : (
              <div className="space-y-2">
                {settings.backupList.map((backup) => (
                  <Card key={backup.filename} className="border-muted">
                    <CardContent className="p-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-xs font-mono font-medium">{backup.filename}</p>
                          <div className="flex items-center gap-3 mt-1">
                            <span className="text-xs text-muted-foreground">
                              {formatBackupDate(backup.date)}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {formatFileSize(backup.size)}
                            </span>
                          </div>
                        </div>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              size="sm"
                              variant="outline"
                              className="gap-1 text-xs border-amber-500/50 text-amber-600 hover:bg-amber-500/10"
                            >
                              <RotateCcw className="size-3" />
                              {t.restoreFromBackup}
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent dir={isRTL ? 'rtl' : 'ltr'}>
                            <AlertDialogHeader>
                              <AlertDialogTitle>{t.confirmRestoreBackup}</AlertDialogTitle>
                              <AlertDialogDescription>
                                {t.restoreBackupWarning}
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>{t.cancel}</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => handleRestore(backup.filename)}
                                className="bg-amber-600 hover:bg-amber-700"
                              >
                                {t.confirmRestore}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}
