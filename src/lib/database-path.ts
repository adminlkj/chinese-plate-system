/**
 * Database Path Resolution — Web/PostgreSQL Mode
 *
 * In the web deployment (Render + PostgreSQL), there is no local database file.
 * DATABASE_URL is a PostgreSQL connection string set via environment variables.
 * This module provides compatibility helpers for checking database configuration.
 */

/** Returns the raw DATABASE_URL value (may be empty if not configured) */
export function getDatabasePath(): string {
  return process.env.DATABASE_URL || '';
}

/** Returns database connection status information */
export function getDatabaseInfo() {
  const url = process.env.DATABASE_URL || '';
  return {
    isConfigured: url.length > 0,
    isPostgreSQL: url.startsWith('postgresql://'),
  };
}
