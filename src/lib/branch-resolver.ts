/**
 * Branch Resolver Utility
 *
 * Single source of truth for branch resolution.
 * Converts any branch identifier (UUID, code, or name) into a canonical branchId (UUID).
 *
 * USAGE RULE (NON-NEGOTIABLE):
 *   Before ANY create/update/query involving a branch, resolve the input:
 *     const branchId = await resolveBranchId(req.body.branch)
 *   Then ALWAYS use `branchId` (UUID) — NEVER use the raw `branch` string.
 */

import { db } from './db';

/**
 * Cache of branch lookups to avoid repeated DB queries within a single request.
 * Key: input string (code/name/id), Value: branchId (UUID)
 */
const branchCache = new Map<string, string>();

/**
 * Resolve any branch identifier to its canonical UUID (branchId).
 *
 * Accepts:
 *   - Branch UUID (cuid) — returned as-is if valid
 *   - Branch code (e.g., "CHINA_TOWN", "PALACE_INDIA")
 *   - Branch name (e.g., "تشينا تاون")
 *
 * @param input - The branch identifier (id, code, or name)
 * @returns The canonical branchId (UUID)
 * @throws Error if the branch cannot be found
 */
export async function resolveBranchId(input: string | undefined | null): Promise<string> {
  if (!input || typeof input !== 'string' || !input.trim()) {
    throw new Error('branchId is required');
  }

  const trimmed = input.trim();

  // Check cache first
  if (branchCache.has(trimmed)) {
    return branchCache.get(trimmed)!;
  }

  // Look up the branch by id, code, or name
  const branch = await db.branch.findFirst({
    where: {
      OR: [
        { id: trimmed },
        { code: trimmed },
        { name: trimmed },
      ],
    },
    select: { id: true },
  });

  if (!branch) {
    throw new Error(`Invalid branch: ${trimmed}`);
  }

  // Cache the result
  branchCache.set(trimmed, branch.id);

  return branch.id;
}

/**
 * Resolve a branch identifier, returning null instead of throwing on failure.
 * Useful for optional branch parameters in queries.
 */
export async function resolveBranchIdOrNull(input: string | undefined | null): Promise<string | null> {
  if (!input || typeof input !== 'string' || !input.trim()) {
    return null;
  }

  try {
    return await resolveBranchId(input);
  } catch {
    return null;
  }
}

/**
 * Get the default (first active) branchId.
 * Used as a fallback when no branch is specified.
 */
export async function getDefaultBranchId(): Promise<string> {
  // Check cache for a "default" marker
  if (branchCache.has('__DEFAULT__')) {
    return branchCache.get('__DEFAULT__')!;
  }

  const branch = await db.branch.findFirst({
    where: { isActive: true },
    orderBy: { sortOrder: 'asc' },
    select: { id: true },
  });

  if (!branch) {
    throw new Error('No active branches found. Please create a branch first.');
  }

  branchCache.set('__DEFAULT__', branch.id);

  return branch.id;
}

/**
 * Ensure a branchId is valid. Throws if the branch does not exist.
 * Use this as a guard before any create/update operation.
 *
 * @example
 *   if (!data.branchId) throw new Error('branchId is required');
 *   await ensureBranchExists(data.branchId);
 */
export async function ensureBranchExists(branchId: string): Promise<void> {
  if (!branchId) {
    throw new Error('branchId is required');
  }

  const exists = await db.branch.findUnique({
    where: { id: branchId },
    select: { id: true },
  });

  if (!exists) {
    throw new Error(`Invalid branchId: ${branchId}`);
  }
}

/**
 * Clear the branch cache. Useful in long-running processes or tests.
 */
export function clearBranchCache(): void {
  branchCache.clear();
}

/**
 * Normalize an array of branch identifiers (may contain codes, UUIDs, or names)
 * into an array of canonical branchId UUIDs.
 *
 * Used to normalize `user.allowedBranches` at login and at save time so that
 * `assertBranchAccess` can do a simple UUID-to-UUID comparison without any
 * DB lookup inside the hot path.
 *
 * - Empty/null input → returns [] (meaning "all branches allowed")
 * - Entries that cannot be resolved are silently dropped (defensive)
 * - Deduplicates the result
 */
export async function normalizeAllowedBranches(
  input: string[] | string | null | undefined
): Promise<string[]> {
  if (!input) return [];
  let arr: string[] = [];
  if (typeof input === 'string') {
    try {
      const parsed = JSON.parse(input);
      if (Array.isArray(parsed)) arr = parsed.filter((x) => typeof x === 'string');
      else arr = [];
    } catch {
      // Treat as comma-separated string
      arr = input.split(',').map((s) => s.trim()).filter(Boolean);
    }
  } else if (Array.isArray(input)) {
    arr = input.filter((x) => typeof x === 'string');
  }

  if (arr.length === 0) return [];

  // Resolve each entry to its UUID (silently drop unresolvable entries)
  const resolved: string[] = [];
  for (const entry of arr) {
    const id = await resolveBranchIdOrNull(entry);
    if (id) resolved.push(id);
  }

  // Deduplicate
  return Array.from(new Set(resolved));
}

/**
 * Synchronous tolerant membership check for branch access.
 *
 * Compares the given branchId (UUID) against an allowedBranches list that may
 * contain UUIDs (post-migration) or legacy codes. This is a DEFENSIVE fallback
 * — the canonical fix is to normalize allowedBranches to UUIDs at login/save
 * time via `normalizeAllowedBranches`. This sync helper exists to catch any
 * edge cases (e.g. an old JWT still in flight) without requiring a DB lookup
 * inside the hot path.
 *
 * Rules:
 *  - Empty allowedBranches → allowed (no restriction)
 *  - Exact UUID match → allowed
 *  - If the input looks like a UUID but allowedBranches contains codes only,
 *    we cannot resolve without DB → DENY (safe default). The caller should
 *    re-issue the JWT via /api/admin/login to get a normalized token.
 */
export function isBranchAllowed(
  branchId: string | null | undefined,
  allowedBranches: string[]
): boolean {
  if (!branchId) return true; // No branch specified = no restriction
  if (!allowedBranches || allowedBranches.length === 0) return true; // No restriction
  if (allowedBranches.includes(branchId)) return true; // Exact match (UUID-to-UUID)
  // Defensive: if allowedBranches contains entries that are NOT UUIDs (legacy codes),
  // we cannot safely match a UUID input against them without DB. Deny and let the
  // user re-authenticate to get a normalized JWT.
  return false;
}

/**
 * Get the effective tax rate (as a fraction, e.g. 0.15) for a given branch.
 *
 * Resolution order:
 *  1. branch.taxRate (per-branch override) — if set
 *  2. global `taxRate` Setting (system-wide default) — if set
 *  3. 0.15 (15% Saudi VAT) — hardcoded fallback
 *
 * @param branchId - The branch UUID (required)
 * @param globalTaxRateSetting - The value of the global `taxRate` Setting (e.g. "15"), or null
 * @returns The effective tax rate as a fraction (e.g. 0.15 for 15%)
 */
export async function getEffectiveTaxRate(
  branchId: string,
  globalTaxRateSetting?: string | null
): Promise<number> {
  // Try the branch override first
  const branch = await db.branch.findUnique({
    where: { id: branchId },
    select: { taxRate: true },
  });
  if (branch?.taxRate !== null && branch?.taxRate !== undefined) {
    const rate = typeof branch.taxRate === 'number' ? branch.taxRate : parseFloat(String(branch.taxRate));
    if (Number.isFinite(rate)) return rate / 100;
  }
  // Fall back to the global setting
  if (globalTaxRateSetting) {
    const rate = parseFloat(globalTaxRateSetting);
    if (Number.isFinite(rate)) return rate / 100;
  }
  // Hardcoded fallback
  return 0.15;
}

