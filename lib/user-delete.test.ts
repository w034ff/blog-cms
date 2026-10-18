import { beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestSqlite } from '@/test/db';
import { deleteUserAccount, isWithdrawalDue } from './user-delete';

const DUE = '2026-11-18T15:00:00.000Z';
const BEFORE_DUE = new Date('2026-11-18T14:59:59.999Z');

let sqlite: Database.Database;

function addUser(id: number, role: 'admin' | 'author', extra: Record<string, string> = {}): void {
  sqlite
    .prepare(
      'INSERT INTO users (id, role, display_name, suspended_at, withdrawal_due_at) VALUES (?, ?, ?, ?, ?)',
    )
    .run(id, role, `user ${id}`, extra.suspendedAt ?? null, extra.withdrawalDueAt ?? null);
  sqlite
    .prepare(
      "INSERT INTO display_name_history (user_id, display_name, kind, changed_at) VALUES (?, ?, 'initial', '2026-10-01T00:00:00Z')",
    )
    .run(id, `user ${id}`);
}

function addPost(id: number, authorId: number, kind: 'post' | 'scribble' = 'post'): void {
  sqlite
    .prepare(
      "INSERT INTO posts (id, slug, title, date, kind, draft, author_id) VALUES (?, ?, 't', '2026-10-01', ?, 0, ?)",
    )
    .run(id, `p${id}`, kind, authorId);
  sqlite
    .prepare(
      "INSERT INTO post_revisions (post_id, created_at, reason, content) VALUES (?, 0, 'publish', '{}')",
    )
    .run(id);
}

function addLibraryRows(userId: number, postId: number): void {
  for (const table of ['bookmarks', 'likes', 'post_views']) {
    const column = table === 'post_views' ? 'viewed_at' : 'created_at';
    sqlite
      .prepare(`INSERT INTO ${table} (user_id, post_id, ${column}) VALUES (?, ?, 0)`)
      .run(userId, postId);
  }
}

// The same image under two accounts is two rows (docs/abuse-limits-requirements.md §4).
function addLedgerRow(userId: number, name: string): void {
  sqlite
    .prepare(
      "INSERT INTO uploads (name, user_id, bytes, created_at) VALUES (?, ?, 1000, '2026-10-01T00:00:00.000Z')",
    )
    .run(name, userId);
}

function count(sql: string, ...params: unknown[]): number {
  return Number(
    sqlite
      .prepare(sql)
      .pluck()
      .get(...params),
  );
}

// Every (table, column) in the schema that can hold a user's or a post's id.
function idColumns(): { table: string; column: string }[] {
  const tables = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .pluck()
    .all();
  return tables.flatMap((table) =>
    sqlite
      .prepare(`SELECT name FROM pragma_table_info(?)`)
      .pluck()
      .all(table)
      .filter((column) => column === 'post_id' || column === 'user_id' || column === 'author_id')
      .map((column) => ({ table: String(table), column: String(column) })),
  );
}

beforeEach(() => {
  sqlite = createTestSqlite();
  addUser(1, 'admin');
  addUser(2, 'author', { suspendedAt: '2026-10-10T00:00:00Z' });
  addUser(3, 'author');
  addPost(10, 2);
  addPost(11, 2, 'scribble');
  addPost(20, 3);
  // Someone else's marks on the deleted author's posts, and theirs on someone else's.
  addLibraryRows(3, 10);
  addLibraryRows(2, 20);
  addLibraryRows(3, 20);
  addLedgerRow(2, 'shared.png');
  addLedgerRow(2, 'only-2.png');
  addLedgerRow(3, 'shared.png');
});

// docs/abuse-limits-requirements.md §8 row 9.
describe('deleteUserAccount and the upload ledger', () => {
  it("removes the deleted account's rows and keeps everyone else's", () => {
    expect(deleteUserAccount(sqlite, 2, { kind: 'suspended' })).toBe(true);
    expect(count('SELECT count(*) FROM uploads WHERE user_id = 2')).toBe(0);
    expect(count("SELECT count(*) FROM uploads WHERE user_id = 3 AND name = 'shared.png'")).toBe(1);
  });

  it('keeps the rows when the deletion is refused', () => {
    expect(deleteUserAccount(sqlite, 3, { kind: 'suspended' })).toBe(false);
    expect(count('SELECT count(*) FROM uploads')).toBe(3);
  });
});

describe('deleteUserAccount (docs/multi-author-requirements.md §12.3)', () => {
  it("removes the account, its posts and scribbles, their revisions and library rows, and the account's own library and name history", () => {
    expect(deleteUserAccount(sqlite, 2, { kind: 'suspended' })).toBe(true);

    expect(count('SELECT count(*) FROM users WHERE id = 2')).toBe(0);
    expect(count('SELECT count(*) FROM posts WHERE author_id = 2')).toBe(0);
    expect(count('SELECT count(*) FROM post_revisions WHERE post_id IN (10, 11)')).toBe(0);
    expect(count('SELECT count(*) FROM bookmarks WHERE post_id = 10')).toBe(0);
    expect(count('SELECT count(*) FROM likes WHERE user_id = 2')).toBe(0);
    expect(count('SELECT count(*) FROM display_name_history WHERE user_id = 2')).toBe(0);

    // Everyone else's rows stay.
    expect(count('SELECT count(*) FROM users')).toBe(2);
    expect(count('SELECT count(*) FROM posts WHERE id = 20')).toBe(1);
    expect(count('SELECT count(*) FROM post_revisions WHERE post_id = 20')).toBe(1);
    expect(count('SELECT count(*) FROM bookmarks WHERE user_id = 3 AND post_id = 20')).toBe(1);
    expect(count('SELECT count(*) FROM display_name_history')).toBe(2);
  });

  it('leaves no column of any table holding the deleted account or its posts', () => {
    const columns = idColumns();
    // A schema change that renamed these would make the sweep below vacuous.
    expect(columns.length).toBeGreaterThanOrEqual(9);
    deleteUserAccount(sqlite, 2, { kind: 'suspended' });
    for (const { table, column } of columns) {
      const ids = column === 'post_id' ? [10, 11] : [2];
      const held = count(
        `SELECT count(*) FROM ${table} WHERE ${column} IN (${ids.map(() => '?').join(', ')})`,
        ...ids,
      );
      expect({ table, column, held }).toEqual({ table, column, held: 0 });
    }
  });

  it('never deletes an admin, suspended or withdrawing', () => {
    sqlite
      .prepare('UPDATE users SET suspended_at = ?, withdrawal_due_at = ? WHERE id = 1')
      .run('2026-10-10T00:00:00Z', '2026-01-01T00:00:00Z');
    expect(deleteUserAccount(sqlite, 1, { kind: 'suspended' })).toBe(false);
    expect(deleteUserAccount(sqlite, 1, { kind: 'withdrawal-due', now: new Date() })).toBe(false);
    expect(count('SELECT count(*) FROM users WHERE id = 1')).toBe(1);
  });

  it('refuses an author who is not suspended, and an id that does not exist', () => {
    expect(deleteUserAccount(sqlite, 3, { kind: 'suspended' })).toBe(false);
    expect(deleteUserAccount(sqlite, 99, { kind: 'suspended' })).toBe(false);
    expect(count('SELECT count(*) FROM posts WHERE author_id = 3')).toBe(1);
  });

  it('deletes a withdrawal only once it is due, and not once it is cancelled', () => {
    sqlite.prepare('UPDATE users SET withdrawal_due_at = ? WHERE id = 3').run(DUE);
    expect(deleteUserAccount(sqlite, 3, { kind: 'withdrawal-due', now: BEFORE_DUE })).toBe(false);

    // Cancelled after the purge listed it: the check inside the transaction sees null.
    sqlite.prepare('UPDATE users SET withdrawal_due_at = NULL WHERE id = 3').run();
    expect(deleteUserAccount(sqlite, 3, { kind: 'withdrawal-due', now: new Date(DUE) })).toBe(
      false,
    );

    sqlite.prepare('UPDATE users SET withdrawal_due_at = ? WHERE id = 3').run(DUE);
    expect(deleteUserAccount(sqlite, 3, { kind: 'withdrawal-due', now: new Date(DUE) })).toBe(true);
    expect(count('SELECT count(*) FROM posts WHERE author_id = 3')).toBe(0);
  });
});

describe('isWithdrawalDue', () => {
  it('is due from the deadline on, and never for an unreadable value', () => {
    expect(isWithdrawalDue(DUE, BEFORE_DUE)).toBe(false);
    expect(isWithdrawalDue(DUE, new Date(DUE))).toBe(true);
    expect(isWithdrawalDue('not a date', new Date(DUE))).toBe(false);
  });
});
