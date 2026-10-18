import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';

vi.mock('@/lib/db', async () => {
  const { createTestDb } = await import('@/test/db');
  return { db: createTestDb() };
});

const session = vi.hoisted(() => ({
  active: null as { userId: number } | null,
  withdrawing: null as { userId: number; withdrawalDueAt: string } | null,
}));
vi.mock('@/lib/dal', () => ({
  WITHDRAWAL_PATH: '/withdrawal',
  getOptionalSession: async () => session.active,
  getWithdrawingSession: async () => session.withdrawing,
}));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
// Like Next's, so code after a redirect does not run.
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));

const { cancelWithdrawalAction, withdrawAction } = await import('./withdrawal');

const PAST_DUE = '2026-01-01T15:00:00.000Z';

function dueAt(id: number): string | null | undefined {
  return db.select({ due: users.withdrawalDueAt }).from(users).where(eq(users.id, id)).get()?.due;
}

beforeEach(() => {
  db.delete(users).run();
  db.insert(users)
    .values([
      { id: 1, role: 'admin', username: 'admin' },
      { id: 2, role: 'author' },
    ])
    .run();
  session.active = null;
  session.withdrawing = null;
});

describe('withdrawAction (docs/multi-author-requirements.md §12.5)', () => {
  // §12.8 row 43.
  it("sets an author's deadline and sends them to the withdrawal page", async () => {
    session.active = { userId: 2 };
    await expect(withdrawAction()).rejects.toThrow('redirect:/withdrawal');
    const due = dueAt(2);
    expect(due).toMatch(/T15:00:00\.000Z$/); // midnight JST
  });

  // §12.8 row 46.
  it('refuses an admin and changes nothing', async () => {
    session.active = { userId: 1 };
    expect(await withdrawAction()).toEqual({ error: '管理者は退会できません。' });
    expect(dueAt(1)).toBeNull();
  });

  it('refuses without a session', async () => {
    expect(await withdrawAction()).toEqual({ error: 'ログインしていません。' });
    expect(dueAt(2)).toBeNull();
  });
});

describe('cancelWithdrawalAction (docs/multi-author-requirements.md §12.5)', () => {
  // §12.8 row 47.
  it('cancels while the row exists, past the deadline included', async () => {
    db.update(users).set({ withdrawalDueAt: PAST_DUE }).where(eq(users.id, 2)).run();
    session.withdrawing = { userId: 2, withdrawalDueAt: PAST_DUE };
    await expect(cancelWithdrawalAction()).rejects.toThrow('redirect:/admin');
    expect(dueAt(2)).toBeNull();
  });

  it('does nothing for someone who is not withdrawing', async () => {
    db.update(users).set({ withdrawalDueAt: PAST_DUE }).where(eq(users.id, 2)).run();
    session.active = { userId: 1 };
    await expect(cancelWithdrawalAction()).rejects.toThrow('redirect:/login');
    expect(dueAt(2)).toBe(PAST_DUE);
  });
});
