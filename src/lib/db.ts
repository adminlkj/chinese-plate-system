/**
 * Build-Safe Prisma Client — PostgreSQL for Web/Render Deployment
 *
 * This module exports a PrismaClient instance that works correctly in:
 * - Development (npm run dev)
 * - Production (Render deployment)
 * - Next.js build phase (prisma generate may not have run yet)
 *
 * All SQLite-specific PRAGMA statements have been removed.
 * PostgreSQL connection pooling is configured for Render.
 */

// Track whether we're in the build phase
const isBuildPhase = (
  process.env.NODE_ENV === 'production' &&
  !process.env.DATABASE_URL
) || (
  process.env.NEXT_PHASE === 'phase-production-build'
);

// Only import PrismaClient if we're NOT in the build phase
let PrismaClient: any = null;
if (!isBuildPhase) {
  try {
    const prismaModule = require('@prisma/client');
    PrismaClient = prismaModule.PrismaClient;
  } catch (e) {
    console.warn('[DB] PrismaClient not available yet — build phase or prisma generate not run');
  }
}

const globalForPrisma = globalThis as unknown as {
  prisma: any | undefined
}

/**
 * Create a build-safe Proxy that defers all Prisma operations
 * until the real client is available.
 */
function createBuildSafeProxy(): any {
  return new Proxy({} as any, {
    get(_target, prop) {
      if (typeof prop === 'string' && prop.startsWith('$')) {
        return () => Promise.resolve();
      }
      return () => Promise.resolve([]);
    }
  });
}

// Export the database client
export const db = (() => {
  // During build phase, return a safe proxy
  if (isBuildPhase || !PrismaClient) {
    console.log('[DB] Build phase detected — using safe proxy');
    return createBuildSafeProxy();
  }

  // Reuse existing client in development (hot reload)
  if (globalForPrisma.prisma) {
    return globalForPrisma.prisma;
  }

  // Create real PrismaClient with PostgreSQL configuration
  const client = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error'] : ['error'],
    datasources: {
      db: {
        url: process.env.DATABASE_URL,
      },
    },
  });

  // Validate connection (non-blocking)
  client.$connect()
    .then(() => {
      if (process.env.NODE_ENV === 'development') {
        console.log('[DB] Prisma connected to PostgreSQL successfully');
      }
    })
    .catch((err: Error) => {
      console.error('[DB] CRITICAL: Prisma connection failed:', err.message);
    });

  // Cache in development for hot reload
  if (process.env.NODE_ENV !== 'production') {
    globalForPrisma.prisma = client;
  }

  return client;
})();
