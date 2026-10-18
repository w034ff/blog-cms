import { existsSync } from 'node:fs';
import type Database from 'better-sqlite3';
import { resolveDbPath } from './db-path.mts';
import { openDb } from './open-db.mts';
import { deleteUserAccount, isWithdrawalDue } from '../lib/user-delete.ts';

// Deletes the authors whose withdrawal is past its deadline (docs/multi-author-requirements.md
// §12.6), with everything they wrote. Dry-run by default, like gc-uploads.mts.
//   node scripts/purge-withdrawn.mts            # list who is due
//   node scripts/purge-withdrawn.mts --delete   # delete them
// Runs before gc-uploads in deploy/systemd/uploads-gc.service, so the images only they used go
// the same night.

export type PurgeResult = { due: number[]; deleted: number[] };

export function purgeWithdrawn(sqlite: Database.Database, now: Date, apply: boolean): PurgeResult {
  const rows = sqlite
    .prepare(
      "SELECT id, withdrawal_due_at AS dueAt FROM users WHERE role = 'author' AND withdrawal_due_at IS NOT NULL ORDER BY id",
    )
    .all();
  const due: number[] = [];
  for (const row of rows) {
    if (typeof row !== 'object' || row === null) continue;
    if (!('id' in row) || typeof row.id !== 'number') continue;
    if (!('dueAt' in row) || typeof row.dueAt !== 'string') continue;
    if (isWithdrawalDue(row.dueAt, now)) due.push(row.id);
  }
  if (!apply) return { due, deleted: [] };
  // deleteUserAccount checks again inside its transaction: a cancel after the list above wins.
  const deleted = due.filter((id) =>
    deleteUserAccount(sqlite, id, { kind: 'withdrawal-due', now }),
  );
  return { due, deleted };
}

function main(): void {
  const apply = process.argv.slice(2).includes('--delete');
  const dbPath = resolveDbPath();
  console.log(`db: ${dbPath}`);
  // Opening a missing path would create an empty DB there and report nothing due.
  if (!existsSync(dbPath)) {
    console.error(`No DB at ${dbPath}; aborting.`);
    process.exitCode = 1;
    return;
  }
  const sqlite = openDb(dbPath);
  try {
    const { due, deleted } = purgeWithdrawn(sqlite, new Date(), apply);
    if (due.length === 0) {
      console.log('No withdrawals are due.');
    } else if (!apply) {
      console.log(`Due (dry run, nothing deleted): users ${due.join(', ')}`);
    } else {
      console.log(`Deleted: users ${deleted.join(', ') || '(none)'}`);
      const kept = due.filter((id) => !deleted.includes(id));
      if (kept.length > 0) console.log(`Kept (cancelled since listed): users ${kept.join(', ')}`);
    }
  } finally {
    sqlite.close();
  }
}

if (import.meta.main) main();
