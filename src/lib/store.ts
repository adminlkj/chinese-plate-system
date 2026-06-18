import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type Screen =
  | 'dashboard'
  | 'chart-of-accounts'
  | 'transactions'
  | 'customers'
  | 'suppliers'
  | 'pos'
  | 'products-inventory'
  | 'sales-invoices'
  | 'journal'
  | 'ledger'
  | 'trial-balance'
  | 'financial-center'
  | 'income-statement'
  | 'cash-flow'
  | 'advanced-reports'
  | 'payroll'
  | 'settings'
  | 'users'
  | 'audit-log';

export type Locale = 'ar' | 'en';

export type AccessLevel = 'NONE' | 'READ' | 'EDIT' | 'FULL';

export interface UserPermission {
  screen: string;
  accessLevel: AccessLevel;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  nameEn?: string;
  role: string;
  allowedBranches: string[]; // Array of branch codes the user can access, empty = all branches
  permissions: UserPermission[];
}

// ═══════════════════════════════════════════════════════════════════
// 3-LAYER PERMISSION ARCHITECTURE (Frontend Mirror)
// ═══════════════════════════════════════════════════════════════════
// This mirrors the server-side 3-layer model in api-auth.ts:
//
// LAYER 1: EXPLICIT PERMISSIONS
//   Direct permissions from UserPermission records + role defaults.
//   "Can the user see the screen?" → Layer 1.
//
// LAYER 2: CONTEXT PERMISSIONS
//   Feature contexts that require data from other screens.
//   A context is NOT a permission — it's a bounded, traceable access scope.
//   POS needs products/customers to function → POS_CONTEXT grants READ.
//   "What does this feature need to work?" → Layer 2.
//   KEY: Context access NEVER overrides explicit — it only fills gaps.
//   KEY: Context access is always READ-only, never WRITE.
//
// LAYER 3: BUSINESS RULES
//   Operational requirements that are NOT permissions.
//   "Is the shift open?" / "Does the user have branch access?" → Layer 3.
// ═══════════════════════════════════════════════════════════════════

// ─── Feature Context Definition ───────────────────────────────────

interface FeatureContext {
  id: string;
  label: string;
  labelAr: string;
  description: string;
  dependencies: Record<string, {
    accessLevel: 'READ';
    reason: string;
    reasonAr: string;
  }>;
}

/**
 * POS Context — the most critical context in the system.
 *
 * POS is a "Root Feature" that requires product and customer data.
 * This context grants READ access to products-inventory and customers
 * ONLY when the user has access to the POS screen.
 *
 * IMPORTANT: This is a CONTEXT, not a PERMISSION.
 * - POS does NOT "inherit" products permission
 * - POS OPENS a context where products READ is needed
 * - The access is bounded (only within POS), traceable, and READ-only
 */
const POS_CONTEXT: FeatureContext = {
  id: 'pos',
  label: 'POS',
  labelAr: 'نقطة البيع',
  description: 'Point of Sale — requires product and customer data to function',
  dependencies: {
    'products-inventory': {
      accessLevel: 'READ',
      reason: 'Product list needed to add items to invoices',
      reasonAr: 'قائمة المنتجات مطلوبة لإضافة أصناف للفواتير',
    },
    'customers': {
      accessLevel: 'READ',
      reason: 'Customer selection required for invoice assignment',
      reasonAr: 'اختيار العميل مطلوب لتعيين الفاتورة',
    },
  },
};

const FEATURE_CONTEXTS: FeatureContext[] = [POS_CONTEXT];

// ─── Role-Based Defaults (Layer 1 fallback) ───────────────────────

const ROLE_DEFAULTS: Record<string, Record<string, AccessLevel>> = {
  MANAGER: {
    dashboard: 'FULL', pos: 'FULL', 'sales-invoices': 'FULL',
    'products-inventory': 'FULL', customers: 'FULL', suppliers: 'FULL',
    transactions: 'EDIT', journal: 'READ', ledger: 'READ',
    'trial-balance': 'READ', 'financial-center': 'READ',
    'income-statement': 'READ', 'cash-flow': 'READ',
    'advanced-reports': 'FULL',
    payroll: 'FULL',
    'chart-of-accounts': 'READ', settings: 'READ', users: 'READ',
    'audit-log': 'FULL',
  },
  CASHIER: {
    dashboard: 'READ', pos: 'FULL', 'sales-invoices': 'READ',
    'products-inventory': 'READ', customers: 'READ', suppliers: 'NONE',
    transactions: 'NONE', journal: 'NONE', ledger: 'NONE',
    'trial-balance': 'NONE', 'financial-center': 'NONE',
    'income-statement': 'NONE', 'cash-flow': 'NONE',
    'advanced-reports': 'READ',
    payroll: 'NONE',
    'chart-of-accounts': 'NONE', settings: 'NONE', users: 'NONE',
    'audit-log': 'NONE',
  },
  VIEWER: {
    dashboard: 'READ', pos: 'READ', 'sales-invoices': 'READ',
    'products-inventory': 'READ', customers: 'READ', suppliers: 'READ',
    transactions: 'READ', journal: 'READ', ledger: 'READ',
    'trial-balance': 'READ', 'financial-center': 'READ',
    'income-statement': 'READ', 'cash-flow': 'READ',
    'advanced-reports': 'READ',
    payroll: 'READ',
    'chart-of-accounts': 'READ', settings: 'NONE', users: 'NONE',
    'audit-log': 'READ',
  },
};

const ACCESS_LEVEL_ORDER: Record<AccessLevel, number> = {
  NONE: 0,
  READ: 1,
  EDIT: 2,
  FULL: 3,
};

// ═══════════════════════════════════════════════════════════════════
// STORE DEFINITION
// ═══════════════════════════════════════════════════════════════════

interface AppState {
  // Navigation
  currentScreen: Screen;
  setCurrentScreen: (screen: Screen) => void;
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  // Currency symbol
  currencySymbolUrl: string;
  setCurrencySymbolUrl: (url: string) => void;
  // Language
  locale: Locale;
  setLocale: (locale: Locale) => void;
  // Auth - PERSISTED to localStorage
  user: AuthUser | null;
  isAuthenticated: boolean;
  authToken: string | null; // JWT token for Authorization header
  // Auth methods
  login: (user: AuthUser, token?: string) => void;
  logout: () => void;
  // Auth initialization
  authReady: boolean; // true after first verify completes
  setAuthReady: (val: boolean) => void;

  // ─── LAYER 1: Explicit Permissions ────────────────────────────
  /** Get explicit access level (Layer 1 only — no context) */
  getExplicitAccessLevel: (screen: string) => AccessLevel;

  // ─── LAYER 2: Context Permissions ─────────────────────────────
  /** Get context-granted access level (Layer 2 only) */
  getContextAccessLevel: (screen: string, contextId?: string) => AccessLevel;
  /** Get the context that grants access to a screen (for audit/traceability) */
  getAccessGrantingContext: (screen: string) => FeatureContext | null;

  // ─── COMBINED: Effective Access Level (Layer 1 + Layer 2) ─────
  /** Get effective access level combining Layer 1 + Layer 2 */
  getAccessLevel: (screen: string, contextId?: string) => AccessLevel;
  /** Check if user has the required access level */
  hasAccess: (screen: string, required?: AccessLevel, contextId?: string) => boolean;
  /** Get the first accessible screen for the user */
  getFirstAccessibleScreen: () => Screen | null;

  // ─── LAYER 3: Business Rules ──────────────────────────────────
  /** Get allowed branches (null = all branches) */
  getAllowedBranches: () => string[] | null;
  /** Check if user can access a specific branch */
  canAccessBranch: (branchCode: string) => boolean;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      // Navigation
      currentScreen: 'dashboard',
      setCurrentScreen: (screen) => set({ currentScreen: screen }),
      sidebarOpen: true,
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      // Currency symbol
      currencySymbolUrl: '',
      setCurrencySymbolUrl: (url) => set({ currencySymbolUrl: url }),
      // Language
      locale: 'ar' as Locale,
      setLocale: (locale) => set({ locale }),
      // Auth - persisted
      user: null,
      isAuthenticated: false,
      authToken: null,
      // Auth methods
      login: (user: AuthUser, token?: string) => {
        // Also save token to localStorage for the API interceptor
        if (token) {
          try {
            localStorage.setItem('pos-auth-token', token);
          } catch {}
        }
        set({ user, isAuthenticated: true, authToken: token || null, authReady: true });
        // Auto-navigate to first accessible screen if current screen is inaccessible
        const { getAccessLevel, getFirstAccessibleScreen, setCurrentScreen, currentScreen } = get();
        const accessLevel = getAccessLevel(currentScreen);
        if (accessLevel === 'NONE') {
          const firstScreen = getFirstAccessibleScreen();
          if (firstScreen) setCurrentScreen(firstScreen);
        }
      },
      logout: () => {
        // Clear token from localStorage
        try {
          localStorage.removeItem('pos-auth-token');
        } catch {}
        set({ user: null, isAuthenticated: false, authToken: null, authReady: true });
      },
      // Auth initialization
      authReady: false,
      setAuthReady: (val) => set({ authReady: val }),

      // ═══════════════════════════════════════════════════════════
      // LAYER 1: EXPLICIT PERMISSIONS
      // ═══════════════════════════════════════════════════════════
      // Direct permissions from UserPermission records + role defaults.
      // "Can the user see the screen?" → This is Layer 1.
      // ═══════════════════════════════════════════════════════════

      getExplicitAccessLevel: (screen: string): AccessLevel => {
        const { user } = get();
        if (!user) return 'NONE';
        if (user.role === 'ADMIN') return 'FULL';

        // Check explicit permissions first (they override defaults)
        const perm = user.permissions.find((p) => p.screen === screen);
        if (perm) return perm.accessLevel as AccessLevel;

        // If user has ANY explicit permissions set in the database,
        // do NOT fall back to role defaults for unlisted screens.
        // When admin explicitly configures permissions, only the granted screens
        // should be accessible — all others must be NONE.
        if (user.permissions && user.permissions.length > 0) {
          return 'NONE';
        }

        // No explicit permissions set — fall back to role defaults
        const roleDefaults = ROLE_DEFAULTS[user.role];
        if (roleDefaults && roleDefaults[screen]) {
          return roleDefaults[screen];
        }

        return 'NONE';
      },

      // ═══════════════════════════════════════════════════════════
      // LAYER 2: CONTEXT PERMISSIONS
      // ═══════════════════════════════════════════════════════════
      // Feature contexts that require data from other screens.
      // A context is NOT a permission — it's a bounded, traceable access scope.
      // KEY: Context access NEVER overrides explicit — it only fills gaps.
      // KEY: Context access is always READ-only, never WRITE.
      // ═══════════════════════════════════════════════════════════

      getContextAccessLevel: (screen: string, contextId?: string): AccessLevel => {
        const { user, getExplicitAccessLevel } = get();
        if (!user) return 'NONE';
        if (user.role === 'ADMIN') return 'FULL'; // Admin doesn't need context

        for (const ctx of FEATURE_CONTEXTS) {
          // If a specific context was requested, only check that one
          if (contextId && ctx.id !== contextId) continue;

          // User must have access to the context's primary screen (Layer 1)
          const primaryAccess = getExplicitAccessLevel(ctx.id);
          if (primaryAccess === 'NONE') continue;

          // Check if the requested screen is a dependency of this context
          const dep = ctx.dependencies[screen];
          if (dep) {
            return dep.accessLevel; // Always 'READ'
          }
        }
        return 'NONE';
      },

      getAccessGrantingContext: (screen: string): FeatureContext | null => {
        const { user, getExplicitAccessLevel } = get();
        if (!user) return null;
        if (user.role === 'ADMIN') return null; // Admin doesn't need context

        for (const ctx of FEATURE_CONTEXTS) {
          const primaryAccess = getExplicitAccessLevel(ctx.id);
          if (primaryAccess === 'NONE') continue;
          if (ctx.dependencies[screen]) return ctx;
        }
        return null;
      },

      // ═══════════════════════════════════════════════════════════
      // COMBINED: EFFECTIVE ACCESS LEVEL (Layer 1 + Layer 2)
      // ═══════════════════════════════════════════════════════════
      // Merges Explicit (Layer 1) + Context (Layer 2) permissions.
      // Context access NEVER overrides explicit access — it only fills gaps.
      // ═══════════════════════════════════════════════════════════

      getAccessLevel: (screen: string, contextId?: string): AccessLevel => {
        const { user, getExplicitAccessLevel, getContextAccessLevel } = get();
        if (!user) return 'NONE';
        if (user.role === 'ADMIN') return 'FULL';

        // Layer 1: Explicit permissions always take priority
        const explicit = getExplicitAccessLevel(screen);
        if (explicit !== 'NONE') return explicit;

        // Layer 2: Context permissions fill gaps (only READ level, never WRITE)
        const contextAccess = getContextAccessLevel(screen, contextId);
        return contextAccess; // 'READ' or 'NONE'
      },

      hasAccess: (screen: string, required: AccessLevel = 'READ', contextId?: string): boolean => {
        const level = get().getAccessLevel(screen, contextId);
        return ACCESS_LEVEL_ORDER[level] >= ACCESS_LEVEL_ORDER[required];
      },

      getFirstAccessibleScreen: (): Screen | null => {
        const { user, getAccessLevel } = get();
        if (!user) return null;
        const allScreens: Screen[] = [
          'dashboard', 'chart-of-accounts', 'customers', 'suppliers',
          'transactions', 'pos', 'products-inventory', 'sales-invoices',
          'journal', 'ledger', 'trial-balance', 'financial-center',
          'income-statement', 'cash-flow', 'advanced-reports', 'payroll',
          'users', 'audit-log', 'settings'
        ];
        for (const screen of allScreens) {
          if (getAccessLevel(screen) !== 'NONE') return screen;
        }
        return null;
      },

      // ═══════════════════════════════════════════════════════════
      // LAYER 3: BUSINESS RULES
      // ═══════════════════════════════════════════════════════════
      // Operational requirements that are NOT permissions.
      // "Does the user have branch access?" → Layer 3.
      // ═══════════════════════════════════════════════════════════

      getAllowedBranches: (): string[] | null => {
        const { user } = get();
        if (!user) return null;
        if (user.role === 'ADMIN') return null; // Admin = all branches
        if (!user.allowedBranches || user.allowedBranches.length === 0) return null; // No restriction = all branches
        return user.allowedBranches;
      },
      canAccessBranch: (branchCode: string): boolean => {
        const { user } = get();
        if (!user) return false;
        if (user.role === 'ADMIN') return true;
        if (!user.allowedBranches || user.allowedBranches.length === 0) return true; // No restriction = all branches
        return user.allowedBranches.includes(branchCode);
      },
    }),
    {
      name: 'pos-auth-storage',
      storage: createJSONStorage(() => typeof window !== 'undefined' ? localStorage : (undefined as any)),
      partialize: (state) => ({
        user: state.user,
        isAuthenticated: state.isAuthenticated,
        authToken: state.authToken,
        locale: state.locale,
      }),
    }
  )
);

/**
 * Convenience hook for screen-level access control.
 * Returns whether the user can read, edit, or has full access to a screen.
 * Optionally accepts a contextId for Layer 2 context-aware access.
 */
export function useScreenAccess(screen: string, contextId?: string) {
  const getAccessLevel = useAppStore((s) => s.getAccessLevel);
  const level = getAccessLevel(screen, contextId);
  return {
    level,
    canRead: ACCESS_LEVEL_ORDER[level] >= ACCESS_LEVEL_ORDER['READ'],
    canEdit: ACCESS_LEVEL_ORDER[level] >= ACCESS_LEVEL_ORDER['EDIT'],
    canFull: ACCESS_LEVEL_ORDER[level] >= ACCESS_LEVEL_ORDER['FULL'],
    isNone: level === 'NONE',
  };
}
