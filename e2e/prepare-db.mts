// An isolated, seeded copy of the blog DB for the E2E server, made before `next dev` opens it.
// Spawned by node, not Playwright's loader, so every input arrives via the webServer env.
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

const dest = process.env.BLOG_DB_PATH;
const username = process.env.E2E_ADMIN_USERNAME;
const password = process.env.E2E_ADMIN_PASSWORD;
const authorUsername = process.env.E2E_AUTHOR_USERNAME;
const authorPassword = process.env.E2E_AUTHOR_PASSWORD;
if (!dest || !username || !password || !authorUsername || !authorPassword) {
  console.error(
    '[e2e] BLOG_DB_PATH and the E2E_ADMIN_* and E2E_AUTHOR_* credentials must all be set.',
  );
  process.exit(1);
}

// Next patches its tsconfig to register generated types, so the E2E server gets this throwaway one
// (next.config `typescript.tsconfigPath`); it extends the base for the @/* paths.
const e2eTsconfig = path.join(process.cwd(), process.env.NEXT_TSCONFIG_PATH ?? 'tsconfig.e2e.json');
if (!fs.existsSync(e2eTsconfig)) {
  fs.writeFileSync(e2eTsconfig, `${JSON.stringify({ extends: './tsconfig.json' }, null, 2)}\n`);
}

const source = path.join(process.cwd(), 'data', 'blog.db');
if (!fs.existsSync(source)) {
  console.error(`[e2e] Source DB not found at ${source}. Seed it first (npm run db:seed).`);
  process.exit(1);
}

// Start each run from a clean slate: drop any prior copy and its WAL sidecars.
fs.mkdirSync(path.dirname(dest), { recursive: true });
for (const suffix of ['', '-wal', '-shm']) fs.rmSync(dest + suffix, { force: true });

// WAL-safe copy via SQLite's online backup — a plain file copy could miss data
// still sitting in the source's -wal sidecar.
const src = new Database(source, { readonly: true, fileMustExist: true });
await src.backup(dest);
src.close();

// Upsert a known test admin so the login spec can authenticate against the copy.
// Cost 12 mirrors scripts/seed.mts.
const db = new Database(dest);
db.pragma('journal_mode = WAL');

// Migrate the copy: the real DB is migrated by hand (`npm run db:migrate`) and can lag a branch that
// adds a migration. The source was opened read-only.
migrate(drizzle(db), { migrationsFolder: path.join(process.cwd(), 'drizzle') });
db.prepare(
  `INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')
   ON CONFLICT(username) DO UPDATE SET password_hash=excluded.password_hash, role=excluded.role`,
).run(username, bcrypt.hashSync(password, 12));
// And an author, for the screens only an admin may reach (docs/editor-requirements.md §12.33.1).
db.prepare(
  `INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'author')
   ON CONFLICT(username) DO UPDATE SET password_hash=excluded.password_hash, role=excluded.role`,
).run(authorUsername, bcrypt.hashSync(authorPassword, 12));

// External link card rows (docs/link-card-requirements.md §14.9): the published page never
// fetches (§14.1) and the editor answers from fresh rows, so no request leaves the machine. The
// `failed` row is the only way to reach that card's state (§14.7) without failing a real host.
const now = Date.now();
const preview = db.prepare(
  `INSERT INTO link_previews (url, title, description, image, status, fetched_at, version)
     VALUES (?, ?, ?, ?, ?, ?, 1)
   ON CONFLICT(url) DO UPDATE SET title=excluded.title, description=excluded.description,
     image=excluded.image, status=excluded.status, fetched_at=excluded.fetched_at,
     version=excluded.version`,
);
// A loopback literal on purpose: the browser really requests the image, and what is measured is the
// src and the signature (§14.9). The address guard refuses an IP literal before any DNS lookup.
preview.run(
  'https://example.com/article',
  '外部ページの見出し',
  '外部ページの説明文',
  'http://127.0.0.1/og.png',
  'ok',
  now,
);
preview.run('https://unreachable.example/x', '', '', '', 'failed', now);
// An older reader's row (`version` 0 against 1), which must not be used however fresh (§14.3.1).
// Loopback, so re-reading it costs no network.
db.prepare(
  `INSERT INTO link_previews (url, title, description, image, status, fetched_at, version)
     VALUES (?, ?, ?, ?, ?, ?, 0)
   ON CONFLICT(url) DO UPDATE SET title=excluded.title, status=excluded.status,
     fetched_at=excluded.fetched_at, version=excluded.version`,
).run('http://127.0.0.1/stale-row', '古い版の行', '', '', 'ok', now);

db.close();

console.log(`[e2e] Prepared seeded test DB at ${dest} (admin '${username}').`);
