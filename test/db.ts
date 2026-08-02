import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '@/lib/db/schema';
import type { AppDatabase } from '@/lib/db';

// Applies the real migrations from drizzle/ rather than a hand-written CREATE
// TABLE. That copy was kept in sync by hand — a standing hazard, since a column
// added to lib/db/schema.ts would reach production while the tests kept running
// against the old shape. The tests now build their database the way every other
// environment does, so the two cannot describe different tables, and the drift
// check in test/db.test.ts becomes a check on something worth checking: that the
// migrations on disk still add up to what schema.ts declares.
const MIGRATIONS_DIR = path.join(process.cwd(), 'drizzle');

function migrationStatements(): string[] {
  return (
    readdirSync(MIGRATIONS_DIR)
      .filter((file) => file.endsWith('.sql'))
      // Filenames are NNNN-prefixed, so lexical order is apply order.
      .sort()
      .flatMap((file) =>
        readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8')
          .split('--> statement-breakpoint')
          .map((statement) => statement.trim())
          .filter(Boolean),
      )
  );
}

// Read once: several test files build one of these per case, and the SQL on disk
// cannot change while a run is in progress.
const STATEMENTS = migrationStatements();

// A fresh in-memory database carrying the whole schema, wired to the same drizzle
// schema the app uses. Swap it in for `@/lib/db` via vi.mock in a test file.
export function createTestDb(): AppDatabase {
  const sqlite = new Database(':memory:');
  for (const statement of STATEMENTS) sqlite.exec(statement);
  return drizzle({ client: sqlite, schema });
}
