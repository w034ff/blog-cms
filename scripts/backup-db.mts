import { existsSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

// Point-in-time snapshot of the SQLite DB.
//
// Copying blog.db with `cp` is NOT a backup: the DB runs in WAL mode, so
// committed transactions can still live in the -wal sidecar and a lone
// blog.db is a stale, possibly inconsistent snapshot. `VACUUM INTO` makes
// SQLite write the snapshot itself — one self-contained file, WAL content
// folded in, compacted — so the output needs no sidecars to be restorable.
//
//   node scripts/backup-db.mts                    # data/backups/blog-<stamp>.db
//   node scripts/backup-db.mts --out=/mnt/x/b.db  # explicit destination
//
// Restoring is a file copy back over data/blog.db with the app stopped (delete
// any leftover -wal/-shm alongside it first, or SQLite will replay them onto
// the restored file).
//
// Old snapshots are never pruned — deleting backups is not something a backup
// tool should do on its own.
const ROOT = process.cwd();
// Mirrors lib/db/index.ts: a deployment can point the app at a DB outside the
// repo, and a backup that silently snapshots the wrong file is worse than none.
const DB_PATH = process.env.BLOG_DB_PATH
  ? path.resolve(process.env.BLOG_DB_PATH)
  : path.join(ROOT, 'data', 'blog.db');
const BACKUP_DIR = path.join(ROOT, 'data', 'backups');

// 2026-08-02T13:45:12.345Z → 20260802-134512Z, sorts chronologically as a filename.
// The trailing Z is not decoration: the stamp is UTC, and without it a snapshot
// taken at 14:33 JST reads as "05:33" and looks like the wrong file.
function timestamp(): string {
  const iso = new Date().toISOString();
  return `${iso.slice(0, 10).replaceAll('-', '')}-${iso.slice(11, 19).replaceAll(':', '')}Z`;
}

function parseOut(args: string[]): string {
  const flag = args.find((a) => a.startsWith('--out='));
  if (flag) return path.resolve(flag.slice('--out='.length));
  return path.join(BACKUP_DIR, `blog-${timestamp()}.db`);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function main(): void {
  if (!existsSync(DB_PATH)) {
    console.error(`No DB at ${DB_PATH}; nothing to back up.`);
    process.exitCode = 1;
    return;
  }

  const dest = parseOut(process.argv.slice(2));
  // VACUUM INTO refuses to overwrite, which is the behaviour we want — but it
  // reports it as a generic "output file already exists", so say it plainly.
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

  // Read the snapshot back rather than trusting that it was written: a backup
  // nobody has opened is a backup nobody knows is good.
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
