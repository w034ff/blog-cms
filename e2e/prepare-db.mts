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
const e2eTsconfig = path.join(process.cwd(), 'tsconfig.e2e.json');
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
db.close();

console.log(`[e2e] Prepared seeded test DB at ${dest} (admin '${username}').`);
