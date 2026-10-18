import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';

// Default to the repo-local data/blog.db. BLOG_DB_PATH overrides it so an
// isolated copy can be swapped in — the Playwright E2E harness points here at a
// throwaway seeded copy, never touching the real DB. Unset = unchanged behavior.
const DB_PATH = process.env.BLOG_DB_PATH
  ? path.resolve(process.env.BLOG_DB_PATH)
  : path.join(process.cwd(), 'data', 'blog.db');
const DB_DIR = path.dirname(DB_PATH);

// How long a statement waits for a write lock before giving up. SQLite's default
// is 0, which turns any overlap into an immediate SQLITE_BUSY: WAL lets readers
// and one writer coexist, but it does not let two writers overlap, and the
// scripts that write (seed, migrate-db, migrate-content) run as their own
// process against the same file. Without this, a script's write is enough to
// make a concurrent autosave fail outright instead of waiting the few
// milliseconds those writes actually take.
const BUSY_TIMEOUT_MS = 5000;

type Schema = typeof schema;
// `$client` is what drizzle() returns alongside the query builder; lib/user-delete.ts takes it
// because the purge script runs the same deletion without drizzle's `@/` imports.
export type AppDatabase = BetterSQLite3Database<Schema> & { $client: Database.Database };

function createDb(): AppDatabase {
  fs.mkdirSync(DB_DIR, { recursive: true });
  const sqlite = new Database(DB_PATH);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma(`busy_timeout = ${BUSY_TIMEOUT_MS}`);
  return drizzle({ client: sqlite, schema });
}

// Reuse a single connection across hot reloads in development.
declare global {
  var __blogDb: AppDatabase | undefined;
}

export const db: AppDatabase = globalThis.__blogDb ?? createDb();

if (process.env.NODE_ENV !== 'production') {
  globalThis.__blogDb = db;
}
