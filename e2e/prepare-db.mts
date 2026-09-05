// Prepare an isolated, seeded copy of the blog DB for the Playwright E2E server.
// Runs as the first step of the webServer command (before `next dev`), so the
// copy exists before the app opens it. Reads only process.env — it is spawned by
// node (not the Playwright loader), so every input arrives via the webServer env.
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';

const dest = process.env.BLOG_DB_PATH;
const username = process.env.E2E_ADMIN_USERNAME;
const password = process.env.E2E_ADMIN_PASSWORD;
if (!dest || !username || !password) {
  console.error('[e2e] BLOG_DB_PATH, E2E_ADMIN_USERNAME and E2E_ADMIN_PASSWORD must all be set.');
  process.exit(1);
}

// Next patches the tsconfig it uses to register generated types. The E2E server
// is pointed at this throwaway file (next.config typescript.tsconfigPath) so the
// real tsconfig.json stays untouched; it must extend the base to inherit @/* paths.
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
db.prepare(
  `INSERT INTO users (username, password_hash) VALUES (?, ?)
   ON CONFLICT(username) DO UPDATE SET password_hash=excluded.password_hash`,
).run(username, bcrypt.hashSync(password, 12));

// Two rows for the external link card (docs/link-card-requirements.md §14.9). The published page
// never fetches (§14.1) and the editor's route answers from this table while the row is fresh, so
// seeding them is what lets the whole feature be measured without a single request leaving the
// machine — `fetchedAt` is now, and the TTL is a week.
//
// A `failed` row is seeded as well because that state has its own card (§14.7) and is otherwise
// reachable only by actually failing to reach a host.
const now = Date.now();
const preview = db.prepare(
  `INSERT INTO link_previews (url, title, description, image, status, fetched_at, version)
     VALUES (?, ?, ?, ?, ?, ?, 1)
   ON CONFLICT(url) DO UPDATE SET title=excluded.title, description=excluded.description,
     image=excluded.image, status=excluded.status, fetched_at=excluded.fetched_at,
     version=excluded.version`,
);
// The image is a loopback literal, on purpose. The card's `<img>` is a real element and the browser
// really requests it, so a reachable value would put an outbound fetch in every run — and what is
// measured is the shape of the src and the signature check, neither of which depends on what comes
// back (§14.9). An IP literal is refused by the address guard before any resolver is asked, so this
// costs the run no DNS either.
preview.run(
  'https://example.com/article',
  '外部ページの見出し',
  '外部ページの説明文',
  'http://127.0.0.1/og.png',
  'ok',
  now,
);
preview.run('https://unreachable.example/x', '', '', '', 'failed', now);
// A row from an older version of the reader, which must not be used however fresh it is (§14.3.1).
// `version` defaults to 0 and the current one is 1, so this row is stale by construction — and its
// URL is a loopback literal, so re-reading it costs no network and lands on a known answer.
db.prepare(
  `INSERT INTO link_previews (url, title, description, image, status, fetched_at, version)
     VALUES (?, ?, ?, ?, ?, ?, 0)
   ON CONFLICT(url) DO UPDATE SET title=excluded.title, status=excluded.status,
     fetched_at=excluded.fetched_at, version=excluded.version`,
).run('http://127.0.0.1/stale-row', '古い版の行', '', '', 'ok', now);

db.close();

console.log(`[e2e] Prepared seeded test DB at ${dest} (admin '${username}').`);
