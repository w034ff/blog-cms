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

type Schema = typeof schema;
export type AppDatabase = BetterSQLite3Database<Schema>;

function createDb(): AppDatabase {
  fs.mkdirSync(DB_DIR, { recursive: true });
  const sqlite = new Database(DB_PATH);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
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
