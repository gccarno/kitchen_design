import { defineConfig, devices } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// A dedicated port and a throwaway data directory, so e2e runs never touch
// a dev server you have open or the projects in ./data.
const PORT = 3310;
export const E2E_DATA_DIR = process.env.E2E_DATA_DIR ?? mkdtempSync(join(tmpdir(), 'kd-playwright-'));
process.env.E2E_DATA_DIR = E2E_DATA_DIR; // shared with workers, which re-evaluate this file

export default defineConfig({
  testDir: './tests/e2e',
  globalTeardown: './tests/e2e/global-teardown.ts',
  // Serial, with a generous expect timeout: `next dev` compiles each route on
  // first hit, and parallel workers racing those compiles cause flaky timeouts.
  fullyParallel: false,
  workers: 1,
  expect: { timeout: 15_000 },
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: `npx next dev -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { DATA_DIR: E2E_DATA_DIR, LLM_API_KEY: '', NEXT_TELEMETRY_DISABLED: '1' },
  },
});
