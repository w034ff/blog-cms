import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

// Reading drizzle/ — where the migrations are, what order they go in, and how a
// file is split into statements. All of that is drizzle's format rather than
// ours, so it is described once: a second copy is a second thing to fix when the
// format moves, and the two copies that preceded this module had already drifted
// (one ordered by journal entry, the other by filename).
export const MIGRATIONS_DIR = path.join(process.cwd(), 'drizzle');

export type Migration = {
  tag: string;
  /** Statements in apply order, already split and trimmed. */
  statements: string[];
  /** sha256 of the file as-is — what drizzle-orm's migrator records. */
  hash: string;
  /** The journal's `when`, which is what decides whether a migration has run. */
  when: number;
};

type JournalEntry = { idx: number; when: number; tag: string };

// Ordered by the journal rather than by filename. The journal is what drizzle
// itself reads, so it is the authority: a .sql file it does not list has not
// been generated as a migration and must not be applied as one.
export function readMigrations(): Migration[] {
  const journalPath = path.join(MIGRATIONS_DIR, 'meta', '_journal.json');
  if (!existsSync(journalPath)) throw new Error(`No journal at ${journalPath}`);
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: JournalEntry[] };

  return journal.entries
    .sort((a, b) => a.idx - b.idx)
    .map((entry) => {
      const sql = readFileSync(path.join(MIGRATIONS_DIR, `${entry.tag}.sql`), 'utf8');
      return {
        tag: entry.tag,
        statements: sql
          .split('--> statement-breakpoint')
          .map((statement) => statement.trim())
          .filter(Boolean),
        hash: createHash('sha256').update(sql).digest('hex'),
        when: entry.when,
      };
    });
}
