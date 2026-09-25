import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '@/lib/db/schema';
import type { AppDatabase } from '@/lib/db';
import { readMigrations } from '@/scripts/migrations.mts';

// The real migrations from drizzle/, not a hand-written CREATE TABLE that could lag schema.ts, so
// tests use the tables every environment gets, and test/db.test.ts checks the migrations against
// schema.ts. Read once per run; order and splitting come from scripts/migrations.mts, exactly as
// `npm run db:migrate` applies them.
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
