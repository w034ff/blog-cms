import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { readMigrations } from '@/scripts/migrations.mts';

// drizzle/0010 fills the new dictionary with the tags already in use, from the three places a
// post's tags live. Run against a database built up to the migration before it.
const TAG = '0010_backfill_tag_dictionary';
const migrations = readMigrations();
const index = migrations.findIndex((migration) => migration.tag === TAG);

function databaseBefore(): Database.Database {
  const sqlite = new Database(':memory:');
  for (const migration of migrations.slice(0, index)) {
    for (const statement of migration.statements) sqlite.exec(statement);
  }
  return sqlite;
}

function content(tags: unknown): string {
  return JSON.stringify({ title: 't', category: 'tech', tags, body: '', thumbnail: '' });
}

describe(TAG, () => {
  it('is in the journal', () => {
    expect(index).toBeGreaterThan(0);
  });

  it('admits every tag in use, once, named after itself', () => {
    const sqlite = databaseBefore();
    const insert = sqlite.prepare(
      `INSERT INTO posts (title, date, tags, draft_content) VALUES ('t', '', ?, ?)`,
    );
    const live = Number(insert.run(JSON.stringify(['nextjs', 'react']), null).lastInsertRowid);
    insert.run(JSON.stringify(['react']), content(['rsc', 'react']));
    insert.run(JSON.stringify([]), null);
    sqlite
      .prepare(
        `INSERT INTO post_revisions (post_id, created_at, reason, content) VALUES (?, 0, 'publish', ?)`,
      )
      .run(live, content(['only-in-a-revision', '', '  ', 7]));

    for (const statement of migrations[index].statements) sqlite.exec(statement);

    expect(sqlite.prepare(`SELECT slug, name FROM tags ORDER BY slug`).all()).toEqual([
      { slug: 'nextjs', name: 'nextjs' },
      { slug: 'only-in-a-revision', name: 'only-in-a-revision' },
      { slug: 'react', name: 'react' },
      { slug: 'rsc', name: 'rsc' },
    ]);
  });
});
