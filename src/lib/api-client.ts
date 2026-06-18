/**
 * API Client - Automatic auth header injection + global 401 handler for all API requests
 *
 * WHY: In sandbox/iframe environments, browsers may block cookies
 * (especially non-Secure cookies on HTTPS pages). This module patches
 * the global fetch to:
 *   1. Automatically include the JWT token from localStorage as Authorization header
 *   2. Include credentials (cookies) as a fallback auth mechanism
 *   3. Auto-logout + redirect on 401 responses (prevents "collapsed system" state)
 *
 * Call installApiInterceptor() ONCE at app initialization.
 */

// localStorage key where the auth token is stored
const AUTH_TOKEN_KEY = 'pos-auth-token';

// Endpoints that should NOT trigger auto-logout on 401
// (they are expected to return 401 when checking auth status)
const AUTH_ENDPOINTS = [
  '/api/auth/me',
  '/api/auth/verify',
  '/api/auth/session-check',
  '/api/admin/verify',
  '/api/admin/login',
  '/api/admin/logout',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/setup',
];

// Guard to prevent multiple simultaneous logout triggers
let isLoggingOut = false;

/**
 * Save the auth token to localStorage
 */
export function saveAuthToken(token: string): void {
  try {
    localStorage.setItem(AUTH_TOKEN_KEY, token);
  } catch {}
}

/**
 * Get the auth token from localStorage
 */
export function getAuthToken(): string | null {
  try {
    return localStorage.getItem(AUTH_TOKEN_KEY);
  } catch {
    return null;
  }
}

/**
 * Remove the auth token from localStorage
 */
export function removeAuthToken(): void {
  try {
    localStorage.removeItem(AUTH_TOKEN_KEY);
  } catch {}
}

/**
 * Trigger a global logout when a 401 is received.
 * Clears the token, clears Zustand persisted state, and reloads to login screen.
 * This prevents the "collapsed system" state where the user appears logged in
 * but every API call fails.
 */
function triggerGlobalLogout(): void {
  if (isLoggingOut) return; // Prevent multiple triggers
  isLoggingOut = true;

  // Clear the auth token from localStorage
  removeAuthToken();

  // Clear the Zustand persisted store (user, isAuthenticated, authToken)
  try {
    localStorage.removeItem('pos-auth-storage');
  } catch {}

  // Also clear any session cookies by calling the logout endpoint
  // (fire-and-forget, don't block the redirect)
  try {
    fetch('/api/admin/logout', { method: 'POST', credentials: 'include' }).catch(() => {});
  } catch {}

  // Reset the guard flag after redirect
  setTimeout(() => {
    isLoggingOut = false;
  }, 2000);

  // Force a full page reload to reset all React state
  // This is the most reliable way to ensure the app returns to the login screen
  if (typeof window !== 'undefined') {
    window.location.reload();
  }
}

/**
 * Check if a URL is an auth endpoint that should NOT trigger auto-logout on 401
 */
function isAuthEndpoint(url: string): boolean {
  return AUTH_ENDPOINTS.some((ep) => url.includes(ep));
}

/**
 * Install the global fetch wrapper that:
 *   1. Adds Authorization: Bearer <token> header to all /api/ requests
 *   2. Adds credentials: 'include' to send cookies as fallback
 *   3. Auto-logs out on 401 responses (except for auth endpoints)
 *
 * Call this ONCE at app initialization (in page.tsx or layout).
 */
export function installApiInterceptor(): void {
  if (typeof window === 'undefined') return;

  // Avoid double-installation
  if ((window as any).__apiInterceptorInstalled) return;
  (window as any).__apiInterceptorInstalled = true;

  const originalFetch = window.fetch;

  window.fetch = async function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    // Determine the URL string for checking
    let urlString = '';
    if (typeof input === 'string') {
      urlString = input;
    } else if (input instanceof URL) {
      urlString = input.toString();
    } else if (input instanceof Request) {
      urlString = input.url;
    }

    const isApiRequest = urlString.startsWith('/api/') || urlString.includes('/api/');

    // Merge auth headers + credentials for API requests
    if (isApiRequest) {
      const token = getAuthToken();

      // Build merged headers
      const headers = new Headers(init?.headers || (input as Request)?.headers);

      if (token) {
        headers.set('Authorization', `Bearer ${token}`);
      }

      // Create new init with merged headers + credentials
      init = {
        ...init,
        headers,
        // Always include credentials (cookies) for same-origin API requests
        // This serves as a fallback when the Bearer token is missing/expired
        credentials: 'include' as RequestCredentials,
      };
    }

    // Execute the request
    const response = await originalFetch.call(this, input, init);

    // ─── Global 401 Handler ───
    // If an API request returns 401 AND it's not an auth-checking endpoint,
    // trigger a global logout to prevent the "collapsed system" state.
    if (isApiRequest && response.status === 401 && !isAuthEndpoint(urlString)) {
      // Check if we actually have a token (if no token, the user was never logged in — don't loop)
      const hasToken = !!getAuthToken();
      if (hasToken) {
        console.warn('[API] 401 received on authenticated request — triggering global logout');
        triggerGlobalLogout();
      }
    }

    return response;
  };
}
