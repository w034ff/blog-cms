import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { posts, users } from '@/lib/db/schema';
import { BODY_MAX_CHARS } from '@/lib/body-limit';
import { createPost } from '@/lib/posts-write';

vi.mock('@/lib/db', async () => {
  const { createTestDb } = await import('@/test/db');
  return { db: createTestDb() };
});
const currentSession = vi.hoisted(() => ({
  userId: 7,
  username: 'admin',
}));
const SESSION_USER_ID = currentSession.userId;
vi.mock('@/lib/dal', () => ({
  getOptionalSession: async () => currentSession,
  verifySession: async () => currentSession,
}));
// Outside a request there is no cache to revalidate.
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

const redirectMock = vi.fn();
vi.mock('next/navigation', () => ({
  redirect: (url: string) => redirectMock(url),
}));

import { FORBIDDEN_POST_EDIT } from '@/lib/post-access';
import * as postActions from './posts';
const { submitPostAction } = postActions;

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries({
    title: 'メモ',
    category: '',
    tags: '',
    body: '本文',
    thumbnail: '',
    ...fields,
  })) {
    data.set(name, value);
  }
  return data;
}

function row(id: number) {
  const found = db.select().from(posts).where(eq(posts.id, id)).get();
  if (!found) throw new Error(`post ${id} is gone`);
  return found;
}

function seedDraft(kind: 'post' | 'scribble'): number {
  return createPost({
    slug: `slug-${kind}`,
    title: 'メモ',
    date: '',
    category: '',
    tags: [],
    draft: true,
    body: '本文',
    thumbnail: '',
    kind,
    authorId: 1,
  }).id;
}

beforeEach(() => {
  db.delete(posts).run();
  db.delete(users).run();
  currentSession.userId = SESSION_USER_ID;
  currentSession.username = 'admin';
  redirectMock.mockClear();
  db.insert(users)
    .values({
      id: SESSION_USER_ID,
      username: 'admin',
      passwordHash: 'dummy',
      role: 'admin',
    })
    .run();
});

// docs/scribble-requirements.md §3.2: a scribble has no category to choose, so publish does not ask
// for one, and what it stores is empty whatever the form carried.
describe('submitPostAction and kinds', () => {
  it('publishes a scribble without a category, storing neither category nor thumbnail', async () => {
    const id = seedDraft('scribble');
    const state = await submitPostAction(
      {},
      form({ id: String(id), category: 'tech', thumbnail: '/uploads/a.png' }),
    );
    expect(state.saved?.published).toBe(true);
    expect(row(id)).toMatchObject({ kind: 'scribble', draft: false, category: '', thumbnail: '' });
  });

  it('still refuses a post with no category', async () => {
    const id = seedDraft('post');
    const state = await submitPostAction({}, form({ id: String(id) }));
    expect(state.missingCategory).toBe(true);
    expect(row(id).draft).toBe(true);
  });

  it('creates a scribble when publish comes before any autosave', async () => {
    const state = await submitPostAction({}, form({ kind: 'scribble' }));
    const id = state.saved?.id;
    if (id === undefined) throw new Error(`not saved: ${JSON.stringify(state)}`);
    expect(row(id)).toMatchObject({ kind: 'scribble', draft: false });
  });

  // docs/library-requirements.md §8 row 2.
  it("writes the session's account as the author when publish creates the row", async () => {
    const state = await submitPostAction({}, form({ category: 'tech' }));
    const id = state.saved?.id;
    if (id === undefined) throw new Error(`not saved: ${JSON.stringify(state)}`);
    expect(row(id)).toMatchObject({ kind: 'post', authorId: SESSION_USER_ID });
  });

  it("ignores a kind sent for an existing row, and unpublish keeps a scribble's fields empty", async () => {
    const id = seedDraft('scribble');
    await submitPostAction({}, form({ id: String(id), kind: 'post' }));
    await submitPostAction(
      {},
      form({ id: String(id), intent: 'unpublish', category: 'tech', thumbnail: '/uploads/a.png' }),
    );
    expect(row(id)).toMatchObject({ kind: 'scribble', draft: true, category: '', thumbnail: '' });
  });

  it('returns editedAt in saved on publish and unpublish', async () => {
    const id = seedDraft('post');
    const pubState = await submitPostAction({}, form({ id: String(id), category: 'tech' }));
    expect(pubState.saved?.published).toBe(true);
    expect(typeof pubState.saved?.editedAt).toBe('string');
    expect(row(id).editedAt).toBe(pubState.saved?.editedAt);

    const unpubState = await submitPostAction(
      {},
      form({ id: String(id), intent: 'unpublish', category: 'tech' }),
    );
    expect(unpubState.saved?.published).toBe(false);
    expect(typeof unpubState.saved?.editedAt).toBe('string');
    expect(row(id).editedAt).toBe(unpubState.saved?.editedAt);
  });
});

// docs/multi-author-requirements.md §7 row 2.
describe('author calling actions on another author’s post (all exports of posts.ts)', () => {
  it('refuses all exports and write paths on another author’s post, making no change to the DB', async () => {
    const OTHER_AUTHOR_ID = 99;
    const AUTHOR_USER_ID = 8;

    db.insert(users)
      .values({
        id: AUTHOR_USER_ID,
        username: 'author',
        passwordHash: 'dummy',
        role: 'author',
      })
      .run();

    currentSession.userId = AUTHOR_USER_ID;
    currentSession.username = 'author';

    // Seed both a draft and a published post belonging to another author
    const draftPostId = createPost({
      slug: 'other-draft-post',
      title: 'Original Draft Title',
      date: '',
      category: '',
      tags: [],
      draft: true,
      body: 'Original Draft Body',
      thumbnail: '',
      kind: 'post',
      authorId: OTHER_AUTHOR_ID,
    }).id;

    const publishedPostId = createPost({
      slug: 'other-published-post',
      title: 'Original Published Title',
      date: '2026-01-01T00:00:00.000Z',
      category: 'tech',
      tags: [],
      draft: false,
      body: 'Original Published Body',
      thumbnail: '',
      kind: 'post',
      authorId: OTHER_AUTHOR_ID,
    }).id;

    const entries = Object.entries(postActions).filter(([, value]) => typeof value === 'function');
    expect(entries.length).toBeGreaterThan(0);

    for (const otherPostId of [draftPostId, publishedPostId]) {
      const beforeState = row(otherPostId);

      for (const [, fn] of entries) {
        const actionFn = fn as (...args: unknown[]) => Promise<unknown>;

        if (actionFn.length === 2) {
          // submitPostAction has multiple write paths: publish/update vs unpublish
          const paths = [
            {
              desc: 'publish/update',
              formData: form({
                id: String(otherPostId),
                title: 'Hacked Title',
                category: 'tech',
                body: 'Hacked Body',
              }),
            },
            {
              desc: 'unpublish',
              formData: form({
                id: String(otherPostId),
                intent: 'unpublish',
                title: 'Hacked Title',
                category: 'tech',
                body: 'Hacked Body',
              }),
            },
          ];

          for (const path of paths) {
            redirectMock.mockClear();
            const result = await actionFn({}, path.formData);
            expect(result).toMatchObject({ error: FORBIDDEN_POST_EDIT });
            expect(row(otherPostId)).toEqual(beforeState);
          }
        } else {
          // deletePostAction
          redirectMock.mockClear();
          const formData = form({
            id: String(otherPostId),
            postId: String(otherPostId),
          });
          await actionFn(formData);
          expect(redirectMock).toHaveBeenCalledWith('/admin');
          expect(row(otherPostId)).toEqual(beforeState);
        }
      }
    }
  });
});

// docs/abuse-limits-requirements.md §8 row 11.
describe('submitPostAction and the body limit', () => {
  const tooLong = 'あ'.repeat(BODY_MAX_CHARS + 1);
  const message = `本文が長すぎます。100,000 字までにしてください（今は ${(BODY_MAX_CHARS + 1).toLocaleString('en-US')} 字）。`;

  it('refuses a publish of a body over the limit with the count, writing nothing', async () => {
    const id = seedDraft('post');
    const before = row(id);
    const state = await submitPostAction(
      {},
      form({ id: String(id), category: 'tech', body: tooLong }),
    );
    expect(state).toEqual({ error: message });
    expect(row(id)).toEqual(before);
  });

  it('refuses it when publish would create the row', async () => {
    const state = await submitPostAction({}, form({ category: 'tech', body: tooLong }));
    expect(state).toEqual({ error: message });
    expect(db.select().from(posts).all()).toEqual([]);
  });

  it('refuses it on unpublish as well, which writes the body too', async () => {
    const id = seedDraft('post');
    db.update(posts).set({ draft: false }).where(eq(posts.id, id)).run();
    const before = row(id);
    const state = await submitPostAction(
      {},
      form({ id: String(id), intent: 'unpublish', category: 'tech', body: tooLong }),
    );
    expect(state).toEqual({ error: message });
    expect(row(id)).toEqual(before);
  });

  it('publishes a body of exactly the limit', async () => {
    const id = seedDraft('post');
    const body = 'あ'.repeat(BODY_MAX_CHARS);
    const state = await submitPostAction({}, form({ id: String(id), category: 'tech', body }));
    expect(state.saved?.published).toBe(true);
    expect(row(id).body).toBe(body);
  });
});
