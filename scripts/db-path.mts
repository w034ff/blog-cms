import path from 'node:path';

// Where the maintenance scripts find the database. **Must agree with lib/db/index.ts**: a script
// ignoring BLOG_DB_PATH silently works on a second data/blog.db the app never reads. Not in
// lib/db/, whose import opens a connection.
export function resolveDbPath(): string {
  return process.env.BLOG_DB_PATH
    ? path.resolve(process.env.BLOG_DB_PATH)
    : path.join(process.cwd(), 'data', 'blog.db');
}
