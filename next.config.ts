// next.config.ts: scaffold-owned (A2, bl-architect). Changes go through a contract question.
//
// Security headers from docs/SECURITY_MODEL.md invariant 13. The Content-Security-Policy itself is
// NOT set here: it needs a fresh nonce per request, so src/proxy.ts sets it (backend lane, SEC-15).
//
// `/` (the Request a quote page) carries a fresh form token on every render, so it must never be
// cached anywhere (SECURITY_MODEL "One token per page load", S0 SEC-2). Next.js fixes Cache-Control
// only for immutable hashed assets; other responses may set it here
// (https://nextjs.org/docs/app/api-reference/config/next-config-js/headers).
import type { NextConfig } from 'next';

const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' }, // no embedding anywhere (NG-11)
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      { source: '/', headers: [{ key: 'Cache-Control', value: 'private, no-store' }] },
    ];
  },
};

export default nextConfig;
