import { beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestSqlite } from '@/test/db';
import { purgeWithdrawn } from './purge-withdrawn.mts';

const NOW = new Date('2026-11-20T00:00:00.000Z');
let sqlite: Database.Database;

function addUser(id: number, role: string, dueAt: string | null): void {
  sqlite
    .prepare('INSERT INTO users (id, role, withdrawal_due_at) VALUES (?, ?, ?)')
    .run(id, role, dueAt);
  sqlite
    .prepare("INSERT INTO posts (slug, title, date, author_id) VALUES (?, 't', '2026-10-01', ?)")
    .run(`p${id}`, id);
}

function userIds(): number[] {
  return sqlite.prepare('SELECT id FROM users ORDER BY id').pluck().all().map(Number);
}

beforeEach(() => {
  sqlite = createTestSqlite();
  addUser(1, 'admin', '2026-11-01T15:00:00.000Z');
  addUser(2, 'author', '2026-11-18T15:00:00.000Z'); // due
  addUser(3, 'author', '2026-11-30T15:00:00.000Z'); // not yet
  addUser(4, 'author', null); // not withdrawing
});

// docs/multi-author-requirements.md §12.8 rows 45 and 48.
describe('purgeWithdrawn (scripts/purge-withdrawn.mts)', () => {
  it('lists only authors past their deadline, and deletes nothing without --delete', () => {
    expect(purgeWithdrawn(sqlite, NOW, false)).toEqual({ due: [2], deleted: [] });
    expect(userIds()).toEqual([1, 2, 3, 4]);
  });

  it('deletes them, with their posts, under --delete', () => {
    expect(purgeWithdrawn(sqlite, NOW, true)).toEqual({ due: [2], deleted: [2] });
    expect(userIds()).toEqual([1, 3, 4]);
    expect(sqlite.prepare('SELECT count(*) FROM posts WHERE author_id = 2').pluck().get()).toBe(0);
  });

  // The cancel that lands between the list and the delete is lib/user-delete.test.ts's case.
  it('keeps someone who cancelled before the run', () => {
    sqlite.prepare('UPDATE users SET withdrawal_due_at = NULL WHERE id = 2').run();
    expect(purgeWithdrawn(sqlite, NOW, true)).toEqual({ due: [], deleted: [] });
    expect(userIds()).toEqual([1, 2, 3, 4]);
  });
});
