import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import type { SessionPayload } from '@/lib/session-token';

vi.mock('@/lib/db', async () => {
  const { createTestDb } = await import('@/test/db');
  return { db: createTestDb() };
});

const rawSession = vi.hoisted(() => ({ current: null as SessionPayload | null }));
vi.mock('@/lib/session', () => ({
  getSession: async () => rawSession.current,
}));

const redirectMock = vi.fn();
vi.mock('next/navigation', () => ({
  redirect: (url: string) => redirectMock(url),
  notFound: vi.fn(),
}));

const { getOptionalSession, getWithdrawingSession, verifySession } = await import('./dal');

beforeEach(() => {
  db.delete(users).run();
  rawSession.current = null;
  redirectMock.mockClear();
});

function seedUser(id: number, username: string, suspendedAt: string | null = null): void {
  db.insert(users)
    .values({
      id,
      username,
      passwordHash: 'dummy',
      role: 'author',
      suspendedAt,
    })
    .run();
}

// docs/multi-author-requirements.md §7 row 8.
describe('session verification and suspension (lib/dal)', () => {
  it('returns the session for an active user', async () => {
    seedUser(1, 'active', null);
    rawSession.current = { userId: 1 };

    const optional = await getOptionalSession();
    expect(optional).toEqual({ userId: 1, displayName: '', username: 'active' });

    const verified = await verifySession();
    expect(verified).toEqual({ userId: 1, displayName: '', username: 'active' });
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it('treats a suspended user as having no session', async () => {
    seedUser(2, 'suspended', '2026-10-17T12:00:00.000Z');
    rawSession.current = { userId: 2 };

    const optional = await getOptionalSession();
    expect(optional).toBeNull();

    await verifySession();
    expect(redirectMock).toHaveBeenCalledWith('/login');
  });

  it('treats a session for a missing user row as having no session', async () => {
    rawSession.current = { userId: 999 };

    const optional = await getOptionalSession();
    expect(optional).toBeNull();

    await verifySession();
    expect(redirectMock).toHaveBeenCalledWith('/login');
  });

  it('treats an absent session as having no session', async () => {
    rawSession.current = null;

    const optional = await getOptionalSession();
    expect(optional).toBeNull();

    await verifySession();
    expect(redirectMock).toHaveBeenCalledWith('/login');
  });
});

// docs/multi-author-requirements.md §12.8 row 44.
describe('withdrawing authors (lib/dal)', () => {
  const DUE = '2026-11-18T15:00:00.000Z';

  it('has no session but the withdrawing one, and is sent to the withdrawal page, not /login', async () => {
    db.insert(users).values({ id: 3, role: 'author', withdrawalDueAt: DUE }).run();
    rawSession.current = { userId: 3 };

    expect(await getOptionalSession()).toBeNull();
    expect(await getWithdrawingSession()).toEqual({ userId: 3, withdrawalDueAt: DUE });
    await verifySession();
    expect(redirectMock.mock.calls).toEqual([['/withdrawal']]);
  });

  it('treats a suspended withdrawing author as suspended', async () => {
    db.insert(users)
      .values({ id: 4, role: 'author', withdrawalDueAt: DUE, suspendedAt: '2026-10-20T00:00:00Z' })
      .run();
    rawSession.current = { userId: 4 };

    expect(await getWithdrawingSession()).toBeNull();
    await verifySession();
    expect(redirectMock.mock.calls).toEqual([['/login']]);
  });

  it('gives an active author no withdrawing session', async () => {
    seedUser(5, 'active');
    rawSession.current = { userId: 5 };
    expect(await getWithdrawingSession()).toBeNull();
  });
});
