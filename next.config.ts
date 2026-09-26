import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // DATA_DIR is read at runtime by resolveDataDir() (src/lib/storage/projects.ts);
  // don't list it under `env`, which would bake the build machine's value in.
  webpack: (config) => {
    // Konva's Node entry requires the optional native `canvas` package. We only
    // render Konva in the browser, so resolve it to an empty module.
    config.resolve.alias = { ...config.resolve.alias, canvas: false };
    return config;
  },
};

export default nextConfig;
