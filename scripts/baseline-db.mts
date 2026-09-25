import { existsSync } from 'node:fs';
import Database from 'better-sqlite3';
import { openDb } from './open-db.mts';
import { resolveDbPath } from './db-path.mts';
import { readMigrations, type Migration } from './migrations.mts';

// Marks an EXISTING database as carrying the migrations in drizzle/, without running them.
//
//   node scripts/baseline-db.mts [--apply]
//
// Needed once: this DB predates the migrations (built by `drizzle-kit push` and hand ALTERs), so
// 0000 would fail on "table posts already exists"; it lacks only the ledger row. The claim is
// checked first: the journal is applied to an in-memory DB and the schemas compared statement by
// statement, and a mismatch refuses. Dry-run by default; --apply writes the ledger.
const DB_PATH = resolveDbPath();

// drizzle-orm's migrator's shape (sqlite-core/dialect.cjs), so `db:migrate` finds its ledger.
const LEDGER_DDL = `CREATE TABLE IF NOT EXISTS \`__drizzle_migrations\` (
	id SERIAL PRIMARY KEY,
	hash text NOT NULL,
	created_at numeric
)`;

// sqlite_master keeps the original quoting (`CREATE TABLE "posts"` from push, backticks in the
// migration), so compare without identifier quotes and whitespace. String literals here are
// single-quoted, so nothing is swallowed.
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

    // DDL first: better-sqlite3 validates at prepare(), before the table would exist.
    db.exec(LEDGER_DDL);
    const insert = db.prepare(
      'INSERT INTO __drizzle_migrations ("hash", "created_at") VALUES (?, ?)',
    );
    // `.immediate`: a deferred BEGIN upgrading to a write gets SQLITE_BUSY_SNAPSHOT, which
    // busy_timeout does not retry, if another connection committed meanwhile.
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
