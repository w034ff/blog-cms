import path from 'node:path';

// Where the maintenance scripts find the database.
//
// Mirrors lib/db/index.ts, which is what the app itself resolves — and the two
// MUST agree. A script that ignores BLOG_DB_PATH does not fail loudly: it
// quietly creates and operates on a second data/blog.db that the running app
// never reads, so `db:seed` appears to succeed while the admin user is missing
// from the DB actually being served.
//
// Kept out of lib/db/ deliberately: importing that module builds a drizzle
// client and opens a connection as a side effect of import, which a script that
// only wants a path (or its own better-sqlite3 handle) has no use for.
export function resolveDbPath(): string {
  return process.env.BLOG_DB_PATH
    ? path.resolve(process.env.BLOG_DB_PATH)
    : path.join(process.cwd(), 'data', 'blog.db');
}
