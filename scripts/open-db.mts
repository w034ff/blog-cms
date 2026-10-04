import Database from 'better-sqlite3';

// The write-lock wait, as lib/db/index.ts. SQLite defaults to 0, so one overlapping autosave from
// the running app would abort a migration. It does not cover a deferred transaction upgrading after
// another commit (SQLITE_BUSY_SNAPSHOT, never retried): those use `.immediate`.
const BUSY_TIMEOUT_MS = 5000;

// A writable handle for the scripts. WAL is the file's own property; a script does not change it.
export function openDb(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  db.pragma(`busy_timeout = ${BUSY_TIMEOUT_MS}`);
  return db;
}
