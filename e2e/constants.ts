import path from 'node:path';

// A dedicated port so the harness never collides with `npm run dev` (3001). Overridable because the
// port is the one piece of this harness that is machine-global: `.next-e2e`, the seeded DB copy and
// the saved session are all cwd-relative and so already private to a git worktree, but two runs at
// once want the same socket — and `reuseExistingServer: false` makes the second one fail outright
// rather than quietly test the other worktree's server. `E2E_PORT=3101 npx playwright test` (or the
// same in that worktree's .claude/settings.local.json) is what lets two branches be worked at once.
export const E2E_PORT = Number(process.env.E2E_PORT ?? 3100);
export const BASE_URL = `http://127.0.0.1:${E2E_PORT}`;

// Throwaway, seeded copy of data/blog.db. The isolated test server runs against
// this (via BLOG_DB_PATH) so the real DB is never touched. Kept out of git.
export const TEST_DB_PATH = path.join(process.cwd(), 'e2e', '.tmp', 'blog.e2e.db');

// Saved logged-in session, reused across specs so each doesn't re-login.
export const STORAGE_STATE = path.join(process.cwd(), 'e2e', '.auth', 'admin.json');

// Test-only admin, seeded into the copy and typed at the /login form. Not a
// secret: it only unlocks a throwaway local DB on a random test port.
export const TEST_ADMIN = { username: 'e2e-admin', password: 'e2e-password-1234' } as const;

// Test-only JWT signing secret for the isolated server — its own, unrelated to
// the real SESSION_SECRET (which we neither know nor need).
export const TEST_SESSION_SECRET = 'e2e-only-session-secret-please-ignore-0123456789abcdef';
