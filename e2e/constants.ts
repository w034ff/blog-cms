import path from 'node:path';

// Not 3001 (`npm run dev`). Overridable because the port is the harness's one machine-global
// piece; with `reuseExistingServer: false` a second run fails rather than testing another
// worktree's server. `E2E_PORT=3101 npx playwright test` runs two branches at once.
export const E2E_PORT = Number(process.env.E2E_PORT ?? 3100);
export const BASE_URL = `http://127.0.0.1:${E2E_PORT}`;

// Throwaway, seeded copy of data/blog.db. The isolated test server runs against
// this (via BLOG_DB_PATH) so the real DB is never touched. Kept out of git.
export const TEST_DB_PATH = path.join(process.cwd(), 'e2e', '.tmp', `blog.e2e.${E2E_PORT}.db`);

// The server's uploads directory (via BLOG_UPLOADS_DIR, lib/upload-dir.ts), rebuilt each run from the
// real data/uploads and FIXTURE_UPLOADS_DIR (e2e/prepare-db.mts). A test's uploads land here, never
// in data/uploads, and the fixtures are out of reach of `scripts/gc-uploads.mts`, which deleted them
// once: nothing the real DB references pointed at them. Kept out of git.
export const TEST_UPLOADS_DIR = path.join(process.cwd(), 'e2e', '.tmp', `uploads.${E2E_PORT}`);

// The images specs refer to by name, tracked in git. A name is the file's sha256, as
// app/api/uploads/route.ts writes it, since the serving route accepts no other shape.
export const FIXTURE_UPLOADS_DIR = path.join(process.cwd(), 'e2e', 'fixtures', 'uploads');

// Saved logged-in session, reused across specs so each doesn't re-login.
export const STORAGE_STATE = path.join(process.cwd(), 'e2e', '.auth', `admin.${E2E_PORT}.json`);

// Keyed by port like the paths above, since `npm run test:e2e:shards` runs several servers: they
// cannot share `<distDir>/dev/lock`, one auth file, or a tsconfig Next rewrites.
export const DIST_DIR = `.next-e2e-${E2E_PORT}`;
export const TSCONFIG_PATH = `tsconfig.e2e.${E2E_PORT}.json`;

// Test-only admin, seeded into the copy and typed at the /login form. Not a
// secret: it only unlocks a throwaway local DB on a random test port.
export const TEST_ADMIN = { username: 'e2e-admin', password: 'e2e-password-1234' } as const;

// Test-only author: a signed-in account without the admin role, for what only an admin may reach
// (docs/editor-requirements.md §12.33.1). Seeded beside TEST_ADMIN, same reasoning.
export const TEST_AUTHOR = { username: 'e2e-author', password: 'e2e-password-5678' } as const;

// Test-only JWT secret, unrelated to the real SESSION_SECRET.
export const TEST_SESSION_SECRET = 'e2e-only-session-secret-please-ignore-0123456789abcdef';
