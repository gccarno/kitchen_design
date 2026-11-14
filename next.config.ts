import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The image optimizer would fetch /api/** photo URLs server-side; the app serves its own
  // already-sized images, so turn it off rather than allow-list.
  images: { unoptimized: true },
  // DATA_DIR is read at runtime by resolveDataDir() (src/lib/storage/projects.ts);
  // don't list it under `env`, which would bake the build machine's value in.
  // Native/Node-only drivers: load from node_modules at runtime instead of bundling.
  // The commit being built (Render sets RENDER_GIT_COMMIT at build time), so browser
  // error reports carry the same release as the server's.
  env: { NEXT_PUBLIC_RELEASE: process.env.RENDER_GIT_COMMIT ?? '' },
  serverExternalPackages:['postgres', '@google-cloud/storage', '@electric-sql/pglite', '@sentry/node'],
  // Baseline hardening for every response. HSTS only in production: on http://localhost it would
  // make the browser insist on https for that host. (No page-wide CSP yet: Next's inline scripts
  // need nonces; the SVG exports, opened inline on this origin, set their own strict one.)
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          ...(process.env.NODE_ENV === 'production' ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000' }] : []),
        ],
      },
    ];
  },
  webpack: (config) => {
    // Konva's Node entry requires the optional native `canvas` package. We only
    // render Konva in the browser, so resolve it to an empty module.
    config.resolve.alias = { ...config.resolve.alias, canvas: false };
    return config;
  },
};

export default nextConfig;
