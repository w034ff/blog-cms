import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { bookmarks, likes, postViews, posts } from '@/lib/db/schema';
import { createPost } from '@/lib/posts-write';
import type { SessionPayload } from '@/lib/session-token';

vi.mock('@/lib/db', async () => {
  const { createTestDb } = await import('@/test/db');
  return { db: createTestDb() };
});
const session = vi.hoisted(() => {
  const holder: { current: SessionPayload | null } = { current: null };
  return holder;
});
vi.mock('@/lib/dal', () => ({ getOptionalSession: async () => session.current }));

const actions = await import('./library');
const { recordViewAction, setBookmarkAction, setLikeAction } = actions;

const ME = 1;

function seed(authorId: number, draft = false): number {
  return createPost({
    slug: `slug-${Math.random()}`,
    title: 'Title',
    date: draft ? '' : '2026-01-01T00:00:00.000Z',
    category: 'tech',
    tags: [],
    draft,
    body: 'body',
    thumbnail: '',
    kind: 'post',
    authorId,
  });
}

function written(): number {
  return [bookmarks, likes, postViews].reduce(
    (sum, table) => sum + db.select().from(table).all().length,
    0,
  );
}

beforeEach(() => {
  for (const table of [posts, bookmarks, likes, postViews]) db.delete(table).run();
  session.current = { userId: ME, username: 'admin' };
});

// docs/library-requirements.md §8 row 4: a draft, one's own post (for a like) and a missing id get
// the same answer, so the answer says nothing about which it was.
describe('refusals', () => {
  it('answers a draft, your own post and a missing id alike', async () => {
    const draft = seed(2, true);
    const own = seed(ME);
    const missing = own + 1000;
    const answers = await Promise.all([
      setBookmarkAction(draft, true),
      setBookmarkAction(missing, true),
      setLikeAction(draft, true),
      setLikeAction(own, true),
      setLikeAction(missing, true),
    ]);
    expect(new Set(answers.map((answer) => JSON.stringify(answer)))).toEqual(
      new Set([JSON.stringify({ notFound: true })]),
    );
    expect(written()).toBe(0);
  });

  it('answers arguments that are not an id and a boolean the same way', async () => {
    const id = seed(2);
    expect(await setBookmarkAction(String(id), true)).toEqual({ notFound: true });
    expect(await setLikeAction(id, 'true')).toEqual({ notFound: true });
    expect(written()).toBe(0);
  });

  // Every export, not a list written here, so an Action added later without the session check fails.
  it('writes nothing for any Action without a session', async () => {
    session.current = null;
    const id = seed(2);
    for (const action of Object.values(actions)) {
      if (typeof action === 'function') await action(id, true);
    }
    expect(written()).toBe(0);
  });
});

describe('accepted marks', () => {
  it("marks someone else's post and records the visit", async () => {
    const id = seed(2);
    expect(await setBookmarkAction(id, true)).toEqual({ on: true });
    expect(await setLikeAction(id, true)).toEqual({ on: true });
    await recordViewAction(id);
    expect(written()).toBe(3);
    expect(await setLikeAction(id, false)).toEqual({ on: false });
    expect(written()).toBe(2);
  });
});
