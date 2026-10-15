import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { readMigrations } from '@/scripts/migrations.mts';

// drizzle/0014 adds `posts.kind` (docs/scribble-requirements.md §3.1, §8 row 1). Every row that
// exists before it is a blog post; one read as a scribble would vanish from the home page and the
// RSS feed. Run against a database built up to the migration before it.
const TAG = '0014_post_kind';
const migrations = readMigrations();
const index = migrations.findIndex((migration) => migration.tag === TAG);

describe(TAG, () => {
  it('is in the journal', () => {
    expect(index).toBeGreaterThan(0);
  });

  it('makes every existing row a post', () => {
    const sqlite = new Database(':memory:');
    for (const migration of migrations.slice(0, index)) {
      for (const statement of migration.statements) sqlite.exec(statement);
    }
    const insert = sqlite.prepare(
      `INSERT INTO posts (slug, title, date, draft) VALUES (?, 'Title', '2026-01-01', ?)`,
    );
    insert.run('published', 0);
    insert.run('draft', 1);

    for (const statement of migrations[index].statements) sqlite.exec(statement);

    expect(sqlite.prepare(`SELECT slug, kind FROM posts ORDER BY id`).all()).toEqual([
      { slug: 'published', kind: 'post' },
      { slug: 'draft', kind: 'post' },
    ]);
  });
});
