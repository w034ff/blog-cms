import { existsSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { resolveDbPath } from './db-path.mts';
import { formatBytes } from './format-bytes.mts';

// Point-in-time snapshot of the SQLite DB. Not `cp`: in WAL mode committed data can still be in the
// -wal sidecar. `VACUUM INTO` writes one self-contained, compacted file.
//
//   node scripts/backup-db.mts                    # data/backups/blog-<stamp>.db
//   node scripts/backup-db.mts --out=/mnt/x/b.db  # explicit destination
//
// Restore by copying it over data/blog.db with the app stopped, deleting any -wal/-shm first or
// SQLite replays them onto it. Snapshots are never pruned: a backup tool does not delete backups.
const ROOT = process.cwd();
// A backup that silently snapshots the wrong file is worse than none.
const DB_PATH = resolveDbPath();
const BACKUP_DIR = path.join(ROOT, 'data', 'backups');

// 2026-08-02T13:45:12.345Z → 20260802-134512Z, sorting chronologically. The Z says UTC, or a 14:33
// JST snapshot reads as 05:33 and looks wrong.
function timestamp(): string {
  const iso = new Date().toISOString();
  return `${iso.slice(0, 10).replaceAll('-', '')}-${iso.slice(11, 19).replaceAll(':', '')}Z`;
}

function parseOut(args: string[]): string {
  const flag = args.find((a) => a.startsWith('--out='));
  if (flag) return path.resolve(flag.slice('--out='.length));
  return path.join(BACKUP_DIR, `blog-${timestamp()}.db`);
}

function main(): void {
  if (!existsSync(DB_PATH)) {
    console.error(`No DB at ${DB_PATH}; nothing to back up.`);
    process.exitCode = 1;
    return;
  }

  const dest = parseOut(process.argv.slice(2));
  // VACUUM INTO refuses to overwrite, as wanted, but says so generically.
  if (existsSync(dest)) {
    console.error(`Refusing to overwrite an existing backup at ${dest}.`);
    process.exitCode = 1;
    return;
  }
  mkdirSync(path.dirname(dest), { recursive: true });

  const db = new Database(DB_PATH, { readonly: true });
  try {
    db.prepare('VACUUM INTO ?').run(dest);
  } finally {
    db.close();
  }

  // Read it back: a backup nobody has opened is not known to be good.
  const copy = new Database(dest, { readonly: true });
  let integrity: string;
  let posts: number;
  try {
    integrity = (copy.pragma('integrity_check', { simple: true }) as string) ?? 'unknown';
    posts = (copy.prepare('SELECT count(*) AS c FROM posts').get() as { c: number }).c;
  } finally {
    copy.close();
  }

  console.log(`backed up ${DB_PATH}`);
  console.log(`        → ${dest}  ${formatBytes(statSync(dest).size)}`);
  console.log(`  integrity_check: ${integrity}, ${posts} post(s)`);

  if (integrity !== 'ok') {
    console.error('Integrity check did NOT return ok — treat this snapshot as suspect.');
    process.exitCode = 1;
  }
}

main();
