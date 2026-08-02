import { existsSync, readdirSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { resolveDbPath } from './db-path.mts';
import { formatBytes } from './format-bytes.mts';

// Grace-period garbage collector for public/uploads. Uploads are written the
// moment an image is pasted/dropped — before the post is saved — so a file can
// be on disk while still unreferenced. We delete a file only when it is BOTH
// unreferenced AND older than the grace window, so a just-uploaded-not-yet-saved
// image is never removed. Dry-run by default; pass --delete to actually unlink.
//   node scripts/gc-uploads.mts                 # report only (dry-run)
//   node scripts/gc-uploads.mts --delete        # remove orphans
//   node scripts/gc-uploads.mts --grace-hours=48
const ROOT = process.cwd();
const UPLOAD_DIR = path.join(ROOT, 'public', 'uploads');
const POSTS_DIR = path.join(ROOT, 'content', 'posts');
// Uploads live next to the app, but the DB may not — see scripts/db-path.mts.
// Getting this wrong here means sweeping against an empty reference set.
const DB_PATH = resolveDbPath();

const UPLOAD_REF = /\/uploads\/([A-Za-z0-9._-]+)/g;

type PostTextRow = { body: string | null; description: string | null; title: string | null };

function parseGraceHours(args: string[]): number {
  const flag = args.find((a) => a.startsWith('--grace-hours='));
  if (!flag) return 24;
  const n = Number(flag.slice('--grace-hours='.length));
  return Number.isFinite(n) && n >= 0 ? n : 24;
}

// Filenames anything could point at: the live DB post bodies (the editor's
// source of truth) AND the version-controlled .mdx (the seed copy). Taking the
// union errs on the side of keeping a file.
function collectReferenced(): { refs: Set<string>; dbPresent: boolean } {
  const refs = new Set<string>();

  function addFrom(text: string | null | undefined): void {
    if (!text) return;
    for (const match of text.matchAll(UPLOAD_REF)) refs.add(match[1]);
  }

  const dbPresent = existsSync(DB_PATH);
  if (dbPresent) {
    const db = new Database(DB_PATH, { readonly: true });
    const rows = db.prepare('SELECT body, description, title FROM posts').all() as PostTextRow[];
    db.close();
    for (const row of rows) {
      addFrom(row.body);
      addFrom(row.description);
      addFrom(row.title);
    }
  }

  if (existsSync(POSTS_DIR)) {
    for (const file of readdirSync(POSTS_DIR).filter((f) => f.endsWith('.mdx'))) {
      addFrom(readFileSync(path.join(POSTS_DIR, file), 'utf8'));
    }
  }

  return { refs, dbPresent };
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

  const { refs, dbPresent } = collectReferenced();
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

  const now = Date.now();
  const files = readdirSync(UPLOAD_DIR).filter((f) => statSync(path.join(UPLOAD_DIR, f)).isFile());

  const orphans: { name: string; size: number; ageHours: number }[] = [];
  let skippedYoung = 0;
  for (const name of files) {
    if (refs.has(name)) continue;
    const stat = statSync(path.join(UPLOAD_DIR, name));
    const ageMs = now - stat.mtimeMs;
    if (ageMs < graceMs) {
      skippedYoung += 1;
      continue;
    }
    orphans.push({ name, size: stat.size, ageHours: ageMs / (60 * 60 * 1000) });
  }

  const youngNote = skippedYoung > 0 ? `, ${skippedYoung} unreferenced-but-young (kept)` : '';
  console.log(
    `uploads: ${files.length} file(s), ${refs.size} referenced, grace ${graceHours}h${youngNote}`,
  );

  if (orphans.length === 0) {
    console.log('No orphaned files to remove.');
    return;
  }

  let freed = 0;
  for (const orphan of orphans) {
    freed += orphan.size;
    if (apply) unlinkSync(path.join(UPLOAD_DIR, orphan.name));
    const label = apply ? 'deleted' : 'orphan ';
    console.log(
      `${label} ${orphan.name}  ${formatBytes(orphan.size)}  ${orphan.ageHours.toFixed(0)}h old`,
    );
  }

  console.log(
    apply
      ? `Removed ${orphans.length} file(s), freed ${formatBytes(freed)}.`
      : `${orphans.length} orphan(s), ${formatBytes(freed)} reclaimable. Re-run with --delete to remove.`,
  );
}

main();
