import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { openDb } from './open-db.mts';
import { resolveDbPath } from './db-path.mts';

// Applies every not-yet-applied migration in drizzle/.
//
//   node scripts/migrate-db.mts
//
// The ONLY way schema changes reach a populated DB. `drizzle-kit push` was removed: for anything
// SQLite cannot ALTER it rewrites the table (create → copy → drop → rename), and on `posts` it
// emitted the unique index twice and aborted midway, not something to try on the only copy of the
// posts. Workflow:
//
//   1. edit lib/db/schema.ts
//   2. npx drizzle-kit generate      (writes drizzle/NNNN_*.sql)
//   3. read the generated SQL — it is the thing that will run
//   4. npm run db:backup && npm run db:migrate
//
// The ledger is `__drizzle_migrations`; drizzle runs what is newer than the latest recorded
// created_at by `when` (meta/_journal.json), not by hash. The original DB was marked at 0000 by
// scripts/baseline-db.mts.
const ROOT = process.cwd();
// So a deployment pointing elsewhere migrates the DB it actually serves.
const DB_PATH = resolveDbPath();
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
  const sqlite = openDb(DB_PATH);
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
