// ─── Audit Log Utility (سجل التدقيق) ──────────────────────────────────────
// Core audit logging for the Arabic accounting/POS system
// Immutable: records are never updated or deleted
// Non-throwing: audit logging should NEVER break the main operation

import { db } from '@/lib/db';

// ─── Types ────────────────────────────────────────────────────────────────

export type AuditAction =
  | 'CREATE'
  | 'UPDATE'
  | 'DELETE'
  | 'LOGIN'
  | 'LOGOUT'
  | 'FINALIZE'
  | 'RETURN'
  | 'POST'
  | 'CLOSE'
  | 'EXPORT'
  | 'IMPORT'
  | 'RESTORE'
  | 'RECOVER'
  | 'PURGE'
  | 'SETTINGS_CHANGE'
  | 'PERMISSION_CHANGE';

export type AuditEntity =
  | 'POS_INVOICE'
  | 'JOURNAL_ENTRY'
  | 'PRODUCT'
  | 'CUSTOMER'
  | 'SUPPLIER'
  | 'USER'
  | 'ACCOUNT'
  | 'SHIFT'
  | 'STOCK_TAKE'
  | 'STOCK_TRANSFER'
  | 'TRANSACTION'
  | 'PAYROLL_RUN'
  | 'EMPLOYEE'
  | 'VAT'
  | 'SETTING'
  | 'BACKUP'
  | 'SYSTEM'
  | 'AUTH';

export type AuditSeverity = 'INFO' | 'WARNING' | 'CRITICAL';

export type AuditCategory =
  | 'AUTH'
  | 'POS'
  | 'ACCOUNTING'
  | 'INVENTORY'
  | 'USERS'
  | 'SETTINGS'
  | 'SYSTEM'
  | 'BACKUP'
  | 'GENERAL';

// ─── Interface for auditLog params ────────────────────────────────────────

export interface AuditLogParams {
  action: AuditAction;
  entity: AuditEntity;
  entityId?: string;
  entityNumber?: string;
  description: string;
  details?: Record<string, unknown>;
  userId?: string;
  userName?: string;
  userRole?: string;
  branchId?: string;
  severity?: AuditSeverity;
  category?: AuditCategory;
  ipAddress?: string;
  userAgent?: string;
}

// ─── Main auditLog function ───────────────────────────────────────────────

/**
 * Create an audit log entry. Never throws errors — returns null on failure
 * so that audit logging never breaks the main operation.
 */
export async function auditLog(params: AuditLogParams) {
  try {
    const {
      action,
      entity,
      entityId,
      entityNumber,
      description,
      details,
      userId,
      userName,
      userRole,
      branchId,
      severity = 'INFO',
      category = 'GENERAL',
      ipAddress,
      userAgent,
    } = params;

    const record = await db.auditLog.create({
      data: {
        action,
        entity,
        entityId: entityId || null,
        entityNumber: entityNumber || null,
        description,
        details: details ? JSON.stringify(details) : null,
        userId: userId || null,
        userName: userName || null,
        userRole: userRole || null,
        branchId: branchId || null,
        severity,
        category,
        ipAddress: ipAddress || null,
        userAgent: userAgent || null,
      },
    });

    return record;
  } catch (error) {
    // Audit logging should NEVER break the main operation
    console.error('[AuditLog] Failed to create audit log entry:', error);
    return null;
  }
}

// ─── Helper Functions ─────────────────────────────────────────────────────

/** Log a login event */
export async function auditLogin(
  userId: string,
  userName: string,
  userRole: string,
  ipAddress?: string
) {
  return auditLog({
    action: 'LOGIN',
    entity: 'AUTH',
    description: `تسجيل دخول: ${userName}`,
    userId,
    userName,
    userRole,
    severity: 'INFO',
    category: 'AUTH',
    ipAddress,
  });
}

/** Log a logout event */
export async function auditLogout(
  userId: string,
  userName: string,
  userRole: string
) {
  return auditLog({
    action: 'LOGOUT',
    entity: 'AUTH',
    description: `تسجيل خروج: ${userName}`,
    userId,
    userName,
    userRole,
    severity: 'INFO',
    category: 'AUTH',
  });
}

/** Log a creation event */
export async function auditCreate(
  entity: AuditEntity,
  entityId: string,
  entityNumber: string,
  description: string,
  userId: string,
  userName: string,
  userRole: string,
  branchId?: string,
  details?: Record<string, unknown>
) {
  return auditLog({
    action: 'CREATE',
    entity,
    entityId,
    entityNumber,
    description,
    userId,
    userName,
    userRole,
    branchId,
    severity: 'INFO',
    category: mapEntityToCategory(entity),
    details,
  });
}

/** Log an update event */
export async function auditUpdate(
  entity: AuditEntity,
  entityId: string,
  entityNumber: string,
  description: string,
  userId: string,
  userName: string,
  userRole: string,
  branchId?: string,
  details?: Record<string, unknown>
) {
  return auditLog({
    action: 'UPDATE',
    entity,
    entityId,
    entityNumber,
    description,
    userId,
    userName,
    userRole,
    branchId,
    severity: 'INFO',
    category: mapEntityToCategory(entity),
    details,
  });
}

/** Log a delete event */
export async function auditDelete(
  entity: AuditEntity,
  entityId: string,
  entityNumber: string,
  description: string,
  userId: string,
  userName: string,
  userRole: string,
  branchId?: string
) {
  return auditLog({
    action: 'DELETE',
    entity,
    entityId,
    entityNumber,
    description,
    userId,
    userName,
    userRole,
    branchId,
    severity: 'WARNING',
    category: mapEntityToCategory(entity),
  });
}

/** Log a finalize/post event */
export async function auditFinalize(
  entity: AuditEntity,
  entityId: string,
  entityNumber: string,
  description: string,
  userId: string,
  userName: string,
  userRole: string,
  branchId?: string,
  details?: Record<string, unknown>
) {
  return auditLog({
    action: 'FINALIZE',
    entity,
    entityId,
    entityNumber,
    description,
    userId,
    userName,
    userRole,
    branchId,
    severity: 'INFO',
    category: mapEntityToCategory(entity),
    details,
  });
}

/** Log a return event */
export async function auditReturn(
  entity: AuditEntity,
  entityId: string,
  entityNumber: string,
  description: string,
  userId: string,
  userName: string,
  userRole: string,
  branchId?: string,
  details?: Record<string, unknown>
) {
  return auditLog({
    action: 'RETURN',
    entity,
    entityId,
    entityNumber,
    description,
    userId,
    userName,
    userRole,
    branchId,
    severity: 'WARNING',
    category: mapEntityToCategory(entity),
    details,
  });
}

/** Log a critical event */
export async function auditCritical(
  action: AuditAction,
  entity: AuditEntity,
  description: string,
  userId?: string,
  userName?: string,
  branchId?: string
) {
  return auditLog({
    action,
    entity,
    description,
    userId,
    userName,
    branchId,
    severity: 'CRITICAL',
    category: mapEntityToCategory(entity),
  });
}

/** Log a settings change event */
export async function auditSettingsChange(
  key: string,
  oldValue: string,
  newValue: string,
  userId: string,
  userName: string
) {
  return auditLog({
    action: 'SETTINGS_CHANGE',
    entity: 'SETTING',
    entityId: key,
    description: `تغيير الإعدادات: ${key}`,
    details: { key, oldValue, newValue },
    userId,
    userName,
    severity: 'WARNING',
    category: 'SETTINGS',
  });
}

/** Log a backup/restore event */
export async function auditBackup(
  action: AuditAction,
  description: string,
  userId?: string,
  userName?: string
) {
  return auditLog({
    action,
    entity: 'BACKUP',
    description,
    userId,
    userName,
    severity: action === 'RESTORE' || action === 'RECOVER' ? 'CRITICAL' : 'INFO',
    category: 'BACKUP',
  });
}

/** Log a system event */
export async function auditSystem(
  action: AuditAction,
  description: string,
  severity: AuditSeverity = 'INFO'
) {
  return auditLog({
    action,
    entity: 'SYSTEM',
    description,
    severity,
    category: 'SYSTEM',
  });
}

// ─── Internal helpers ─────────────────────────────────────────────────────

/** Map an entity type to its default audit category */
function mapEntityToCategory(entity: AuditEntity): AuditCategory {
  switch (entity) {
    case 'POS_INVOICE':
      return 'POS';
    case 'JOURNAL_ENTRY':
    case 'ACCOUNT':
    case 'TRANSACTION':
    case 'CUSTOMER':
    case 'SUPPLIER':
    case 'PAYROLL_RUN':
    case 'EMPLOYEE':
    case 'VAT':
      return 'ACCOUNTING';
    case 'PRODUCT':
    case 'STOCK_TAKE':
    case 'STOCK_TRANSFER':
      return 'INVENTORY';
    case 'USER':
      return 'USERS';
    case 'SETTING':
      return 'SETTINGS';
    case 'AUTH':
      return 'AUTH';
    case 'BACKUP':
      return 'BACKUP';
    case 'SYSTEM':
      return 'SYSTEM';
    default:
      return 'GENERAL';
  }
}
