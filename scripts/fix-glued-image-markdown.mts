import { openDb } from './open-db.mts';
import { resolveDbPath } from './db-path.mts';

// One-off repair for markdown written before components/editor/image-extension.ts existed: the
// inline image serializer never closed the block, so `![alt](src)> quoted` became one paragraph.
// The serializer fix stops new damage; this adds the missing blank line where posts store markdown.
//
// **The two columns differ, and treating them alike corrupts the database:**
//   posts.body          TEXT: raw markdown, repaired directly
//   posts.draft_content JSON (`{ mode: 'json' }`, lib/db/schema.ts): its markdown is the `body`
//                       field inside. A text substitution over it puts raw newlines in a JSON
//                       string, and every read then throws. Decode, repair the field, re-encode.
//
// Not by re-saving in the editor: an affected post loads with `>` as text, saved back as `&gt;`.

const DB_PATH = resolveDbPath();

// An image butted against the next character. `![a](b) text` is a legitimate inline image; the
// corruption never has the space. `[^)\s]*` stops at the first `)`.
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
    // Already-invalid JSON, as a raw substitution would leave it: no field to reach. Skip and
    // report, so `body` and later posts still get repaired and a human sees the row.
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

  // One transaction per row: the columns hold two copies of the text, and a crash between them
  // would let the editor write the corruption back. Re-running is safe (repaired text no longer
  // matches). `.immediate`: a deferred BEGIN upgrading to a write gets SQLITE_BUSY_SNAPSHOT, not
  // retried by busy_timeout, if the live app committed in between.
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
