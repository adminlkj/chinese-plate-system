import { NextRequest, NextResponse } from 'next/server';

// ─── In-memory Rate Limiter ────────────────────────────────────────
// Simple sliding window rate limiter (per-IP)
// For production, replace with Redis-backed store

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

const rateLimitMap = new Map<string, RateLimitEntry>();

// Clean up old entries every 5 minutes
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of rateLimitMap.entries()) {
      if (now > entry.resetTime) {
        rateLimitMap.delete(key);
      }
    }
  }, 5 * 60 * 1000);
}

function checkRateLimit(
  ip: string,
  limit: number,
  windowMs: number
): { allowed: boolean; remaining: number; resetTime: number } {
  const now = Date.now();
  const key = ip;
  const entry = rateLimitMap.get(key);

  if (!entry || now > entry.resetTime) {
    // New window
    rateLimitMap.set(key, { count: 1, resetTime: now + windowMs });
    return { allowed: true, remaining: limit - 1, resetTime: now + windowMs };
  }

  if (entry.count >= limit) {
    return { allowed: false, remaining: 0, resetTime: entry.resetTime };
  }

  entry.count++;
  return { allowed: true, remaining: limit - entry.count, resetTime: entry.resetTime };
}

// ─── Route-specific rate limits ────────────────────────────────────
const RATE_LIMITS: Record<string, { limit: number; windowMs: number }> = {
  '/api/admin/login': { limit: 5, windowMs: 60 * 1000 },         // 5 per minute
  '/api/admin/verify': { limit: 30, windowMs: 60 * 1000 },       // 30 per minute
  '/api/admin/logout': { limit: 10, windowMs: 60 * 1000 },       // 10 per minute
  '/api/settings/verify-supervisor': { limit: 5, windowMs: 60 * 1000 }, // 5 per minute
};

// ─── Security Headers ──────────────────────────────────────────────
function addSecurityHeaders(response: NextResponse): NextResponse {
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-XSS-Protection', '1; mode=block');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=()'
  );
  // Content-Security-Policy — allows inline styles (needed by Tailwind) and self-origin scripts
  response.headers.set(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
    ].join('; ')
  );
  return response;
}

// Next.js 16 uses proxy.ts instead of middleware.ts
// See: https://nextjs.org/docs/messages/middleware-to-proxy
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ─── Rate Limiting ────────────────────────────────────────────
  const rateLimitConfig = RATE_LIMITS[pathname];
  if (rateLimitConfig) {
    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      request.headers.get('x-real-ip') ||
      'unknown';

    const result = checkRateLimit(ip, rateLimitConfig.limit, rateLimitConfig.windowMs);

    if (!result.allowed) {
      return addSecurityHeaders(
        NextResponse.json(
          { error: 'طلبات كثيرة جداً. يرجى المحاولة لاحقاً.' },
          { status: 429 }
        )
      );
    }
  }

  // ─── Add Security Headers ─────────────────────────────────────
  const response = NextResponse.next();
  return addSecurityHeaders(response);
}

export const config = {
  matcher: [
    '/api/:path*',
  ],
};
