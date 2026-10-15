import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { readMigrations } from '@/scripts/migrations.mts';

// drizzle/0015 adds `posts.author_id` (docs/library-requirements.md §3.1, §8 row 1). Every row that
// exists before it was written by the first admin; a row left without one would be nobody's own,
// and its writer could like it. Run against a database built up to the migration before it.
const TAG = '0015_library';
const migrations = readMigrations();
const index = migrations.findIndex((migration) => migration.tag === TAG);

function upToBefore(): Database.Database {
  const sqlite = new Database(':memory:');
  for (const migration of migrations.slice(0, index)) {
    for (const statement of migration.statements) sqlite.exec(statement);
  }
  return sqlite;
}

function migrate(sqlite: Database.Database): void {
  for (const statement of migrations[index].statements) sqlite.exec(statement);
}

describe(TAG, () => {
  it('is in the journal', () => {
    expect(index).toBeGreaterThan(0);
  });

  it('gives every existing row the admin with the smallest id', () => {
    const sqlite = upToBefore();
    const user = sqlite.prepare(
      `INSERT INTO users (username, password_hash, role) VALUES (?, '', ?)`,
    );
    user.run('author', 'author');
    user.run('first', 'admin');
    user.run('second', 'admin');
    const post = sqlite.prepare(
      `INSERT INTO posts (slug, title, date, draft) VALUES (?, 'T', '', ?)`,
    );
    post.run('published', 0);
    post.run('draft', 1);

    migrate(sqlite);

    const first = sqlite
      .prepare<[], { id: number }>(`SELECT id FROM users WHERE username = 'first'`)
      .get()?.id;
    expect(first).toBeDefined();
    expect(
      sqlite.prepare(`SELECT slug, author_id AS authorId FROM posts ORDER BY id`).all(),
    ).toEqual([
      { slug: 'published', authorId: first },
      { slug: 'draft', authorId: first },
    ]);
  });

  it('leaves rows without an author when there is no admin yet', () => {
    const sqlite = upToBefore();
    sqlite.prepare(`INSERT INTO posts (slug, title, date) VALUES ('s', 'T', '')`).run();
    migrate(sqlite);
    expect(sqlite.prepare(`SELECT author_id AS authorId FROM posts`).get()).toEqual({
      authorId: null,
    });
  });
});
