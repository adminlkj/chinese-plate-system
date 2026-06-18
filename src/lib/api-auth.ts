/**
 * ═══════════════════════════════════════════════════════════════════
 * 3-Layer Permission Architecture
 * ═══════════════════════════════════════════════════════════════════
 *
 * LAYER 1: EXPLICIT PERMISSIONS
 *   Direct permissions from UserPermission records + role defaults.
 *   These are the permissions the admin explicitly assigned.
 *   "Can the user see the screen?" → This is Layer 1.
 *
 * LAYER 2: CONTEXT PERMISSIONS
 *   Feature contexts that require data from other screens.
 *   A context is NOT a permission — it's a bounded, traceable access scope.
 *   POS needs products/customers to function → POS_CONTEXT grants READ.
 *   "What does this feature need to work?" → This is Layer 2.
 *   IMPORTANT: Context access NEVER overrides explicit access — it only fills gaps.
 *   Context access is always READ-only and traceable (audit-logged).
 *
 * LAYER 3: BUSINESS RULES
 *   Operational requirements that are NOT permissions.
 *   "Is the shift open?" / "Does the user have branch access?" → This is Layer 3.
 *   These are enforced independently and produce different error codes.
 *
 * ═══════════════════════════════════════════════════════════════════
 * WHY 3 LAYERS?
 * ═══════════════════════════════════════════════════════════════════
 * ❌ OLD: POS → "inherits" products permission (implied permanent access)
 * ✅ NEW: POS → opens a "context" where products READ is needed
 *
 * The difference:
 * - "Inheritance" implies the user NOW HAS products permission permanently
 * - "Context" says: "Within the POS context, products READ is needed"
 * - Context is bounded (only inside POS), traceable (audit log shows why),
 *   and cannot escalate (always READ, never WRITE)
 *
 * This prevents "Implicit Permissions Explosion":
 * - You can always answer: "Who gave access?" → Layer 1 or Layer 2 (which context?)
 * - Audit logs can distinguish: explicit READ vs context-granted READ
 * - Future features add their own contexts without polluting other permissions
 * ═══════════════════════════════════════════════════════════════════
 */

import { getToken, decode } from 'next-auth/jwt';
import { NextRequest, NextResponse } from 'next/server';
import { isBranchAllowed } from './branch-resolver';

// ─── Auth Result Types ────────────────────────────────────────────

export interface AuthResult {
  authenticated: true;
  userId: string;
  email: string;
  role: string;
  allowedBranches: string[]; // Parsed array of branch codes, empty = all branches
  permissions: { screen: string; accessLevel: string }[];
}

export interface AuthError {
  authenticated: false;
  response: NextResponse;
}

// The cookie name must match auth.ts configuration:
// - In production: __Secure-next-auth.session-token (HTTPS only, requires Secure flag)
// - In development: next-auth.session-token (HTTP allowed)
const SESSION_COOKIE_NAME = process.env.NODE_ENV === 'production'
  ? '__Secure-next-auth.session-token'
  : 'next-auth.session-token';

// ─── JWT Token Extraction ─────────────────────────────────────────

/**
 * Extract JWT token from request headers or cookies.
 *
 * Priority:
 * 1. Authorization: Bearer <token> header (reliable in all environments)
 * 2. Cookie-based next-auth session token (fallback)
 */
async function extractToken(request?: NextRequest): Promise<any> {
  const secret = process.env.NEXTAUTH_SECRET;

  // ─── Strategy 1: Authorization header ──────────────────────
  try {
    let authHeader: string | null = null;

    if (request) {
      authHeader = request.headers.get('authorization');
    } else {
      const { headers } = await import('next/headers');
      const heads = await headers();
      authHeader = heads.get('authorization');
    }

    if (authHeader?.startsWith('Bearer ')) {
      const tokenString = authHeader.substring(7);
      if (tokenString) {
        const decoded = await decode({ token: tokenString, secret: secret! });
        if (decoded) return decoded;
      }
    }
  } catch (error) {
    // Fall through to cookie method
  }

  // ─── Strategy 2: Cookie-based auth (fallback) ──────────────
  if (request) {
    return await getToken({
      req: request,
      secret: secret!,
      cookieName: SESSION_COOKIE_NAME,
    });
  }

  try {
    const { headers } = await import('next/headers');
    const heads = await headers();

    const host = heads.get('host') || 'localhost:3000';
    const url = new URL(`http://${host}/api/auth/session`);
    const req = new NextRequest(url, { headers: heads });

    return await getToken({
      req,
      secret: secret!,
      cookieName: SESSION_COOKIE_NAME,
    });
  } catch (error) {
    return null;
  }
}

/**
 * Parse allowedBranches from JWT token value (JSON string or null).
 * Returns empty array if null/empty (meaning ALL branches allowed).
 */
function parseAllowedBranches(raw: string | null | undefined): string[] {
  if (!raw) return []; // empty array = all branches allowed
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((b: any) => typeof b === 'string');
  } catch {}
  return [];
}

// ═══════════════════════════════════════════════════════════════════
// AUTHENTICATION (Pre-Permission Check)
// ═══════════════════════════════════════════════════════════════════

/**
 * Require authentication for an API route.
 * Checks Authorization header first, then falls back to cookies.
 */
export async function requireAuth(request?: NextRequest): Promise<AuthResult | AuthError> {
  try {
    const token = await extractToken(request);

    if (!token) {
      return {
        authenticated: false,
        response: NextResponse.json(
          { error: 'يجب تسجيل الدخول أولاً' },
          { status: 401 }
        ),
      };
    }

    return {
      authenticated: true,
      userId: token.id as string || '',
      email: token.email as string || '',
      role: token.role as string || 'VIEWER',
      allowedBranches: parseAllowedBranches(token.allowedBranches as string | null | undefined),
      permissions: token.permissions as { screen: string; accessLevel: string }[] || [],
    };
  } catch (error) {
    console.error('[api-auth] Auth check failed:', error);
    return {
      authenticated: false,
      response: NextResponse.json(
        { error: 'فشل في التحقق من الجلسة' },
        { status: 401 }
      ),
    };
  }
}

/**
 * Require a specific role (ADMIN, MANAGER, CASHIER, VIEWER) for an API route.
 */
export async function requireRole(minRole: 'ADMIN' | 'MANAGER' | 'CASHIER' | 'VIEWER', request?: NextRequest): Promise<AuthResult | AuthError> {
  const auth = await requireAuth(request);
  if (!auth.authenticated) return auth;

  const roleHierarchy = { ADMIN: 4, MANAGER: 3, CASHIER: 2, VIEWER: 1 };
  const userLevel = roleHierarchy[auth.role as keyof typeof roleHierarchy] || 0;
  const requiredLevel = roleHierarchy[minRole];

  if (userLevel < requiredLevel) {
    return {
      authenticated: false,
      response: NextResponse.json(
        { error: 'ليس لديك صلاحية كافية لهذه العملية' },
        { status: 403 }
      ),
    };
  }

  return auth;
}

// ═══════════════════════════════════════════════════════════════════
// LAYER 1: EXPLICIT PERMISSIONS
// ═══════════════════════════════════════════════════════════════════
// Direct permissions from UserPermission records + role defaults.
// "Can the user see the screen?" → This is Layer 1.
// ═══════════════════════════════════════════════════════════════════

/**
 * Role-based default permissions when no explicit permissions are set.
 * These are ONLY used when a user has ZERO explicit permissions in the DB.
 * Once the admin configures ANY permission, role defaults are ignored entirely.
 */
const ROLE_DEFAULTS: Record<string, Record<string, string>> = {
  MANAGER: {
    dashboard: 'FULL', pos: 'FULL', 'sales-invoices': 'FULL',
    'products-inventory': 'FULL', customers: 'FULL', suppliers: 'FULL',
    transactions: 'EDIT', journal: 'READ', ledger: 'READ',
    'trial-balance': 'READ', 'financial-center': 'READ',
    'income-statement': 'READ', 'cash-flow': 'READ',
    'advanced-reports': 'FULL',
    payroll: 'FULL',
    vat: 'FULL',
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
    vat: 'NONE',
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
    vat: 'READ',
    'chart-of-accounts': 'READ', settings: 'NONE', users: 'NONE',
    'audit-log': 'READ',
  },
};

/**
 * Get the EXPLICIT access level for a screen (Layer 1 only).
 *
 * Resolution order:
 * 1. ADMIN → always FULL
 * 2. Explicit UserPermission record → use that level
 * 3. If user has ANY explicit permissions → unlisted screens are NONE
 * 4. No explicit permissions → fall back to ROLE_DEFAULTS
 *
 * This function does NOT consider contexts (Layer 2).
 */
export function getExplicitAccessLevel(auth: AuthResult, screen: string): string {
  // ADMIN always has FULL access
  if (auth.role === 'ADMIN') return 'FULL';

  // Check explicit permissions first (they override defaults)
  const perm = auth.permissions.find(p => p.screen === screen);
  if (perm) return perm.accessLevel;

  // If user has ANY explicit permissions set in the database,
  // do NOT fall back to role defaults for unlisted screens.
  // When admin explicitly configures permissions, only the granted screens
  // should be accessible — all others must be NONE.
  if (auth.permissions && auth.permissions.length > 0) {
    return 'NONE';
  }

  // No explicit permissions set — fall back to role defaults
  const roleDefaults = ROLE_DEFAULTS[auth.role];
  return roleDefaults?.[screen] || 'NONE';
}

// ═══════════════════════════════════════════════════════════════════
// LAYER 2: CONTEXT PERMISSIONS
// ═══════════════════════════════════════════════════════════════════
// Feature contexts that require data from other screens.
// A context is NOT a permission — it's a bounded, traceable access scope.
// "What does this feature need to work?" → This is Layer 2.
//
// KEY RULES:
// - Context access NEVER overrides explicit access — it only fills gaps
// - Context access is always READ-only (never WRITE/EDIT/FULL)
// - Context access is traceable (audit log can show which context granted access)
// - Contexts are bounded: they only apply within the feature's scope
// ═══════════════════════════════════════════════════════════════════

/**
 * A feature context defines what data a feature needs to function.
 * This is NOT a permission — it's a declaration of dependencies.
 *
 * Example: POS needs products and customers to show in the POS screen.
 * Without this context, a POS-only user would see empty lists.
 *
 * The context grants READ-only access to dependency screens,
 * and ONLY when the user has access to the context's primary screen.
 */
export interface FeatureContext {
  /** Unique identifier for this context (e.g., 'pos') */
  id: string;
  /** Human-readable label (English) */
  label: string;
  /** Human-readable label (Arabic) */
  labelAr: string;
  /** Description of why this context exists */
  description: string;
  /** The screens this context depends on and what access level they need */
  dependencies: Record<string, {
    /** Access level granted by this context (always READ) */
    accessLevel: 'READ';
    /** Why this dependency exists (English) */
    reason: string;
    /** Why this dependency exists (Arabic) */
    reasonAr: string;
  }>;
}

/**
 * POS Context — the most critical context in the system.
 *
 * POS is a "Root Feature" that requires product and customer data.
 * Without this context, a user with ONLY POS permission would see:
 * - Empty product list (can't add items)
 * - Empty customer list (can't assign customers)
 * = A completely broken POS experience
 *
 * IMPORTANT: This context only grants READ access, never WRITE.
 * POS users can READ products and customers, but cannot EDIT them.
 * To edit products/customers, the user needs explicit EDIT permission.
 */
export const POS_CONTEXT: FeatureContext = {
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

/**
 * All registered feature contexts.
 * Add new contexts here as the system grows.
 * Each context is independent — no context depends on another context.
 */
const FEATURE_CONTEXTS: FeatureContext[] = [POS_CONTEXT];

/**
 * Check if a user has access to a context's primary screen.
 * A context is "active" for a user if they have explicit access to its primary screen.
 */
function isContextActive(auth: AuthResult, contextId: string): boolean {
  if (auth.role === 'ADMIN') return true; // Admin always has all contexts active

  const context = FEATURE_CONTEXTS.find(c => c.id === contextId);
  if (!context) return false;

  // The context's primary screen is the same as its id (e.g., 'pos' for POS_CONTEXT)
  const primaryAccess = getExplicitAccessLevel(auth, context.id);
  return primaryAccess !== 'NONE';
}

/**
 * Get the access level granted by contexts (Layer 2 only).
 *
 * If the user has access to a context's primary screen,
 * and the requested screen is a dependency of that context,
 * return the context-granted access level (always READ).
 *
 * @param auth - The authenticated user
 * @param screen - The screen being accessed
 * @param contextId - Optional: limit check to a specific context
 * @returns 'READ' if a context grants access, 'NONE' otherwise
 */
export function getContextAccessLevel(auth: AuthResult, screen: string, contextId?: string): string {
  for (const ctx of FEATURE_CONTEXTS) {
    // If a specific context was requested, only check that one
    if (contextId && ctx.id !== contextId) continue;

    // User must have access to the context's primary screen
    if (!isContextActive(auth, ctx.id)) continue;

    // Check if the requested screen is a dependency of this context
    const dep = ctx.dependencies[screen];
    if (dep) {
      return dep.accessLevel; // Always 'READ'
    }
  }
  return 'NONE';
}

/**
 * Get the context that grants access to a screen, if any.
 * Useful for audit logging: "Access to products-inventory granted by POS_CONTEXT"
 */
export function getAccessGrantingContext(auth: AuthResult, screen: string): FeatureContext | null {
  for (const ctx of FEATURE_CONTEXTS) {
    if (!isContextActive(auth, ctx.id)) continue;
    if (ctx.dependencies[screen]) return ctx;
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════
// COMBINED: EFFECTIVE ACCESS LEVEL (Layer 1 + Layer 2)
// ═══════════════════════════════════════════════════════════════════
// Merges Explicit (Layer 1) + Context (Layer 2) permissions.
// Context access NEVER overrides explicit access — it only fills gaps.
// ═══════════════════════════════════════════════════════════════════

/**
 * Get effective access level for a screen, combining Layer 1 + Layer 2.
 *
 * Resolution:
 * 1. Layer 1 (Explicit): If the user has explicit access, that's the answer.
 * 2. Layer 2 (Context): If explicit is NONE, check if any active context grants access.
 * 3. Result: The higher of explicit and context access.
 *
 * @param auth - The authenticated user
 * @param screen - The screen being accessed
 * @param contextId - Optional: limit context check to a specific context
 * @returns The effective access level: 'NONE', 'READ', 'EDIT', or 'FULL'
 */
export function getEffectiveAccessLevel(auth: AuthResult, screen: string, contextId?: string): string {
  // ADMIN always has FULL access
  if (auth.role === 'ADMIN') return 'FULL';

  // Layer 1: Explicit permissions always take priority
  const explicit = getExplicitAccessLevel(auth, screen);
  if (explicit !== 'NONE') return explicit;

  // Layer 2: Context permissions fill gaps (only READ level, never WRITE)
  const contextAccess = getContextAccessLevel(auth, screen, contextId);
  return contextAccess; // 'READ' or 'NONE'
}

// ═══════════════════════════════════════════════════════════════════
// LAYER 3: BUSINESS RULES
// ═══════════════════════════════════════════════════════════════════
// Operational requirements that are NOT permissions.
// "Is the shift open?" / "Does the user have branch access?" → Layer 3.
// These are enforced independently and produce different error codes.
// ═══════════════════════════════════════════════════════════════════

/**
 * BUSINESS RULE: Branch Access
 *
 * Assert that the authenticated user has access to the specified branch.
 *
 * Rules:
 * - ADMIN users always have access to all branches
 * - If allowedBranches is empty (not set), user has access to ALL branches
 * - If allowedBranches is set, user can only access branches in that list
 *
 * This is a BUSINESS RULE, not a permission.
 * It's enforced independently and produces a 403 with a different error code.
 *
 * Returns AuthResult if access is granted, or AuthError with 403 if denied.
 */
export function assertBranchAccess(auth: AuthResult, branch: string | null | undefined): AuthResult | AuthError {
  if (!branch) return auth; // No branch specified = no branch restriction needed

  // ADMIN always has access to all branches
  if (auth.role === 'ADMIN') return auth;

  // Empty allowedBranches = all branches allowed (no restriction set)
  if (auth.allowedBranches.length === 0) return auth;

  // Tolerant membership check: handles both UUID-to-UUID (post-migration) and
  // legacy code-based allowedBranches (defensive — login API now normalizes
  // codes to UUIDs at token-issuance time, but old JWTs may still be in flight).
  // Uses isBranchAllowed from branch-resolver for the canonical logic.
  if (isBranchAllowed(branch, auth.allowedBranches)) return auth;

  return {
    authenticated: false,
    response: NextResponse.json(
      { error: 'ليس لديك صلاحية الوصول لهذا الفرع', code: 'FORBIDDEN_BRANCH' },
      { status: 403 }
    ),
  };
}

/**
 * Get the list of branches the user is allowed to access.
 * Returns null if all branches are allowed (no restriction).
 */
export function getUserAllowedBranches(auth: AuthResult): string[] | null {
  if (auth.role === 'ADMIN') return null; // All branches
  if (auth.allowedBranches.length === 0) return null; // No restriction = all branches
  return auth.allowedBranches;
}

// ═══════════════════════════════════════════════════════════════════
// ACCESS CHECK HELPERS (Convenience Functions)
// ═══════════════════════════════════════════════════════════════════
// These combine the 3 layers into convenient check functions
// for use in API route handlers.
// ═══════════════════════════════════════════════════════════════════

/**
 * Require write access (EDIT or FULL) for a specific screen.
 * Contexts (Layer 2) only grant READ — this requires explicit WRITE access.
 */
export async function requireWriteAccess(screen: string, request?: NextRequest): Promise<AuthResult | AuthError> {
  const auth = await requireAuth(request);
  if (!auth.authenticated) return auth;

  if (auth.role === 'ADMIN') return auth;

  // Write access requires explicit permission (Layer 1 only)
  // Contexts (Layer 2) never grant write access
  const explicitLevel = getExplicitAccessLevel(auth, screen);
  if (explicitLevel === 'EDIT' || explicitLevel === 'FULL') return auth;

  return {
    authenticated: false,
    response: NextResponse.json(
      { error: 'ليس لديك صلاحية الكتابة على هذه الشاشة', code: 'FORBIDDEN_WRITE' },
      { status: 403 }
    ),
  };
}

/**
 * Check write access (EDIT or FULL) using an already-authenticated result.
 * More efficient than requireWriteAccess() since it avoids re-decoding the JWT.
 * Contexts (Layer 2) only grant READ — this requires explicit WRITE access.
 */
export function checkWriteAccess(auth: AuthResult, screen: string): AuthResult | AuthError {
  if (auth.role === 'ADMIN') return auth;

  // Write access requires explicit permission (Layer 1 only)
  const explicitLevel = getExplicitAccessLevel(auth, screen);
  if (explicitLevel === 'EDIT' || explicitLevel === 'FULL') return auth;

  return {
    authenticated: false,
    response: NextResponse.json(
      { error: 'ليس لديك صلاحية الكتابة على هذه الشاشة', code: 'FORBIDDEN_WRITE' },
      { status: 403 }
    ),
  };
}

/**
 * Check read access using an already-authenticated result.
 * READ, EDIT, and FULL access levels all grant read permission.
 * Contexts (Layer 2) can grant READ access to dependency screens.
 *
 * @param auth - The authenticated user
 * @param screen - The screen being accessed
 * @param contextId - Optional: if specified, only check this context for Layer 2 access
 */
export function checkReadAccess(auth: AuthResult, screen: string, contextId?: string): AuthResult | AuthError {
  if (auth.role === 'ADMIN') return auth;

  const level = getEffectiveAccessLevel(auth, screen, contextId);
  if (level !== 'NONE') return auth;

  return {
    authenticated: false,
    response: NextResponse.json(
      { error: 'ليس لديك صلاحية الوصول لهذه الشاشة', code: 'FORBIDDEN_READ' },
      { status: 403 }
    ),
  };
}

// ═══════════════════════════════════════════════════════════════════
// SECURITY UTILITIES
// ═══════════════════════════════════════════════════════════════════

/**
 * Sanitize HTML to prevent XSS attacks.
 */
export function sanitizeHtml(str: string | null | undefined): string {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/**
 * Strip HTML tags from user input to prevent stored XSS.
 * Removes all <tag>...</tag> patterns and HTML entities.
 * Use this on all user-supplied string fields before storing in DB.
 */
export function sanitizeInput(str: string | null | undefined): string {
  if (!str) return '';
  return String(str)
    .replace(/<[^>]*>/g, '')
    .replace(/\bon\w+\s*=\s*['"][^'"]*['"]/gi, '')
    .replace(/javascript\s*:/gi, '')
    .replace(/data\s*:\s*text\/html/gi, '')
    .trim();
}

/**
 * Validate and cap pageSize to prevent DoS attacks.
 */
export function safePageSize(requested: number | null, max = 200, defaultSize = 50): number {
  if (!requested || requested <= 0) return defaultSize;
  return Math.min(requested, max);
}
