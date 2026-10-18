import { existsSync, readdirSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { resolveDbPath } from './db-path.mts';
import { formatBytes } from './format-bytes.mts';
import { openDb } from './open-db.mts';
import { addUploadRefs, referencedInDb } from './upload-refs.mts';

// Grace-period GC for data/uploads. Uploads land before the post is saved, so a file is deleted
// only when unreferenced AND older than the grace window. Dry-run by default.
//   node scripts/gc-uploads.mts                 # report only (dry-run)
//   node scripts/gc-uploads.mts --delete        # remove orphans
//   node scripts/gc-uploads.mts --grace-hours=48
const ROOT = process.cwd();
const UPLOAD_DIR = path.join(ROOT, 'data', 'uploads');
const POSTS_DIR = path.join(ROOT, 'content', 'posts');
// The DB may live elsewhere (scripts/db-path.mts); the wrong one means an empty reference set.
const DB_PATH = resolveDbPath();

function parseGraceHours(args: string[]): number {
  const flag = args.find((a) => a.startsWith('--grace-hours='));
  if (!flag) return 24;
  const n = Number(flag.slice('--grace-hours='.length));
  return Number.isFinite(n) && n >= 0 ? n : 24;
}

// The live DB (every column, scripts/upload-refs.mts) and the tracked .mdx, unioned: err on
// keeping. The ledger of who uploaded what (`uploads`) is not a reference and is not read here.
function collectReferenced(db: Database.Database | null): Set<string> {
  const refs = db ? referencedInDb(db) : new Set<string>();

  if (existsSync(POSTS_DIR)) {
    for (const file of readdirSync(POSTS_DIR).filter((f) => f.endsWith('.mdx'))) {
      addUploadRefs(refs, readFileSync(path.join(POSTS_DIR, file), 'utf8'));
    }
  }

  return refs;
}

// The ledger rows of files that were just deleted (docs/abuse-limits-requirements.md §6), so an
// image taken out of every post stops counting against the author who uploaded it. Immediate: this
// is its own process beside the app, and a deferred transaction that reads first cannot upgrade to
// a write after the app commits (scripts/open-db.mts). A DB the ledger migration has not reached
// has no rows to remove.
export function deleteLedgerRows(db: Database.Database, names: string[]): void {
  if (names.length === 0) return;
  const hasLedger = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'uploads'")
    .get();
  if (!hasLedger) return;
  const remove = db.prepare('DELETE FROM uploads WHERE name = ?');
  db.transaction(() => {
    for (const name of names) remove.run(name);
  }).immediate();
}

export type Orphan = { name: string; size: number; ageHours: number };

export type SweepResult = {
  files: number;
  skippedYoung: number;
  orphans: Orphan[];
  // The orphans actually removed: all of them under `apply`, none otherwise.
  deleted: Orphan[];
};

// Finds the unreferenced files past the grace window and, under `apply`, deletes them and their
// ledger rows. `ledger` is a writable handle, or null when nothing is to be written. A dry run
// (`apply` false) writes nothing anywhere.
export function sweepUploads(options: {
  uploadDir: string;
  refs: Set<string>;
  graceMs: number;
  now: number;
  apply: boolean;
  ledger: Database.Database | null;
}): SweepResult {
  const { uploadDir, refs, graceMs, now, apply, ledger } = options;
  const files = readdirSync(uploadDir).filter((f) => statSync(path.join(uploadDir, f)).isFile());

  const orphans: Orphan[] = [];
  let skippedYoung = 0;
  for (const name of files) {
    if (refs.has(name)) continue;
    const stat = statSync(path.join(uploadDir, name));
    const ageMs = now - stat.mtimeMs;
    if (ageMs < graceMs) {
      skippedYoung += 1;
      continue;
    }
    orphans.push({ name, size: stat.size, ageHours: ageMs / (60 * 60 * 1000) });
  }

  const deleted: Orphan[] = [];
  if (apply) {
    // The rows follow the files even when a later unlink throws: a row left for a deleted file
    // would count against its author with no later sweep to clear it.
    try {
      for (const orphan of orphans) {
        unlinkSync(path.join(uploadDir, orphan.name));
        deleted.push(orphan);
      }
    } finally {
      if (ledger)
        deleteLedgerRows(
          ledger,
          deleted.map((orphan) => orphan.name),
        );
    }
  }
  return { files: files.length, skippedYoung, orphans, deleted };
}

function main(): void {
  const args = process.argv.slice(2);
  const apply = args.includes('--delete') || args.includes('--apply');
  const graceHours = parseGraceHours(args);
  const graceMs = graceHours * 60 * 60 * 1000;

  if (!existsSync(UPLOAD_DIR)) {
    console.log(`No uploads dir at ${UPLOAD_DIR}; nothing to do.`);
    return;
  }

  const dbPresent = existsSync(DB_PATH);
  if (!dbPresent) {
    console.warn(`WARNING: no DB at ${DB_PATH} — references come from .mdx only.`);
    if (apply) {
      console.error(
        'Refusing to --delete without the DB (could remove referenced images). Aborting.',
      );
      process.exitCode = 1;
      return;
    }
  }

  // Writable only for --delete, which has ledger rows to remove; a dry run stays read-only.
  const db = !dbPresent
    ? null
    : apply
      ? openDb(DB_PATH)
      : new Database(DB_PATH, { readonly: true });
  try {
    const refs = collectReferenced(db);
    const { files, skippedYoung, orphans, deleted } = sweepUploads({
      uploadDir: UPLOAD_DIR,
      refs,
      graceMs,
      now: Date.now(),
      apply,
      ledger: apply ? db : null,
    });

    const youngNote = skippedYoung > 0 ? `, ${skippedYoung} unreferenced-but-young (kept)` : '';
    console.log(
      `uploads: ${files} file(s), ${refs.size} referenced, grace ${graceHours}h${youngNote}`,
    );

    if (orphans.length === 0) {
      console.log('No orphaned files to remove.');
      return;
    }

    let freed = 0;
    for (const orphan of orphans) {
      freed += orphan.size;
      const label = apply ? 'deleted' : 'orphan ';
      console.log(
        `${label} ${orphan.name}  ${formatBytes(orphan.size)}  ${orphan.ageHours.toFixed(0)}h old`,
      );
    }

    console.log(
      apply
        ? `Removed ${deleted.length} file(s), freed ${formatBytes(freed)}.`
        : `${orphans.length} orphan(s), ${formatBytes(freed)} reclaimable. Re-run with --delete to remove.`,
    );
  } finally {
    db?.close();
  }
}

if (import.meta.main) main();
