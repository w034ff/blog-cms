import { defineConfig, devices } from '@playwright/test';
import {
  BASE_URL,
  DIST_DIR,
  E2E_PORT,
  STORAGE_STATE,
  TEST_ADMIN,
  TEST_DB_PATH,
  TEST_SESSION_SECRET,
  TSCONFIG_PATH,
} from './e2e/constants';

// A lean, editor-scoped E2E harness. It boots an isolated `next dev` on its own
// port and build dir, against a throwaway seeded copy of the DB (BLOG_DB_PATH),
// and logs in once (the setup project) to reuse the admin session across specs.
export default defineConfig({
  testDir: './e2e',
  // Editor interactions (drag-select, autosave) are timing-sensitive: run serially.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  timeout: 90_000, // room for a cold Turbopack build of the .next-e2e dir
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    channel: 'chrome', // system Google Chrome — no bundled-browser download
    navigationTimeout: 60_000, // next dev compiles each route on first hit
    actionTimeout: 15_000,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /.*\.setup\.ts/ },
    {
      name: 'chromium',
      testMatch: /.*\.spec\.ts/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], channel: 'chrome', storageState: STORAGE_STATE },
    },
  ],
  webServer: {
    // Prepare the isolated seeded DB copy BEFORE the app boots, then start a dev
    // server in its own build dir (DIST_DIR) so it coexists with `npm run dev` —
    // and, since every path here is keyed by E2E_PORT, with the other shards.
    command: `node e2e/prepare-db.mts && node_modules/.bin/next dev -p ${E2E_PORT} -H 127.0.0.1`,
    port: E2E_PORT,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      NEXT_DIST_DIR: DIST_DIR,
      NEXT_TSCONFIG_PATH: TSCONFIG_PATH,
      BLOG_DB_PATH: TEST_DB_PATH,
      E2E_ADMIN_USERNAME: TEST_ADMIN.username,
      E2E_ADMIN_PASSWORD: TEST_ADMIN.password,
      SESSION_SECRET: TEST_SESSION_SECRET,
      SESSION_COOKIE_SECURE: 'false',
    },
  },
});
