import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Expose the project data directory to server routes
  env: {
    DATA_DIR: process.env.DATA_DIR || './data',
  },
};

export default nextConfig;
