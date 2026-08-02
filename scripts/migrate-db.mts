import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

// Applies every not-yet-applied migration in drizzle/ to the DB.
//
//   node scripts/migrate-db.mts
//
// This is the ONLY way schema changes reach a populated DB. `drizzle-kit push`
// was removed on purpose: it diffs the live DB against schema.ts and, for
// anything SQLite can't ALTER in place, rewrites the table (create → copy →
// drop → rename). On `posts` it emits the unique index twice and aborts
// midway, which is survivable locally and is not something to attempt on a DB
// holding the only copy of published posts. Workflow is now:
//
//   1. edit lib/db/schema.ts
//   2. npx drizzle-kit generate      (writes drizzle/NNNN_*.sql)
//   3. read the generated SQL — it is the thing that will run
//   4. npm run db:backup && npm run db:migrate
//
// The ledger is `__drizzle_migrations`, and drizzle decides what to run by
// comparing the newest recorded created_at against each migration's `when`
// (meta/_journal.json) — not by hashing. The pre-existing local DB was marked
// as already at 0000 by scripts/baseline-db.mts rather than having it applied.
const ROOT = process.cwd();
// Mirrors lib/db/index.ts so a deployment pointing elsewhere migrates the DB it
// actually serves.
const DB_PATH = process.env.BLOG_DB_PATH
  ? path.resolve(process.env.BLOG_DB_PATH)
  : path.join(ROOT, 'data', 'blog.db');
const MIGRATIONS_DIR = path.join(ROOT, 'drizzle');

type LedgerRow = { hash: string; created_at: number };

function readLedger(db: Database.Database): LedgerRow[] {
  const exists = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations'`)
    .get();
  if (!exists) return [];
  return db
    .prepare('SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at')
    .all() as LedgerRow[];
}

function main(): void {
  const sqlite = new Database(DB_PATH);
  try {
    const before = readLedger(sqlite).length;
    migrate(drizzle(sqlite), { migrationsFolder: MIGRATIONS_DIR });
    const after = readLedger(sqlite);
    const applied = after.length - before;
    console.log(`db: ${DB_PATH}`);
    console.log(
      applied === 0
        ? `already up to date (${after.length} migration(s) recorded)`
        : `applied ${applied} migration(s); ${after.length} recorded`,
    );
  } finally {
    sqlite.close();
  }
}

main();
