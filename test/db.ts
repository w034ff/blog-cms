import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '@/lib/db/schema';
import type { AppDatabase } from '@/lib/db';
import { readMigrations } from '@/scripts/migrations.mts';

// Applies the real migrations from drizzle/ rather than a hand-written CREATE
// TABLE. That copy was kept in sync by hand — a standing hazard, since a column
// added to lib/db/schema.ts would reach production while the tests kept running
// against the old shape. The tests now build their database the way every other
// environment does, so the two cannot describe different tables, and the drift
// check in test/db.test.ts becomes a check on something worth checking: that the
// migrations on disk still add up to what schema.ts declares.
// Read once: several test files build one of these per case, and the SQL on disk
// cannot change while a run is in progress. Ordering and statement splitting come
// from scripts/migrations.mts, so the tests apply exactly what `npm run db:migrate`
// would, in the order the journal gives — rather than a second reading of the same
// files that could disagree with it.
const STATEMENTS = readMigrations().flatMap((migration) => migration.statements);

// A fresh in-memory database carrying the whole schema, wired to the same drizzle
// schema the app uses. Swap it in for `@/lib/db` via vi.mock in a test file.
export function createTestDb(): AppDatabase {
  return drizzle({ client: createTestSqlite(), schema });
}

// The same database without the drizzle wrapper, for code that takes a raw better-sqlite3
// connection — the maintenance scripts do (scripts/upload-refs.mts).
export function createTestSqlite(): Database.Database {
  const sqlite = new Database(':memory:');
  for (const statement of STATEMENTS) sqlite.exec(statement);
  return sqlite;
}
