import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The image optimizer would fetch /api/** photo URLs server-side; the app serves its own
  // already-sized images, so turn it off rather than allow-list.
  images: { unoptimized: true },
  // DATA_DIR is read at runtime by resolveDataDir() (src/lib/storage/projects.ts);
  // don't list it under `env`, which would bake the build machine's value in.
  // Native/Node-only drivers: load from node_modules at runtime instead of bundling.
  serverExternalPackages: ['postgres', '@google-cloud/storage', '@electric-sql/pglite'],
  webpack: (config) => {
    // Konva's Node entry requires the optional native `canvas` package. We only
    // render Konva in the browser, so resolve it to an empty module.
    config.resolve.alias = { ...config.resolve.alias, canvas: false };
    return config;
  },
};

export default nextConfig;
