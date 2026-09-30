import { defineConfig, devices } from '@playwright/test';
import {
  BASE_URL,
  DIST_DIR,
  E2E_PORT,
  FIXTURE_UPLOADS_DIR,
  STORAGE_STATE,
  TEST_ADMIN,
  TEST_AUTHOR,
  TEST_DB_PATH,
  TEST_SESSION_SECRET,
  TEST_UPLOADS_DIR,
  TSCONFIG_PATH,
} from './e2e/constants';

// A lean, editor-scoped E2E harness. It boots an isolated `next dev` on its own
// port and build dir, against a throwaway seeded copy of the DB (BLOG_DB_PATH) and of the uploads
// (BLOG_UPLOADS_DIR), and logs in once (the setup project) to reuse the admin session across specs.
export default defineConfig({
  testDir: './e2e',
  // `fullyParallel: false` keeps every test in a file on one worker, in order — which is what the
  // editor's timing-sensitive gestures (drag-select, autosave) actually depend on. What they do
  // not depend on is being the only test in the process: a worker gets its own browser and its own
  // page, so another worker's typing cannot reach this one's editor. So the unit of parallelism is
  // the file, and four of them run at once.
  //
  // Four on one server, rather than more servers: a `next dev` is 1.6GB resident against roughly
  // 0.3GB for another browser context (measured 2026-09-13), which is what made three shards
  // memory-bound on this machine. The shared DB is safe because each test makes its own post —
  // the one assertion that read global state was the link card picker's unfiltered list, capped
  // at 20 newest-first, and it now searches instead (e2e/editor-link-card.spec.ts).
  fullyParallel: false,
  workers: 4,
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
    // CSS gated on `prefers-reduced-motion` (app/globals.css) reads this as "reduce" and skips
    // the branch entirely — added with the ＋ sheet's own open animation (2026-09-20), whose
    // `boundingBox()` assertions run right after open with no wait for a transition to settle.
    // Nested under `contextOptions`, not a top-level `use` key, in this Playwright version.
    contextOptions: { reducedMotion: 'reduce' },
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
  // `E2E_EXTERNAL_SERVER=1` points the run at a server started outside Playwright (the harness
  // normally owns it). Used to A/B one build of the app against another on the same specs.
  webServer: process.env.E2E_EXTERNAL_SERVER
    ? undefined
    : {
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
          BLOG_UPLOADS_DIR: TEST_UPLOADS_DIR,
          E2E_FIXTURE_UPLOADS_DIR: FIXTURE_UPLOADS_DIR,
          E2E_ADMIN_USERNAME: TEST_ADMIN.username,
          E2E_ADMIN_PASSWORD: TEST_ADMIN.password,
          E2E_AUTHOR_USERNAME: TEST_AUTHOR.username,
          E2E_AUTHOR_PASSWORD: TEST_AUTHOR.password,
          SESSION_SECRET: TEST_SESSION_SECRET,
          SESSION_COOKIE_SECURE: 'false',
        },
      },
});
