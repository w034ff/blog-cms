import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { postRevisions, posts, users } from '@/lib/db/schema';
import type { DraftContent } from '@/lib/types';
import * as revisionActions from './revisions';

vi.mock('@/lib/db', async () => {
  const { createTestDb } = await import('@/test/db');
  return { db: createTestDb() };
});

const currentSession = vi.hoisted(() => ({
  userId: 8,
  username: 'author',
}));
vi.mock('@/lib/dal', () => ({
  getOptionalSession: async () => currentSession,
  verifySession: async () => currentSession,
}));

const redirectMock = vi.fn();
vi.mock('next/navigation', () => ({
  redirect: (url: string) => redirectMock(url),
}));

beforeEach(() => {
  db.delete(posts).run();
  db.delete(users).run();
  db.delete(postRevisions).run();
  redirectMock.mockClear();
  currentSession.userId = 8;
  currentSession.username = 'author';

  db.insert(users)
    .values([
      { id: 1, username: 'admin', passwordHash: 'dummy', role: 'admin' },
      { id: 8, username: 'author', passwordHash: 'dummy', role: 'author' },
      { id: 99, username: 'other', passwordHash: 'dummy', role: 'author' },
    ])
    .run();
});

function seedPost(authorId: number | null): number {
  return db
    .insert(posts)
    .values({
      slug: `slug-${Math.random()}`,
      title: 'Original Title',
      date: '2026-01-01',
      category: 'tech',
      tags: [],
      draft: false,
      body: 'Original Body',
      thumbnail: '',
      kind: 'post',
      authorId,
    })
    .returning({ id: posts.id })
    .get().id;
}

function seedRevision(postId: number, content: DraftContent): number {
  return db
    .insert(postRevisions)
    .values({
      postId,
      createdAt: Date.now(),
      reason: 'publish',
      content,
    })
    .returning({ id: postRevisions.id })
    .get().id;
}

// docs/multi-author-requirements.md §7 row 2.
describe('author calling actions on another author’s post (all exports of revisions.ts)', () => {
  it('refuses all exports and makes no change to the DB', async () => {
    const otherPostId = seedPost(99);
    const revId = seedRevision(otherPostId, {
      title: 'Past Title',
      category: 'tech',
      tags: [],
      body: 'Past Body',
      thumbnail: '',
    });

    const beforePost = db.select().from(posts).where(eq(posts.id, otherPostId)).get();
    const beforeRevs = db
      .select()
      .from(postRevisions)
      .where(eq(postRevisions.postId, otherPostId))
      .all();

    const formData = new FormData();
    formData.set('postId', String(otherPostId));
    formData.set('revision', String(revId));

    const entries = Object.entries(revisionActions).filter(
      ([, value]) => typeof value === 'function',
    );
    expect(entries.length).toBeGreaterThan(0);

    for (const [, fn] of entries) {
      redirectMock.mockClear();
      const actionFn = fn as (...args: unknown[]) => Promise<unknown>;
      await actionFn(formData);

      expect(redirectMock).toHaveBeenCalledWith(`/admin/posts/${otherPostId}/revisions`);
      expect(db.select().from(posts).where(eq(posts.id, otherPostId)).get()).toEqual(beforePost);
      expect(
        db.select().from(postRevisions).where(eq(postRevisions.postId, otherPostId)).all(),
      ).toEqual(beforeRevs);
    }
  });

  it('allows owner to restore revision', async () => {
    const ownPostId = seedPost(8);
    const revId = seedRevision(ownPostId, {
      title: 'Restored Title',
      category: 'tech',
      tags: [],
      body: 'Restored Body',
      thumbnail: '',
    });

    const formData = new FormData();
    formData.set('postId', String(ownPostId));
    formData.set('revision', String(revId));

    await revisionActions.restoreRevisionAction(formData);

    expect(redirectMock).toHaveBeenCalledWith(`/admin/posts/${ownPostId}/edit`);
    const afterPost = db.select().from(posts).where(eq(posts.id, ownPostId)).get();
    expect(afterPost?.draftContent?.title).toBe('Restored Title');
  });
});
