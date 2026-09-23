import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { isCategoryId } from '@/lib/content';
import { readMigrations } from '@/scripts/migrations.mts';

// drizzle/0008 moves the free-text categories onto the fixed list. Run against a database built up
// to the migration before it, with the values that were in use when the list became fixed, so the
// mapping is checked on the shapes it has to meet: the column, the working copy, and revisions.
const TAG = '0008_fixed_categories';
const migrations = readMigrations();
const index = migrations.findIndex((migration) => migration.tag === TAG);

function databaseBefore(): Database.Database {
  const sqlite = new Database(':memory:');
  for (const migration of migrations.slice(0, index)) {
    for (const statement of migration.statements) sqlite.exec(statement);
  }
  return sqlite;
}

function applyMigration(sqlite: Database.Database): void {
  for (const statement of migrations[index].statements) sqlite.exec(statement);
}

function insertPost(
  sqlite: Database.Database,
  category: string,
  draftCategory: string | null,
): number {
  const draftContent =
    draftCategory === null
      ? null
      : JSON.stringify({ title: 't', category: draftCategory, tags: [], body: '', thumbnail: '' });
  return Number(
    sqlite
      .prepare(`INSERT INTO posts (title, date, category, draft_content) VALUES ('t', '', ?, ?)`)
      .run(category, draftContent).lastInsertRowid,
  );
}

describe(TAG, () => {
  it('is in the journal', () => {
    expect(index).toBeGreaterThan(0);
  });

  it.each([
    ['tech-notes', 'tech'],
    ['announcements', 'blog'],
    ['uncategorized', 'tech'],
    ['開発', 'tech'],
    ['tech', 'tech'],
    ['blog', 'blog'],
  ])('maps %s to %s in the column and the working copy', (before, after) => {
    const sqlite = databaseBefore();
    const id = insertPost(sqlite, before, before);
    applyMigration(sqlite);
    const row = sqlite
      .prepare(
        `SELECT category, json_extract(draft_content, '$.category') AS draft FROM posts WHERE id = ?`,
      )
      .get(id);
    expect(row).toEqual({ category: after, draft: after });
  });

  it('leaves a post with no working copy without one', () => {
    const sqlite = databaseBefore();
    const id = insertPost(sqlite, 'tech-notes', null);
    applyMigration(sqlite);
    expect(sqlite.prepare(`SELECT draft_content FROM posts WHERE id = ?`).get(id)).toEqual({
      draft_content: null,
    });
  });

  it('moves the revisions too, leaving the rest of their content alone', () => {
    const sqlite = databaseBefore();
    const id = insertPost(sqlite, 'announcements', null);
    const content = {
      title: 'kept',
      category: 'announcements',
      tags: ['a'],
      body: 'b',
      thumbnail: '',
    };
    sqlite
      .prepare(
        `INSERT INTO post_revisions (post_id, created_at, reason, content) VALUES (?, 0, 'publish', ?)`,
      )
      .run(id, JSON.stringify(content));
    applyMigration(sqlite);
    const row = sqlite.prepare(`SELECT content FROM post_revisions WHERE post_id = ?`).get(id);
    const stored: unknown = JSON.parse((row as { content: string }).content);
    expect(stored).toEqual({ ...content, category: 'blog' });
    expect(isCategoryId((stored as { category: unknown }).category)).toBe(true);
  });
});
