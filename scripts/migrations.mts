import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

// drizzle/'s format (location, order, statement splitting) described once; the two copies before
// this had drifted.
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

// By journal, not filename: drizzle reads the journal, so an unlisted .sql is not a migration.
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
