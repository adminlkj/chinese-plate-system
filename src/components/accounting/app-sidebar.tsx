'use client';

import {
  LayoutDashboard,
  BookOpen,
  PencilLine,
  BookMarked,
  BookCopy,
  Scale,
  Landmark,
  TrendingUp,
  Wallet,
  Settings,
  Sun,
  Moon,
  Calculator,
  Users,
  Truck,
  ShoppingCart,
  Package,
  FileText,
  Languages,
  Shield,
  ShieldCheck,
  LogOut,
  BarChart3,
  Banknote,
} from 'lucide-react';
import { useTheme } from 'next-themes';

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@/components/ui/sidebar';
import { useAppStore, type Screen } from '@/lib/store';
import { useTranslation, type Locale } from '@/lib/i18n';

interface NavItem {
  titleKey: string;
  icon: React.ElementType;
  screen: Screen;
  groupKey: string;
}

const navItems: NavItem[] = [
  { titleKey: 'navDashboard', icon: LayoutDashboard, screen: 'dashboard', groupKey: 'groupGeneral' },
  { titleKey: 'navChartOfAccounts', icon: BookOpen, screen: 'chart-of-accounts', groupKey: 'groupAccounts' },
  { titleKey: 'navCustomers', icon: Users, screen: 'customers', groupKey: 'groupAccounts' },
  { titleKey: 'navSuppliers', icon: Truck, screen: 'suppliers', groupKey: 'groupAccounts' },
  { titleKey: 'navTransactions', icon: PencilLine, screen: 'transactions', groupKey: 'groupOperations' },
  { titleKey: 'navPOS', icon: ShoppingCart, screen: 'pos', groupKey: 'groupOperations' },
  { titleKey: 'navProductsInventory', icon: Package, screen: 'products-inventory', groupKey: 'groupOperations' },
  { titleKey: 'navSalesInvoices', icon: FileText, screen: 'sales-invoices', groupKey: 'groupOperations' },
  { titleKey: 'navJournal', icon: BookMarked, screen: 'journal', groupKey: 'groupOperations' },
  { titleKey: 'navLedger', icon: BookCopy, screen: 'ledger', groupKey: 'groupOperations' },
  { titleKey: 'navTrialBalance', icon: Scale, screen: 'trial-balance', groupKey: 'groupReports' },
  { titleKey: 'navFinancialCenter', icon: Landmark, screen: 'financial-center', groupKey: 'groupReports' },
  { titleKey: 'navIncomeStatement', icon: TrendingUp, screen: 'income-statement', groupKey: 'groupReports' },
  { titleKey: 'navCashFlow', icon: Wallet, screen: 'cash-flow', groupKey: 'groupReports' },
  { titleKey: 'navAdvancedReports', icon: BarChart3, screen: 'advanced-reports', groupKey: 'groupReports' },
  { titleKey: 'navPayroll', icon: Banknote, screen: 'payroll', groupKey: 'groupOperations' },
  { titleKey: 'navUsersPermissions', icon: Shield, screen: 'users', groupKey: 'groupSystem' },
  { titleKey: 'navAuditLog', icon: ShieldCheck, screen: 'audit-log', groupKey: 'groupSystem' },
  { titleKey: 'navSettings', icon: Settings, screen: 'settings', groupKey: 'groupSystem' },
];

const groupKeys = ['groupGeneral', 'groupAccounts', 'groupOperations', 'groupReports', 'groupSystem'];

export function AppSidebar() {
  const { currentScreen, setCurrentScreen, locale, setLocale, user, hasAccess, logout } = useAppStore();
  const { theme, setTheme } = useTheme();
  const { t, isRTL } = useTranslation();

  const toggleTheme = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  };

  const toggleLanguage = () => {
    setLocale(locale === 'ar' ? 'en' : 'ar');
  };

  const handleSignOut = async () => {
    // Clear auth state - Zustand + localStorage
    logout();
    // Call our logout endpoint to clear the session cookie
    // credentials: 'include' ensures the cookie is actually sent for deletion
    try {
      await fetch('/api/admin/logout', { method: 'POST', credentials: 'include' });
    } catch {}
  };

  const side = isRTL ? 'right' : 'left';

  // Filter nav items based on permissions
  const visibleNavItems = navItems.filter((item) => hasAccess(item.screen, 'READ'));

  return (
    <Sidebar side={side} collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Calculator className="size-4" />
          </div>
          <div className="flex flex-col group-data-[collapsible=icon]:hidden">
            <span className="text-sm font-bold text-sidebar-foreground">{t.appName}</span>
            <span className="text-xs text-sidebar-foreground/60">{t.appDescription}</span>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        {groupKeys.map((groupKey) => {
          const groupItems = visibleNavItems.filter((item) => item.groupKey === groupKey);
          if (groupItems.length === 0) return null;

          return (
            <SidebarGroup key={groupKey}>
              <SidebarGroupLabel>{t[groupKey as keyof typeof t]}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {groupItems.map((item) => (
                    <SidebarMenuItem key={item.screen}>
                      <SidebarMenuButton
                        isActive={currentScreen === item.screen}
                        onClick={() => setCurrentScreen(item.screen)}
                        tooltip={t[item.titleKey as keyof typeof t]}
                        className={
                          currentScreen === item.screen
                            ? 'bg-primary/10 text-primary font-medium hover:bg-primary/15 hover:text-primary'
                            : ''
                        }
                      >
                        <item.icon className="size-4" />
                        <span>{t[item.titleKey as keyof typeof t]}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          );
        })}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border">
        {/* Current user info */}
        {user && (
          <div className="px-2 py-1 group-data-[collapsible=icon]:hidden">
            <div className="flex items-center gap-2 p-2 rounded-lg bg-sidebar-accent/50">
              <div className="flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold">
                {user.name?.charAt(0) || 'U'}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-sidebar-foreground truncate">{user.name}</p>
                <p className="text-xs text-sidebar-foreground/50 truncate">
                  {user.role === 'ADMIN' ? (t.roleAdmin || 'مدير النظام') :
                   user.role === 'MANAGER' ? (t.roleManager || 'مدير') :
                   user.role === 'CASHIER' ? (t.roleCashier || 'كاشير') :
                   (t.roleViewer || 'مشاهد')}
                </p>
              </div>
            </div>
          </div>
        )}
        <SidebarMenu>
          {/* Language Toggle */}
          <SidebarMenuItem>
            <SidebarMenuButton onClick={toggleLanguage} tooltip={t.language}>
              <Languages className="size-4" />
              <span>{locale === 'ar' ? 'English' : 'العربية'}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          {/* Theme Toggle */}
          <SidebarMenuItem>
            <SidebarMenuButton onClick={toggleTheme} tooltip={t.toggleTheme}>
              {theme === 'dark' ? (
                <Sun className="size-4" />
              ) : (
                <Moon className="size-4" />
              )}
              <span>{theme === 'dark' ? t.lightMode : t.darkMode}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          {/* Logout */}
          <SidebarMenuItem>
            <SidebarMenuButton onClick={handleSignOut} tooltip={t.logout || 'تسجيل الخروج'}>
              <LogOut className="size-4" />
              <span>{t.logout || 'تسجيل الخروج'}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
