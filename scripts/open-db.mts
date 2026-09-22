import Database from 'better-sqlite3';

// How long a statement waits for a write lock before giving up, mirroring the
// app's lib/db/index.ts.
//
// These scripts open the same file as a running app, whose autosave writes in
// short bursts. SQLite's default is 0, so without this a single overlapping
// autosave is enough to abort a migration or a repair run outright.
//
// This does NOT cover a deferred transaction that upgrades to a write after
// another connection has committed: SQLite answers that with
// SQLITE_BUSY_SNAPSHOT and never calls the busy handler. Transactions that read
// before they write take the lock up front (`.immediate`) for that reason.
const BUSY_TIMEOUT_MS = 5000;

// A writable handle on the blog DB for the maintenance scripts. Journal mode is
// not set here: WAL is a property the file already carries, and a script has no
// business changing it.
export function openDb(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  db.pragma(`busy_timeout = ${BUSY_TIMEOUT_MS}`);
  return db;
}
