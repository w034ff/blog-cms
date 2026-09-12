import { openDb } from './open-db.mts';
import { resolveDbPath } from './db-path.mts';

// One-off repair for markdown written before components/editor/image-extension.ts existed.
//
// tiptap-markdown serialized the (block) image node with prosemirror-markdown's *inline* image
// serializer, which emits `![alt](src)` and never closes the block. Whatever followed the image
// was written onto the image's own line, so a quote or a fence right after one came out as
// `![alt](src)> quoted` / `![alt](src)```lang`. Markdown then reads that as a single paragraph:
// the image renders and the rest shows up as literal body text on the published page.
//
// The serializer fix stops new corruption but does not touch what is already stored, so this
// puts the missing blank line back in both places a post's markdown lives.
//
// The two columns are NOT the same kind of value, and treating them alike corrupts the database:
//   posts.body          TEXT — raw markdown, repaired directly
//   posts.draft_content JSON — the whole working copy ({title, description, category, tags,
//                              body}), declared `{ mode: 'json' }` in lib/db/schema.ts, so
//                              drizzle JSON.parses it on every read. Its markdown is the `body`
//                              *field inside* that document. Running a text substitution over
//                              the stored JSON inserts raw newlines into a JSON string literal,
//                              which is illegal — every read of that row then throws
//                              "Bad control character in string literal in JSON". Decode, repair
//                              the field, re-encode.
//
// Deliberately NOT done by opening the post in the editor and re-saving: an affected post loads
// with the stray `>` as literal paragraph text, which re-serializes to the HTML entity `&gt;`.

const DB_PATH = resolveDbPath();

// An image immediately followed by a non-space character. The space matters: `![a](b) text` is a
// legitimately inline image with content after it, while the corruption always butts the next
// block straight against the closing paren. `[^)\s]*` for the URL keeps the match from running
// past the first `)`.
const GLUED_IMAGE = /(!\[[^\]]*\]\([^)\s]*\))(?=\S)/g;

// Match the line ending already in the text, so a CRLF document doesn't end up with mixed ones.
function repair(markdown: string): string {
  const newline = markdown.includes('\r\n') ? '\r\n' : '\n';
  return markdown.replace(GLUED_IMAGE, `$1${newline}${newline}`);
}

// Returns the re-encoded document, or null when its markdown needed no change.
function repairDraftContent(stored: string, id: number): string | null {
  let doc: unknown;
  try {
    doc = JSON.parse(stored);
  } catch {
    // Already-invalid JSON — the exact state a raw text substitution over this column produces
    // (see above), so a row can arrive here holding one. There is no `body` field to reach, and
    // re-encoding is impossible; the only thing to decide is whether to stop. Skipping keeps the
    // run going: `body` is a separate column and still repairable, and throwing here would strand
    // every later post unprocessed behind a stack trace. Report it so the row isn't silently
    // passed over — a draft that won't parse needs a human anyway, since every read of it throws.
    console.warn(`skipped draft_content: id=${id} does not hold valid JSON`);
    return null;
  }
  if (typeof doc !== 'object' || doc === null) return null;
  const body = (doc as { body?: unknown }).body;
  if (typeof body !== 'string') return null;
  const fixed = repair(body);
  if (fixed === body) return null;
  return JSON.stringify({ ...doc, body: fixed });
}

type Row = { id: number; title: string; body: string; draft_content: string | null };

function main(): void {
  const dryRun = process.argv.includes('--dry-run');
  const db = openDb(DB_PATH);
  const rows = db.prepare('SELECT id, title, body, draft_content FROM posts').all() as Row[];
  const updateBody = db.prepare('UPDATE posts SET body = @body WHERE id = @id');
  const updateDraft = db.prepare('UPDATE posts SET draft_content = @draft WHERE id = @id');

  // One transaction per row. The two columns hold two copies of the same text (see above), so a
  // crash between the statements would leave a post whose published markdown is repaired and whose
  // editor working copy is not — and the next save in the editor would write the corruption back
  // over the fix. Per row rather than one for the whole table so an interrupted run still leaves
  // every post it touched coherent; re-running is safe either way, since repaired text no longer
  // matches GLUED_IMAGE. A null column means "this one needed no change".
  // `.immediate` so the write lock is taken as the transaction opens. A deferred
  // BEGIN would read first and upgrade, and SQLite refuses that upgrade with
  // SQLITE_BUSY_SNAPSHOT — which busy_timeout does not retry — if a live app
  // committed in between.
  const repairRow = db.transaction((id: number, body: string | null, draft: string | null) => {
    if (body !== null) updateBody.run({ id, body });
    if (draft !== null) updateDraft.run({ id, draft });
  }).immediate;

  let changed = 0;
  for (const row of rows) {
    const repairedBody = repair(row.body);
    const body = repairedBody === row.body ? null : repairedBody;
    const draft =
      typeof row.draft_content === 'string' ? repairDraftContent(row.draft_content, row.id) : null;
    if (body === null && draft === null) continue;

    const columns: string[] = [];
    if (body !== null) columns.push('body');
    if (draft !== null) columns.push('draft_content');
    if (!dryRun) repairRow(row.id, body, draft);
    console.log(
      `${dryRun ? 'would fix' : 'fixed'}: id=${row.id} "${row.title}" (${columns.join(', ')})`,
    );
    changed += 1;
  }

  db.close();
  console.log(
    changed === 0
      ? 'No glued image markdown found; nothing to do.'
      : `${dryRun ? 'Would repair' : 'Repaired'} ${changed} post(s).`,
  );
}

main();
