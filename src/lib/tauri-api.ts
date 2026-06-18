/**
 * Web API — Browser-only API layer
 *
 * This module provides a consistent API surface for the web application.
 * All desktop-specific code (Tauri/Electron) has been removed.
 * Only browser-compatible APIs are used.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DesktopAPI {
  /** Always true — this is the web implementation */
  isWeb: boolean;

  // ─── Platform Info ────────────────────────────────────────────────────────
  platform: {
    os: () => Promise<string>;
    arch: () => Promise<string>;
    version: () => Promise<string>;
  };

  // ─── App Info ─────────────────────────────────────────────────────────────
  app: {
    getVersion: () => Promise<string>;
    getName: () => Promise<string>;
    getPath: (name: string) => Promise<string>;
  };

  // ─── Session ─────────────────────────────────────────────────────────────
  session: {
    get: (key: string) => Promise<string | null>;
    set: (key: string, value: string) => Promise<void>;
    remove: (key: string) => Promise<void>;
  };

  // ─── Print / PDF ─────────────────────────────────────────────────────────
  print: {
    printPage: (url?: string) => Promise<void>;
    savePdf: (options?: { fileName?: string }) => Promise<void>;
  };

  // ─── Excel Export ─────────────────────────────────────────────────────────
  excel: {
    exportToExcel: (options: {
      data: any[];
      columns: { key: string; header: string; width?: number }[];
      sheetName?: string;
      fileName?: string;
      title?: string;
      subtitle?: string;
    }) => Promise<{ success: boolean; path?: string }>;
  };

  // ─── Data Export / Import (DB backup/restore) ────────────────────────────
  data: {
    exportDatabase: (options?: { fileName?: string }) => Promise<{ success: boolean; path?: string }>;
    importDatabase: () => Promise<{ success: boolean; path?: string }>;
  };

  // ─── File Dialogs ────────────────────────────────────────────────────────
  dialog: {
    openFile: (options?: { title?: string; filters?: { name: string; extensions: string[] }[] }) => Promise<string | null>;
    saveFile: (options?: { title?: string; defaultPath?: string; filters?: { name: string; extensions: string[] }[] }) => Promise<string | null>;
    showMessage: (options: { title: string; message: string; type?: 'info' | 'warning' | 'error' }) => Promise<void>;
    askConfirm: (options: { title: string; message: string; type?: 'info' | 'warning' | 'error' }) => Promise<boolean>;
  };

  // ─── Dark Mode ───────────────────────────────────────────────────────────
  darkMode: {
    toggle: () => Promise<void>;
    get: () => Promise<boolean>;
    set: (dark: boolean) => Promise<void>;
  };

  // ─── Crash Analytics ─────────────────────────────────────────────────────
  crash: {
    report: (error: Error, context?: Record<string, string>) => Promise<void>;
  };

  // ─── Server Port ─────────────────────────────────────────────────────────
  server: {
    getPort: () => number;
    getBaseUrl: () => string;
  };
}

// ─── Implementation ────────────────────────────────────────────────────────────

const DEFAULT_PORT = 3000;

function createWebAPI(): DesktopAPI {
  return {
    isWeb: true,

    // ─── Platform Info ────────────────────────────────────────────────────
    platform: {
      os: async () => navigator.platform || 'web',
      arch: async () => 'web',
      version: async () => navigator.userAgent,
    },

    // ─── App Info ─────────────────────────────────────────────────────────
    app: {
      getVersion: async () => '1.0.0',
      getName: async () => 'Accounting System',
      getPath: async () => '',
    },

    // ─── Session ──────────────────────────────────────────────────────────
    session: {
      get: async (key: string) => {
        if (typeof window !== 'undefined') {
          return localStorage.getItem(`session:${key}`);
        }
        return null;
      },
      set: async (key: string, value: string) => {
        if (typeof window !== 'undefined') {
          localStorage.setItem(`session:${key}`, value);
        }
      },
      remove: async (key: string) => {
        if (typeof window !== 'undefined') {
          localStorage.removeItem(`session:${key}`);
        }
      },
    },

    // ─── Print / PDF ──────────────────────────────────────────────────────
    print: {
      printPage: async (url?: string) => {
        const printWindow = url ? window.open(url, '_blank') : null;
        if (printWindow) {
          printWindow.onload = () => printWindow.print();
        } else {
          window.print();
        }
      },
      savePdf: async () => {
        window.print();
      },
    },

    // ─── Excel Export ─────────────────────────────────────────────────────
    excel: {
      exportToExcel: async (options) => {
        const { data, columns, sheetName, fileName, title, subtitle } = options;
        const defaultFileName = `تقرير-${new Date().toISOString().slice(0, 10)}.xlsx`;

        const XLSX = await import('xlsx');
        const wb = XLSX.utils.book_new();
        const rows: any[][] = [];

        if (title) {
          rows.push([title]);
          rows.push([]);
        }
        if (subtitle) {
          rows.push([subtitle]);
          rows.push([]);
        }
        rows.push(columns.map((c) => c.header));
        for (const item of data) {
          rows.push(columns.map((c) => item[c.key] ?? ''));
        }

        const ws = XLSX.utils.aoa_to_sheet(rows);
        ws['!cols'] = columns.map((c) => ({ wch: c.width || 15 }));
        XLSX.utils.book_append_sheet(wb, ws, sheetName || 'بيانات');

        XLSX.writeFile(wb, fileName || defaultFileName);
        return { success: true };
      },
    },

    // ─── Data Export / Import ─────────────────────────────────────────────
    data: {
      exportDatabase: async (options?: { fileName?: string }) => {
        const defaultFileName = `accounting-backup-${new Date().toISOString().slice(0, 10)}.json`;
        try {
          const resp = await fetch('/api/data/export');
          if (!resp.ok) throw new Error('Export failed');
          const blob = await resp.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = options?.fileName || defaultFileName;
          a.click();
          URL.revokeObjectURL(url);
          return { success: true };
        } catch {
          return { success: false };
        }
      },

      importDatabase: async () => {
        return new Promise<{ success: boolean; path?: string }>((resolve) => {
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = '.json';
          input.onchange = async (e: any) => {
            const file = e.target?.files?.[0];
            if (!file) {
              resolve({ success: false });
              return;
            }
            try {
              const formData = new FormData();
              formData.append('backup', file);
              const resp = await fetch('/api/data/import', { method: 'POST', body: formData });
              resolve({ success: resp.ok, path: file.name });
            } catch {
              resolve({ success: false });
            }
          };
          input.click();
        });
      },
    },

    // ─── File Dialogs ─────────────────────────────────────────────────────
    dialog: {
      openFile: async (options) => {
        return new Promise<string | null>((resolve) => {
          const input = document.createElement('input');
          input.type = 'file';
          if (options?.filters) {
            input.accept = options.filters.map(f => f.extensions.map(e => `.${e}`).join(',')).join(',');
          }
          input.onchange = (e: any) => {
            resolve(e.target?.files?.[0]?.name ?? null);
          };
          input.click();
          setTimeout(() => resolve(null), 60000);
        });
      },

      saveFile: async (options) => {
        return options?.defaultPath || null;
      },

      showMessage: async (options) => {
        alert(options.message);
      },

      askConfirm: async (options) => {
        return confirm(options.message);
      },
    },

    // ─── Dark Mode ────────────────────────────────────────────────────────
    darkMode: {
      toggle: async () => {
        if (typeof document === 'undefined') return;
        document.documentElement.classList.toggle('dark');
        const isDark = document.documentElement.classList.contains('dark');
        localStorage.setItem('theme', isDark ? 'dark' : 'light');
      },
      get: async () => {
        if (typeof document === 'undefined') return false;
        return document.documentElement.classList.contains('dark');
      },
      set: async (dark: boolean) => {
        if (typeof document === 'undefined') return;
        document.documentElement.classList.toggle('dark', dark);
        localStorage.setItem('theme', dark ? 'dark' : 'light');
      },
    },

    // ─── Crash Analytics ──────────────────────────────────────────────────
    crash: {
      report: async (error: Error, context?: Record<string, string>) => {
        console.error('[CrashReport]', error, context);
        if (typeof localStorage !== 'undefined') {
          try {
            const reports = JSON.parse(localStorage.getItem('crash_reports') || '[]');
            reports.push({
              message: error.message,
              stack: error.stack,
              context,
              timestamp: new Date().toISOString(),
            });
            if (reports.length > 50) reports.splice(0, reports.length - 50);
            localStorage.setItem('crash_reports', JSON.stringify(reports));
          } catch {
            // Ignore storage errors
          }
        }
      },
    },

    // ─── Server Port ──────────────────────────────────────────────────────
    server: {
      getPort: () => DEFAULT_PORT,
      getBaseUrl: () => '',
    },
  };
}

// ─── Singleton ─────────────────────────────────────────────────────────────────

const _api = createWebAPI();

// ─── Helper Functions ──────────────────────────────────────────────────────────

/** Always true — web mode */
export function isWebApp(): boolean {
  return true;
}

/** Always false — no desktop app */
export function isDesktopApp(): boolean {
  return false;
}

/** Get the Web API instance */
export function getDesktopAPI(): DesktopAPI {
  return _api;
}

export default _api;
