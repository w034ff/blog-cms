import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { HANDLE_FIXED, HANDLE_TAKEN, HANDLE_UNAVAILABLE } from '@/lib/handle-rules';
import { deleteUserAccount } from '@/lib/user-delete';
import { chooseHandle, handleOf, planHandleChange } from './handle';

vi.mock('@/lib/db', async () => {
  const { createTestDb } = await import('@/test/db');
  return { db: createTestDb() };
});

const NOW = new Date('2026-10-19T03:00:00.000Z');

function row(id: number) {
  return db
    .select({ handle: users.handle, chosenAt: users.handleChosenAt })
    .from(users)
    .where(eq(users.id, id))
    .get();
}

beforeEach(() => {
  db.delete(users).run();
  db.insert(users)
    .values([
      { id: 1, role: 'admin', username: 'admin', handle: 'user1' },
      { id: 2, role: 'author', handle: 'user2' },
      { id: 3, role: 'author', handle: 'hanako', handleChosenAt: '2026-10-18T00:00:00.000Z' },
    ])
    .run();
});

describe('handleOf (docs/multi-author-requirements.md §13.2)', () => {
  it('reads a row without an ID as its automatic one', () => {
    expect(handleOf({ id: 9, handle: null })).toBe('user9');
    expect(handleOf({ id: 9, handle: 'kenta' })).toBe('kenta');
  });
});

// §13.6 rows 50, 51 and 55.
describe('choosing an ID', () => {
  it('treats the current ID, however typed, as no change', () => {
    expect(planHandleChange(2, '@USER2')).toEqual({ kind: 'unchanged' });
    expect(planHandleChange(3, 'Hanako')).toEqual({ kind: 'unchanged' });
  });

  it("refuses another account's current ID and the automatic shape", () => {
    expect(planHandleChange(2, 'hanako')).toEqual({ kind: 'error', error: HANDLE_TAKEN });
    expect(planHandleChange(2, 'user3')).toEqual({ kind: 'error', error: HANDLE_UNAVAILABLE });
  });

  it('lets an account change its automatic ID once, then fixes it', () => {
    expect(chooseHandle(2, '＠Yamada_Taro', NOW)).toEqual({ ok: true });
    expect(row(2)).toEqual({ handle: 'yamada_taro', chosenAt: NOW.toISOString() });

    expect(chooseHandle(2, 'someone_else', NOW)).toEqual({ ok: false, error: HANDLE_FIXED });
    expect(row(2)).toEqual({ handle: 'yamada_taro', chosenAt: NOW.toISOString() });
  });

  it('holds the admin to the same rule', () => {
    expect(chooseHandle(1, 'kanri', NOW)).toEqual({ ok: true });
    expect(chooseHandle(1, 'kanri2', NOW)).toEqual({ ok: false, error: HANDLE_FIXED });
  });

  it('frees the ID of a deleted account', () => {
    db.update(users).set({ suspendedAt: NOW.toISOString() }).where(eq(users.id, 3)).run();
    expect(deleteUserAccount(db.$client, 3, { kind: 'suspended' })).toBe(true);
    expect(chooseHandle(2, 'hanako', NOW)).toEqual({ ok: true });
  });
});
