import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { posts, users } from '@/lib/db/schema';
import type { SessionPayload } from '@/lib/session-token';
import { canCurrentUserEdit, canEditPost } from './post-access';

vi.mock('@/lib/db', async () => {
  const { createTestDb } = await import('@/test/db');
  return { db: createTestDb() };
});

const currentSession = vi.hoisted(() => ({ value: null as SessionPayload | null }));
vi.mock('@/lib/dal', () => ({
  getOptionalSession: async () => currentSession.value,
}));

beforeEach(() => {
  db.delete(posts).run();
  db.delete(users).run();
  currentSession.value = null;
});

// docs/multi-author-requirements.md §7 row 1.
describe('canEditPost (pure predicate)', () => {
  it('allows an admin to edit any post, including another author’s or one with no author', () => {
    const admin = { id: 1, role: 'admin' as const };
    expect(canEditPost(admin, 1)).toBe(true);
    expect(canEditPost(admin, 2)).toBe(true);
    expect(canEditPost(admin, null)).toBe(true);
  });

  it('allows an author to edit only their own post', () => {
    const author = { id: 2, role: 'author' as const };
    expect(canEditPost(author, 2)).toBe(true);
    expect(canEditPost(author, 1)).toBe(false);
    expect(canEditPost(author, 3)).toBe(false);
  });

  it('forbids an author from editing a post with no author', () => {
    const author = { id: 2, role: 'author' as const };
    expect(canEditPost(author, null)).toBe(false);
  });
});

describe('canCurrentUserEdit (server helper)', () => {
  function seedUser(id: number, username: string, role: 'admin' | 'author'): void {
    db.insert(users)
      .values({
        id,
        username,
        passwordHash: 'dummy',
        role,
      })
      .run();
  }

  function seedPost(authorId: number | null): number {
    return db
      .insert(posts)
      .values({
        slug: `slug-${Math.random()}`,
        title: 'Title',
        date: '',
        category: 'tech',
        tags: [],
        draft: true,
        body: 'Body',
        thumbnail: '',
        kind: 'post',
        authorId,
      })
      .returning({ id: posts.id })
      .get().id;
  }

  it('returns false when there is no signed-in session', async () => {
    const postId = seedPost(1);
    expect(await canCurrentUserEdit(postId)).toBe(false);
  });

  it('allows admin to edit another author’s post or an authorless post', async () => {
    seedUser(1, 'admin', 'admin');
    currentSession.value = { userId: 1, username: 'admin' };

    const otherPost = seedPost(2);
    const orphanPost = seedPost(null);

    expect(await canCurrentUserEdit(otherPost)).toBe(true);
    expect(await canCurrentUserEdit(orphanPost)).toBe(true);
  });

  it('allows author to edit their own post and refuses another’s or an authorless post', async () => {
    seedUser(2, 'author', 'author');
    currentSession.value = { userId: 2, username: 'author' };

    const ownPost = seedPost(2);
    const otherPost = seedPost(1);
    const orphanPost = seedPost(null);

    expect(await canCurrentUserEdit(ownPost)).toBe(true);
    expect(await canCurrentUserEdit(otherPost)).toBe(false);
    expect(await canCurrentUserEdit(orphanPost)).toBe(false);
  });

  it('returns false for a non-existent post id', async () => {
    seedUser(1, 'admin', 'admin');
    currentSession.value = { userId: 1, username: 'admin' };

    expect(await canCurrentUserEdit(99999)).toBe(false);
  });
});
