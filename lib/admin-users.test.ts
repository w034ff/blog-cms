import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { posts, users } from '@/lib/db/schema';
import { listAdminUsers, suspendUser, unsuspendUser } from './admin-users';

vi.mock('@/lib/db', async () => {
  const { createTestDb } = await import('@/test/db');
  return { db: createTestDb() };
});

beforeEach(() => {
  db.delete(posts).run();
  db.delete(users).run();
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
        isGoogle: false,
        postCount: 1,
        scribbleCount: 1,
      },
      {
        id: 2,
        displayName: 'Google 著者',
        role: 'author',
        suspendedAt: null,
        isGoogle: true,
        postCount: 2,
        scribbleCount: 1,
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
