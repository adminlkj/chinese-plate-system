import type { NextConfig } from "next";

// ═══════════════════════════════════════════════════════════════════════════════
// Production Next.js Configuration for Web/Render Deployment
// ═══════════════════════════════════════════════════════════════════════════════
// No Tauri, no standalone, no desktop APIs.
// Standard Next.js web deployment with PostgreSQL.
// ═══════════════════════════════════════════════════════════════════════════════

const nextConfig: NextConfig = {
  // ─── Images: Disable optimization for simplicity ───
  images: {
    unoptimized: true,
  },

  // ─── React Strict Mode ───
  reactStrictMode: false,

  // ─── Security Headers + API Caching ───
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-XSS-Protection", value: "1; mode=block" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
      {
        source: "/api/(.*)",
        headers: [
          { key: "Cache-Control", value: "no-store, no-cache, must-revalidate, proxy-revalidate" },
          { key: "Pragma", value: "no-cache" },
          { key: "Expires", value: "0" },
        ],
      },
    ];
  },
};

export default nextConfig;
