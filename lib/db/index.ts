import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';

const DB_DIR = path.join(process.cwd(), 'data');
const DB_PATH = path.join(DB_DIR, 'blog.db');

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
  // eslint-disable-next-line no-var
  var __blogDb: AppDatabase | undefined;
}

export const db: AppDatabase = globalThis.__blogDb ?? createDb();

if (process.env.NODE_ENV !== 'production') {
  globalThis.__blogDb = db;
}
