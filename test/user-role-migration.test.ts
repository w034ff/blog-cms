import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { readMigrations } from '@/scripts/migrations.mts';

// drizzle/0012 adds `users.role` (docs/editor-requirements.md §12.33.1). The account that already
// exists is the admin — if it came out an author, the only person able to run /admin/tags would be
// locked out of it. Run against a database built up to the migration before it.
const TAG = '0012_user_role';
const migrations = readMigrations();
const index = migrations.findIndex((migration) => migration.tag === TAG);

describe(TAG, () => {
  it('is in the journal', () => {
    expect(index).toBeGreaterThan(0);
  });

  it('makes the existing account an admin, and a later one an author', () => {
    const sqlite = new Database(':memory:');
    for (const migration of migrations.slice(0, index)) {
      for (const statement of migration.statements) sqlite.exec(statement);
    }
    sqlite.prepare(`INSERT INTO users (username, password_hash) VALUES ('owner', 'x')`).run();

    for (const statement of migrations[index].statements) sqlite.exec(statement);
    sqlite.prepare(`INSERT INTO users (username, password_hash) VALUES ('later', 'x')`).run();

    expect(sqlite.prepare(`SELECT username, role FROM users ORDER BY id`).all()).toEqual([
      { username: 'owner', role: 'admin' },
      { username: 'later', role: 'author' },
    ]);
  });
});
