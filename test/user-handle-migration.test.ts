import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { readMigrations } from '@/scripts/migrations.mts';

// drizzle/0021 adds `users.handle` (docs/multi-author-requirements.md §13.2, criterion 49). Every
// account that already exists must come out with its automatic ID, or it would have none, and the
// unique index must hold from then on. Run against a database built up to the migration before it.
const TAG = '0021_user_handle';
const migrations = readMigrations();
const index = migrations.findIndex((migration) => migration.tag === TAG);

describe(TAG, () => {
  it('is in the journal', () => {
    expect(index).toBeGreaterThan(0);
  });

  it('gives every existing account user<id>, unchosen, and refuses a duplicate after', () => {
    const sqlite = new Database(':memory:');
    for (const migration of migrations.slice(0, index)) {
      for (const statement of migration.statements) sqlite.exec(statement);
    }
    sqlite
      .prepare(`INSERT INTO users (id, username, password_hash) VALUES (1, 'owner', 'x')`)
      .run();
    sqlite.prepare(`INSERT INTO users (id, role) VALUES (7, 'author')`).run();

    for (const statement of migrations[index].statements) sqlite.exec(statement);

    expect(
      sqlite.prepare(`SELECT id, handle, handle_chosen_at FROM users ORDER BY id`).all(),
    ).toEqual([
      { id: 1, handle: 'user1', handle_chosen_at: null },
      { id: 7, handle: 'user7', handle_chosen_at: null },
    ]);
    expect(() => sqlite.prepare(`UPDATE users SET handle = 'user1' WHERE id = 7`).run()).toThrow(
      /UNIQUE/,
    );
  });
});
