import 'server-only';
import path from 'node:path';

// Where uploaded images live: `data/uploads` beside the DB, or BLOG_UPLOADS_DIR when set — the
// uploads' counterpart of BLOG_DB_PATH (lib/db/index.ts), for the same reason: the E2E server gets
// a throwaway copy (e2e/prepare-db.mts), so a test's uploads never reach the real directory, and
// the fixtures it reads are not swept by `scripts/gc-uploads.mts`, which sees only the real
// directory's references.
export const UPLOAD_DIR = process.env.BLOG_UPLOADS_DIR
  ? path.resolve(process.env.BLOG_UPLOADS_DIR)
  : path.join(process.cwd(), 'data', 'uploads');
