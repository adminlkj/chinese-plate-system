'use client';

import dynamic from 'next/dynamic';
import { SidebarProvider, SidebarTrigger, SidebarInset } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/accounting/app-sidebar';
import { Placeholder } from '@/components/accounting/placeholder';
import { useAppStore, type AuthUser } from '@/lib/store';
import { I18nProvider, useTranslation } from '@/lib/i18n';
import { Separator } from '@/components/ui/separator';
import { useEffect, useState } from 'react';
import { installApiInterceptor, saveAuthToken, removeAuthToken } from '@/lib/api-client';

// Dynamic imports for screen components (no SSR)
const Dashboard = dynamic(() => import('@/components/accounting/dashboard'), {
  ssr: false,
  loading: () => <Placeholder title="..." />,
});

const ChartOfAccounts = dynamic(() => import('@/components/accounting/chart-of-accounts'), {
  ssr: false,
  loading: () => <Placeholder title="..." />,
});

const TransactionEntry = dynamic(() => import('@/components/accounting/transaction-entry'), {
  ssr: false,
  loading: () => <Placeholder title="..." />,
});

const GeneralJournal = dynamic(() => import('@/components/accounting/general-journal'), {
  ssr: false,
  loading: () => <Placeholder title="..." />,
});

const GeneralLedger = dynamic(() => import('@/components/accounting/general-ledger'), {
  ssr: false,
  loading: () => <Placeholder title="..." />,
});

const TrialBalance = dynamic(() => import('@/components/accounting/trial-balance'), {
  ssr: false,
  loading: () => <Placeholder title="..." />,
});

const FinancialCenter = dynamic(() => import('@/components/accounting/financial-center'), {
  ssr: false,
  loading: () => <Placeholder title="..." />,
});

const IncomeStatement = dynamic(() => import('@/components/accounting/income-statement'), {
  ssr: false,
  loading: () => <Placeholder title="..." />,
});

const CashFlow = dynamic(() => import('@/components/accounting/cash-flow'), {
  ssr: false,
  loading: () => <Placeholder title="..." />,
});

const AdvancedReports = dynamic(() => import('@/components/accounting/advanced-reports'), {
  ssr: false,
  loading: () => <Placeholder title="..." />,
});

const Payroll = dynamic(() => import('@/components/accounting/payroll'), {
  ssr: false,
  loading: () => <Placeholder title="..." />,
});

const Settings = dynamic(() => import('@/components/accounting/settings'), {
  ssr: false,
  loading: () => <Placeholder title="..." />,
});

const Customers = dynamic(() => import('@/components/accounting/customers'), {
  ssr: false,
  loading: () => <Placeholder title="..." />,
});

const Suppliers = dynamic(() => import('@/components/accounting/suppliers'), {
  ssr: false,
  loading: () => <Placeholder title="..." />,
});

const POSScreen = dynamic(() => import('@/components/accounting/pos-screen'), {
  ssr: false,
  loading: () => <Placeholder title="..." />,
});

const SetupWizard = dynamic(() => import('@/components/accounting/setup-wizard'), {
  ssr: false,
  loading: () => <Placeholder title="..." />,
});

const ProductsInventory = dynamic(() => import('@/components/accounting/products-inventory'), {
  ssr: false,
  loading: () => <Placeholder title="..." />,
});

const SalesInvoices = dynamic(() => import('@/components/accounting/sales-invoices'), {
  ssr: false,
  loading: () => <Placeholder title="..." />,
});

const UsersPermissions = dynamic(() => import('@/components/accounting/users-permissions'), {
  ssr: false,
  loading: () => <Placeholder title="..." />,
});

const AuditLog = dynamic(() => import('@/components/accounting/audit-log'), {
  ssr: false,
  loading: () => <Placeholder title="..." />,
});

const LoginScreen = dynamic(() => import('@/components/accounting/login-screen'), {
  ssr: false,
});

// Dynamic component wrapper with error boundary fallback
function DynamicScreen({ screen }: { screen: string }) {
  const { hasAccess, setCurrentScreen, getFirstAccessibleScreen } = useAppStore();

  // Auto-redirect if user has no access to current screen
  useEffect(() => {
    if (!hasAccess(screen, 'READ')) {
      const firstScreen = getFirstAccessibleScreen();
      if (firstScreen && firstScreen !== screen) {
        setCurrentScreen(firstScreen);
      }
    }
  }, [screen, hasAccess, setCurrentScreen, getFirstAccessibleScreen]);

  if (!hasAccess(screen, 'READ')) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center space-y-2">
          <div className="text-4xl">🔒</div>
          <h2 className="text-lg font-semibold text-muted-foreground">لا تملك صلاحية الوصول</h2>
          <p className="text-sm text-muted-foreground/70">Access Denied</p>
        </div>
      </div>
    );
  }

  const screenComponents: Record<string, React.ComponentType> = {
    dashboard: Dashboard,
    'chart-of-accounts': ChartOfAccounts,
    transactions: TransactionEntry,
    journal: GeneralJournal,
    ledger: GeneralLedger,
    'trial-balance': TrialBalance,
    'financial-center': FinancialCenter,
    'income-statement': IncomeStatement,
    'cash-flow': CashFlow,
    'advanced-reports': AdvancedReports,
    payroll: Payroll,
    customers: Customers,
    suppliers: Suppliers,
    pos: POSScreen,
    'products-inventory': ProductsInventory,
    'sales-invoices': SalesInvoices,
    settings: Settings,
    users: UsersPermissions,
    'audit-log': AuditLog,
  };

  const Component = screenComponents[screen];

  if (!Component) {
    return <Placeholder title={screen} />;
  }

  return <Component />;
}

function CurrencySymbolLoader() {
  const setCurrencySymbolUrl = useAppStore((s) => s.setCurrencySymbolUrl);

  useEffect(() => {
    fetch('/api/settings/currency-symbol')
      .then((res) => res.json())
      .then((data) => {
        if (data.imageData) {
          setCurrencySymbolUrl(data.imageData);
        }
      })
      .catch(() => {});
  }, [setCurrencySymbolUrl]);

  return null;
}

// Screen title mapping with i18n
function ScreenTitle({ screen }: { screen: string }) {
  const { t } = useTranslation();
  const screenTitles: Record<string, string> = {
    dashboard: t.dashboard,
    'chart-of-accounts': t.chartOfAccounts,
    transactions: t.transactions,
    pos: t.pos,
    'products-inventory': t.productsInventory,
    'sales-invoices': t.salesInvoices,
    journal: t.journal,
    ledger: t.ledger,
    'trial-balance': t.trialBalance,
    'financial-center': t.financialCenter,
    'income-statement': t.incomeStatement,
    'cash-flow': t.cashFlow,
    'advanced-reports': t.advancedReports || 'التقارير المتقدمة',
    payroll: t.payroll || 'الرواتب',
    customers: t.customers,
    suppliers: t.suppliers,
    settings: t.settings,
    users: t.usersPermissions || 'المستخدمين والصلاحيات',
    'audit-log': t.auditLog || 'سجل التدقيق',
  };
  return <>{screenTitles[screen] || t.appName}</>;
}

// ─── API Interceptor Installer ─────────────────────────────────
// Installs the global fetch wrapper once on the client side.
// This adds the Authorization: Bearer <token> header to all /api/ requests.
function ApiInterceptorInstaller() {
  useEffect(() => {
    installApiInterceptor();
  }, []);
  return null;
}

// ─── Auto Backup Scheduler ──────────────────────────────────────
// Checks periodically if an auto-backup is due and executes it.
// Runs only when the user is authenticated and is an ADMIN.
function AutoBackupScheduler() {
  const { isAuthenticated, user, authToken } = useAppStore();

  useEffect(() => {
    if (!isAuthenticated || !user || user.role !== 'ADMIN' || !authToken) return;

    let intervalId: NodeJS.Timeout;

    const checkAndRun = async () => {
      try {
        // Get auto-backup settings
        const settingsRes = await fetch('/api/data/auto-backup', {
          headers: { 'Authorization': `Bearer ${authToken}` },
        });
        if (!settingsRes.ok) return;
        const settings = await settingsRes.json();

        if (!settings.enabled) return;

        // Check if backup is due
        const lastRun = settings.lastRun ? new Date(settings.lastRun) : null;
        const now = new Date();
        const intervalMs = (settings.intervalHours || 24) * 60 * 60 * 1000;

        if (!lastRun || (now.getTime() - lastRun.getTime()) >= intervalMs) {
          // Execute backup
          await fetch('/api/data/auto-backup/execute', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${authToken}` },
          });
        }
      } catch {
        // Silently fail
      }
    };

    // Check immediately, then every 30 minutes
    checkAndRun();
    intervalId = setInterval(checkAndRun, 30 * 60 * 1000);

    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [isAuthenticated, user, authToken]);

  return null;
}

// ─── Auth Gate ──────────────────────────────────────────────────
// On first load: verify the persisted token is still valid.
// Uses /api/auth/me which checks the JWT token (via Authorization header
// auto-injected by the API interceptor, or via session cookie fallback).
// This is the production-safe way to verify sessions on Render.
function AuthGate() {
  const { user, isAuthenticated, authToken, login, logout, setAuthReady } = useAppStore();

  useEffect(() => {
    let cancelled = false;

    async function verify() {
      if (user && isAuthenticated) {
        // We have a persisted session - verify with the server via /api/auth/me
        // The API interceptor automatically adds the Authorization: Bearer header
        // and credentials: 'include' for cookie fallback
        try {
          const res = await fetch('/api/auth/me', {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' },
          });

          if (!cancelled) {
            if (res.ok) {
              const data = await res.json();
              if (data.authenticated && data.user) {
                // Session is valid — re-login to sync fresh user data
                // Keep the existing token (it's still valid)
                login(data.user as AuthUser, authToken || undefined);
              } else {
                // Session invalid — logout and clear cookies
                logout();
                fetch('/api/admin/logout', { method: 'POST', credentials: 'include' }).catch(() => {});
              }
            } else if (res.status === 401) {
              // Token expired or invalid — clean logout
              logout();
              fetch('/api/admin/logout', { method: 'POST', credentials: 'include' }).catch(() => {});
            } else {
              // Server error (5xx) — keep current session, will retry on next interaction
              // This prevents logging users out when the server has a temporary hiccup
              if (authToken) {
                saveAuthToken(authToken);
              }
              setAuthReady(true);
            }
          }
        } catch {
          if (!cancelled) {
            // Network error — keep current session, will retry later
            // Ensure the auth token is still in localStorage for the interceptor
            if (authToken) {
              saveAuthToken(authToken);
            }
            setAuthReady(true);
          }
        }
      } else {
        // No persisted session — check if there's a valid cookie-based session
        // (e.g., user logged in via another tab, or cookie was set by a previous login)
        try {
          const res = await fetch('/api/auth/me', {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' },
          });

          if (!cancelled) {
            if (res.ok) {
              const data = await res.json();
              if (data.authenticated && data.user) {
                // Found a valid cookie-based session — restore it
                login(data.user as AuthUser);
              } else {
                setAuthReady(true);
              }
            } else {
              setAuthReady(true);
            }
          }
        } catch {
          if (!cancelled) {
            setAuthReady(true);
          }
        }
      }
    }

    verify();
    return () => { cancelled = true; };
  }, []); // Run once on mount

  return null;
}

// ─── Loading Screen ──────────────────────────────────────────────
function LoadingScreen() {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
        <span className="text-sm text-muted-foreground">جاري التحميل...</span>
      </div>
    </div>
  );
}

// ─── Main App Content ──────────────────────────────────────────────
function AppContent() {
  const { currentScreen, locale, isAuthenticated, user, authReady } = useAppStore();
  const { t } = useTranslation();
  const dir = locale === 'ar' ? 'rtl' : 'ltr';

  // Setup wizard state
  const [showSetupWizard, setShowSetupWizard] = useState(false);
  const [setupChecked, setSetupChecked] = useState(false);

  // Check if system needs setup on mount (before auth)
  useEffect(() => {
    let cancelled = false;

    async function checkSetup() {
      try {
        const res = await fetch('/api/setup');
        if (!cancelled && res.ok) {
          const data = await res.json();
          if (data.needsSetup) {
            setShowSetupWizard(true);
          }
        }
      } catch {
        // Silently fail - don't block the app
      } finally {
        if (!cancelled) {
          setSetupChecked(true);
        }
      }
    }

    checkSetup();
    return () => { cancelled = true; };
  }, []);

  const handleSetupComplete = () => {
    setShowSetupWizard(false);
  };

  // Wait until setup check is complete before deciding what to show
  if (!setupChecked) {
    return <LoadingScreen />;
  }

  // Show setup wizard if system needs first-run configuration (takes priority over auth)
  if (showSetupWizard) {
    return (
      <I18nProvider>
        <SetupWizard onComplete={handleSetupComplete} />
      </I18nProvider>
    );
  }

  // Wait until auth verification is complete
  if (!authReady) {
    return <LoadingScreen />;
  }

  // Show login if not authenticated
  if (!isAuthenticated || !user) {
    return <LoginScreen />;
  }

  return (
    <div dir={dir} className="flex-1 flex flex-col min-h-screen">
      <SidebarProvider>
        <CurrencySymbolLoader />
        <AppSidebar />
        <SidebarInset>
          <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-background px-4 no-print">
            <SidebarTrigger className={locale === 'ar' ? '-mr-1' : '-ml-1'} />
            <Separator orientation="vertical" className={locale === 'ar' ? 'mr-2 !h-5' : 'ml-2 !h-5'} />
            <h1 className="text-base font-semibold text-foreground">
              <ScreenTitle screen={currentScreen} />
            </h1>
          </header>
          <main className="flex-1 overflow-y-auto p-4 md:p-6">
            <DynamicScreen screen={currentScreen} />
          </main>
        </SidebarInset>
      </SidebarProvider>
    </div>
  );
}

export default function Home() {
  return (
    <I18nProvider>
      <ApiInterceptorInstaller />
      <AuthGate />
      <AutoBackupScheduler />
      <AppContent />
    </I18nProvider>
  );
}
