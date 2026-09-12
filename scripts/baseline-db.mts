import { existsSync } from 'node:fs';
import Database from 'better-sqlite3';
import { openDb } from './open-db.mts';
import { resolveDbPath } from './db-path.mts';
import { readMigrations, type Migration } from './migrations.mts';

// Marks an EXISTING database as already carrying the migrations in drizzle/,
// without running them.
//
//   node scripts/baseline-db.mts [--apply]
//
// Needed once: this DB predates the migration files. It was built by
// `drizzle-kit push` plus hand-written ALTERs, so its tables are already what
// 0000 would create — running 0000 against it would just fail on "table posts
// already exists", and there is no history worth replaying (the hand-applied
// DDL was never kept). What it lacks is the ledger row that tells drizzle so.
//
// Marking a DB as migrated is a claim about its shape, so the claim is checked
// first: every journal migration is applied to a throwaway in-memory DB and the
// resulting schema is compared, statement by statement, with the real one. A
// mismatch means this DB is NOT at that revision and must not be marked.
//
// Dry-run by default; --apply writes the ledger.
const DB_PATH = resolveDbPath();

// Same shape drizzle-orm's migrator creates (sqlite-core/dialect.cjs), so a
// later `db:migrate` finds the ledger it expects instead of making its own.
const LEDGER_DDL = `CREATE TABLE IF NOT EXISTS \`__drizzle_migrations\` (
	id SERIAL PRIMARY KEY,
	hash text NOT NULL,
	created_at numeric
)`;

// sqlite_master keeps whatever quoting the original CREATE used — the live
// tables came from drizzle-kit push and read `CREATE TABLE "posts"`, while the
// migration file says `CREATE TABLE \`posts\``. Same schema, different bytes,
// so compare with identifier quoting and whitespace removed. String literals in
// this schema are single-quoted, so dropping backticks and double quotes cannot
// swallow one.
function normalize(sql: string): string {
  return sql.replaceAll('`', '').replaceAll('"', '').replace(/\s+/g, ' ').trim();
}

function schemaOf(db: Database.Database): string[] {
  return db
    .prepare(
      `SELECT sql FROM sqlite_master
       WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name != '__drizzle_migrations'
       ORDER BY name`,
    )
    .all()
    .map((row) => normalize((row as { sql: string }).sql));
}

function expectedSchema(migrations: Migration[]): string[] {
  const memory = new Database(':memory:');
  try {
    for (const migration of migrations) {
      for (const statement of migration.statements) memory.exec(statement);
    }
    return schemaOf(memory);
  } finally {
    memory.close();
  }
}

function main(): void {
  const apply = process.argv.slice(2).includes('--apply');

  if (!existsSync(DB_PATH)) {
    console.error(`No DB at ${DB_PATH}. A fresh DB needs db:migrate, not a baseline.`);
    process.exitCode = 1;
    return;
  }

  const migrations = readMigrations();
  const db = openDb(DB_PATH);
  try {
    const alreadyLedgered = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations'`)
      .get();
    if (alreadyLedgered) {
      const count = (
        db.prepare('SELECT count(*) AS c FROM __drizzle_migrations').get() as { c: number }
      ).c;
      if (count > 0) {
        console.error(`${DB_PATH} already has ${count} ledger row(s); nothing to baseline.`);
        process.exitCode = 1;
        return;
      }
    }

    const actual = schemaOf(db);
    const expected = expectedSchema(migrations);
    const matches =
      actual.length === expected.length && actual.every((sql, i) => sql === expected[i]);

    console.log(`db:         ${DB_PATH}`);
    console.log(`migrations: ${migrations.map((m) => m.tag).join(', ')}`);
    console.log(
      `schema:     ${matches ? 'matches' : 'DOES NOT MATCH'} (${actual.length} object(s))`,
    );

    if (!matches) {
      for (const sql of expected.filter((s) => !actual.includes(s)))
        console.error(`  missing: ${sql}`);
      for (const sql of actual.filter((s) => !expected.includes(s)))
        console.error(`  extra:   ${sql}`);
      console.error('Refusing to baseline: this DB is not at the revision the journal describes.');
      process.exitCode = 1;
      return;
    }

    if (!apply) {
      console.log(`Dry run. Re-run with --apply to record ${migrations.length} migration(s).`);
      return;
    }

    // DDL first: better-sqlite3 validates a statement at prepare() time, so
    // preparing the insert before the table exists throws.
    db.exec(LEDGER_DDL);
    const insert = db.prepare(
      'INSERT INTO __drizzle_migrations ("hash", "created_at") VALUES (?, ?)',
    );
    // `.immediate` for the same reason as the DDL above needing to land first:
    // this transaction reads nothing, but a deferred BEGIN still upgrades to a
    // write, and SQLite refuses that with SQLITE_BUSY_SNAPSHOT (which
    // busy_timeout does not retry) when another connection committed meanwhile.
    const write = db.transaction((rows: Migration[]) => {
      for (const row of rows) insert.run(row.hash, row.when);
    }).immediate;
    write(migrations);

    console.log(
      `Recorded ${migrations.length} migration(s) as applied. db:migrate is now a no-op.`,
    );
  } finally {
    db.close();
  }
}

main();
