import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '@/lib/db/schema';
import type { AppDatabase } from '@/lib/db';

// CREATE TABLE mirroring lib/db/schema.ts `posts`. Hand-written (and kept in
// sync by hand) because drizzle-kit push is broken on this table — same reason
// the real DB is migrated with hand-written SQL. Used to back an in-memory DB so
// posts-write/posts logic can be tested for real instead of against drizzle mocks.
const CREATE_POSTS = `
  CREATE TABLE posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT UNIQUE,
    title TEXT NOT NULL,
    date TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT 'uncategorized',
    tags TEXT NOT NULL DEFAULT '[]',
    draft INTEGER NOT NULL DEFAULT 0,
    body TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    draft_content TEXT
  );
`;

// A fresh in-memory database with the posts table, wired to the same drizzle
// schema the app uses. Swap it in for `@/lib/db` via vi.mock in a test file.
export function createTestDb(): AppDatabase {
  const sqlite = new Database(':memory:');
  sqlite.exec(CREATE_POSTS);
  return drizzle({ client: sqlite, schema });
}
