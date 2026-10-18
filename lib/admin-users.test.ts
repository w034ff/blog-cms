import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { authorAllowlist, displayNameHistory, posts, users } from '@/lib/db/schema';
import { addInvite } from '@/lib/author-access';
import { hashEmail } from '@/lib/email-hash';
import {
  DETAIL_POSTS_SHOWN,
  getUserDetail,
  listAdminUsers,
  lookupByEmail,
  suspendUser,
  unsuspendUser,
} from './admin-users';

vi.mock('@/lib/db', async () => {
  const { createTestDb } = await import('@/test/db');
  return { db: createTestDb() };
});

beforeEach(() => {
  for (const table of [posts, users, authorAllowlist, displayNameHistory]) db.delete(table).run();
});

describe('admin users (docs/multi-author-requirements.md §5, §9.5)', () => {
  it('lists users ordered by id with login methods and post/scribble counts', () => {
    // Admin user (password login)
    db.insert(users)
      .values({
        id: 1,
        username: 'admin',
        passwordHash: 'hash',
        role: 'admin',
        displayName: '管理者',
      })
      .run();

    // Author (Google login)
    db.insert(users)
      .values({
        id: 2,
        role: 'author',
        displayName: 'Google 著者',
        googleSub: 'google-sub-123',
      })
      .run();

    // Posts for admin: 1 published article, 1 draft scribble
    db.insert(posts)
      .values({
        slug: 'admin-post-1',
        title: 'Admin Post',
        date: '2026-10-18',
        kind: 'post',
        draft: false,
        authorId: 1,
      })
      .run();
    db.insert(posts)
      .values({
        slug: 'admin-scribble-1',
        title: 'Admin Scribble',
        date: '2026-10-18',
        kind: 'scribble',
        draft: true,
        authorId: 1,
      })
      .run();

    // Posts for author: 2 articles (1 draft, 1 published), 1 scribble
    db.insert(posts)
      .values({
        slug: 'author-post-1',
        title: 'Author Post 1',
        date: '2026-10-18',
        kind: 'post',
        draft: false,
        authorId: 2,
      })
      .run();
    db.insert(posts)
      .values({
        slug: 'author-post-2',
        title: 'Author Post 2',
        date: '2026-10-18',
        kind: 'post',
        draft: true,
        authorId: 2,
      })
      .run();
    db.insert(posts)
      .values({
        slug: 'author-scribble-1',
        title: 'Author Scribble',
        date: '2026-10-18',
        kind: 'scribble',
        draft: false,
        authorId: 2,
      })
      .run();

    const list = listAdminUsers();
    expect(list).toEqual([
      {
        id: 1,
        displayName: '管理者',
        role: 'admin',
        suspendedAt: null,
        withdrawalDueAt: null,
        handle: 'user1',
        isGoogle: false,
        postCount: 1,
        scribbleCount: 1,
        joinedVia: null,
        previousNames: [],
        historyCount: 0,
      },
      {
        id: 2,
        displayName: 'Google 著者',
        role: 'author',
        suspendedAt: null,
        withdrawalDueAt: null,
        handle: 'user2',
        isGoogle: true,
        postCount: 2,
        scribbleCount: 1,
        joinedVia: null,
        previousNames: [],
        historyCount: 0,
      },
    ]);
  });

  it('suspends an author account but refuses to suspend an admin', () => {
    db.insert(users)
      .values({
        id: 1,
        username: 'admin',
        role: 'admin',
      })
      .run();

    db.insert(users)
      .values({
        id: 2,
        username: 'author',
        role: 'author',
      })
      .run();

    // Suspending admin must fail and make no change
    const adminSuspendResult = suspendUser(1, new Date('2026-10-18T12:00:00Z'));
    expect(adminSuspendResult).toBe(false);
    const adminRow = db.select().from(users).where(eq(users.id, 1)).get();
    expect(adminRow?.suspendedAt).toBeNull();

    // Suspending author succeeds
    const authorSuspendResult = suspendUser(2, new Date('2026-10-18T12:00:00Z'));
    expect(authorSuspendResult).toBe(true);
    const authorRow = db.select().from(users).where(eq(users.id, 2)).get();
    expect(authorRow?.suspendedAt).toBe('2026-10-18T12:00:00.000Z');

    // Unsuspending author restores to null
    expect(unsuspendUser(2)).toBe(true);
    const authorUnsuspended = db.select().from(users).where(eq(users.id, 2)).get();
    expect(authorUnsuspended?.suspendedAt).toBeNull();
  });
});

function addHistory(userId: number, names: string[]): void {
  names.forEach((displayName, i) => {
    db.insert(displayNameHistory)
      .values({
        userId,
        displayName,
        kind: i === 0 ? 'initial' : 'change',
        changedAt: new Date(Date.UTC(2026, 9, 10 + i)).toISOString(),
      })
      .run();
  });
}

describe('telling authors apart (docs/multi-author-requirements.md §10)', () => {
  it('finds accounts by keyed hash and invites by address, ignoring case and space (criterion 27)', () => {
    db.insert(users)
      .values({
        id: 2,
        role: 'author',
        googleSub: 's2',
        emailHash: hashEmail('hanako@example.com'),
      })
      .run();
    db.insert(users)
      .values({
        id: 3,
        role: 'author',
        googleSub: 's3',
        emailHash: hashEmail('hanako@example.com'),
      })
      .run();
    db.insert(users)
      .values({ id: 4, role: 'author', googleSub: 's4', emailHash: hashEmail('other@example.com') })
      .run();
    addInvite('mio@example.com');

    expect(lookupByEmail('  HANAKO@example.com ')).toEqual({ userIds: [2, 3], inviteEmails: [] });
    expect(lookupByEmail('Mio@Example.com')).toEqual({
      userIds: [],
      inviteEmails: ['mio@example.com'],
    });
    expect(lookupByEmail('nobody@example.com')).toEqual({ userIds: [], inviteEmails: [] });
    expect(lookupByEmail('   ')).toEqual({ userIds: [], inviteEmails: [] });
  });

  it('lists up to three earlier names, newest first, and the full count', () => {
    db.insert(users)
      .values({ id: 2, role: 'author', googleSub: 's2', displayName: 'E', joinedVia: 'invite' })
      .run();
    db.insert(users)
      .values({ id: 3, role: 'author', googleSub: 's3', displayName: 'Only', joinedVia: 'open' })
      .run();
    addHistory(2, ['A', 'B', 'C', 'D', 'E']);
    addHistory(3, ['Only']);

    const [two, three] = listAdminUsers();
    expect(two).toMatchObject({
      joinedVia: 'invite',
      previousNames: ['D', 'C', 'B'],
      historyCount: 5,
    });
    expect(three).toMatchObject({ joinedVia: 'open', previousNames: [], historyCount: 1 });
  });

  it('gives the detail page every name and the newest rows of each kind', () => {
    db.insert(users)
      .values({
        id: 2,
        role: 'author',
        googleSub: 's2',
        displayName: 'C',
        joinedVia: 'invite',
        createdAt: '2026-10-15T00:00:00.000Z',
      })
      .run();
    addHistory(2, ['A', 'B', 'C']);
    for (let i = 0; i < DETAIL_POSTS_SHOWN + 2; i++) {
      db.insert(posts)
        .values({
          title: `Scribble ${i}`,
          date: '',
          kind: 'scribble',
          authorId: 2,
          draft: i === DETAIL_POSTS_SHOWN + 1,
          createdAt: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString(),
        })
        .run();
    }

    const detail = getUserDetail(2);
    expect(detail?.history.map((h) => h.displayName)).toEqual(['C', 'B', 'A']);
    expect(detail?.posts.post).toEqual({ total: 0, rows: [] });
    expect(detail?.posts.scribble.total).toBe(DETAIL_POSTS_SHOWN + 2);
    expect(detail?.posts.scribble.rows).toHaveLength(DETAIL_POSTS_SHOWN);
    expect(detail?.posts.scribble.rows[0]).toMatchObject({
      title: `Scribble ${DETAIL_POSTS_SHOWN + 1}`,
      draft: true,
    });
    expect(detail).toMatchObject({
      joinedVia: 'invite',
      createdAt: '2026-10-15T00:00:00.000Z',
      isGoogle: true,
    });
    expect(getUserDetail(999)).toBeNull();
  });
});
