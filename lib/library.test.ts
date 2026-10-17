import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { bookmarks, likes, postViews, posts, users } from '@/lib/db/schema';
import { deletePost } from '@/lib/posts-write';
import type { PostKind } from '@/lib/content';
import {
  RECENT_VIEWS_LIMIT,
  likeCounts,
  listLibrary,
  markState,
  recordView,
  setBookmark,
  setLike,
} from '@/lib/library';

vi.mock('@/lib/db', async () => {
  const { createTestDb } = await import('@/test/db');
  return { db: createTestDb() };
});

const ME = 1;
const OTHER = 2;

let clock = 1_000;

beforeEach(() => {
  for (const table of [posts, bookmarks, likes, postViews, users]) db.delete(table).run();
  // Each write gets its own millisecond, so "newest first" has an answer.
  vi.spyOn(Date, 'now').mockImplementation(() => (clock += 1));
});

afterEach(() => {
  vi.restoreAllMocks();
});

function seed({
  authorId = OTHER,
  draft = false,
  kind = 'post',
  title = 'Title',
}: { authorId?: number | null; draft?: boolean; kind?: PostKind; title?: string } = {}): number {
  return db
    .insert(posts)
    .values({
      slug: `slug-${Math.random()}`,
      title,
      date: draft ? '' : '2026-01-01T00:00:00.000Z',
      category: kind === 'post' ? 'tech' : '',
      tags: [],
      draft,
      body: 'body',
      thumbnail: '',
      kind,
      authorId,
    })
    .returning({ id: posts.id })
    .get().id;
}

function titles(tab: Parameters<typeof listLibrary>[1], userId = ME): string[] {
  return listLibrary(userId, tab).map((entry) => entry.title);
}

// docs/library-requirements.md §8 row 3.
describe('what a mark is refused on', () => {
  it('refuses a like on your own post and writes nothing', () => {
    const own = seed({ authorId: ME });
    expect(setLike(ME, own, true)).toBe(false);
    expect(db.select().from(likes).all()).toEqual([]);
  });

  it('accepts a bookmark on your own post', () => {
    const own = seed({ authorId: ME });
    expect(setBookmark(ME, own, true)).toBe(true);
    expect(markState(ME, own)).toEqual({ bookmarked: true, liked: false, canLike: false });
  });

  it('refuses a bookmark and a like on a draft, as on an id that does not exist', () => {
    const draft = seed({ draft: true });
    const missing = draft + 1000;
    expect([setBookmark(ME, draft, true), setLike(ME, draft, true)]).toEqual([false, false]);
    expect([setBookmark(ME, missing, true), setLike(ME, missing, true)]).toEqual([false, false]);
    expect(db.select().from(bookmarks).all()).toEqual([]);
    expect(db.select().from(likes).all()).toEqual([]);
  });

  it('treats a post with no author as nobody’s own', () => {
    const id = seed();
    db.update(posts).set({ authorId: null }).where(eq(posts.id, id)).run();
    expect(setLike(ME, id, true)).toBe(true);
  });

  it('marks once however often it is set, and unmarks', () => {
    const id = seed();
    setLike(ME, id, true);
    setLike(ME, id, true);
    expect(likeCounts().get(id)).toBe(1);
    setLike(ME, id, false);
    expect(likeCounts().has(id)).toBe(false);
  });
});

describe('markState', () => {
  it("shows someone else's post as likeable, with the account's own marks", () => {
    const id = seed();
    setLike(ME, id, true);
    expect(markState(ME, id)).toEqual({ bookmarked: false, liked: true, canLike: true });
    expect(markState(OTHER + 1, id)).toEqual({ bookmarked: false, liked: false, canLike: true });
  });

  it('has nothing for a draft or a missing id', () => {
    const draft = seed({ draft: true });
    expect([markState(ME, draft), markState(ME, draft + 1000)]).toEqual([null, null]);
  });
});

// §8 row 5.
describe('which visits are kept', () => {
  it("keeps a visit to someone else's published post, and not to your own or a draft", () => {
    const theirs = seed({ title: 'theirs' });
    recordView(ME, seed({ authorId: ME, title: 'own' }));
    recordView(ME, seed({ draft: true, title: 'draft' }));
    recordView(ME, theirs);
    expect(
      db
        .select()
        .from(postViews)
        .all()
        .map((row) => row.postId),
    ).toEqual([theirs]);
  });
});

// §8 row 6.
describe('the length of 閲覧履歴', () => {
  it('keeps one row per post, moved to the top on a second visit', () => {
    const first = seed({ title: 'first' });
    const second = seed({ title: 'second' });
    recordView(ME, first);
    recordView(ME, second);
    recordView(ME, first);
    expect(titles('history')).toEqual(['first', 'second']);
  });

  it(`keeps the newest ${RECENT_VIEWS_LIMIT} per account, and leaves other accounts alone`, () => {
    const ids = Array.from({ length: RECENT_VIEWS_LIMIT + 2 }, (_, index) =>
      seed({ title: `p${index}` }),
    );
    recordView(OTHER + 1, ids[0]);
    for (const id of ids) recordView(ME, id);
    const kept = listLibrary(ME, 'history').map((entry) => entry.postId);
    expect(kept).toHaveLength(RECENT_VIEWS_LIMIT);
    expect(kept).not.toContain(ids[0]);
    expect(kept).not.toContain(ids[1]);
    expect(kept[0]).toBe(ids.at(-1));
    expect(listLibrary(OTHER + 1, 'history')).toHaveLength(1);
  });
});

// §8 row 7.
describe('deleting a post', () => {
  it('removes its bookmarks, likes and views and leaves other posts’ rows', () => {
    const gone = seed();
    const kept = seed();
    for (const id of [gone, kept]) {
      setBookmark(ME, id, true);
      setLike(ME, id, true);
      recordView(ME, id);
    }
    deletePost(gone);
    for (const table of [bookmarks, likes, postViews]) {
      expect(
        db
          .select()
          .from(table)
          .all()
          .map((row) => row.postId),
      ).toEqual([kept]);
    }
  });
});

// §8 row 9.
describe('listLibrary', () => {
  it('lists newest mark first, scribbles alongside posts, for that account only', () => {
    const post = seed({ title: 'post' });
    const scribble = seed({ title: 'scribble', kind: 'scribble' });
    setBookmark(ME, post, true);
    setBookmark(ME, scribble, true);
    setBookmark(OTHER, post, true);
    expect(listLibrary(ME, 'bookmarks').map(({ title, kind }) => [title, kind])).toEqual([
      ['scribble', 'scribble'],
      ['post', 'post'],
    ]);
  });

  it('hides a post that went back to a draft, and shows it again once republished', () => {
    const id = seed({ title: 'back' });
    setLike(ME, id, true);
    db.update(posts).set({ draft: true }).where(eq(posts.id, id)).run();
    expect(titles('likes')).toEqual([]);
    db.update(posts).set({ draft: false }).where(eq(posts.id, id)).run();
    expect(titles('likes')).toEqual(['back']);
  });

  // docs/multi-author-requirements.md §7 row 9.
  it('excludes posts by suspended authors from library lists, keeping marks, and restores them when unsuspended', () => {
    db.insert(users)
      .values([
        { id: ME, username: 'me', passwordHash: 'dummy', role: 'author' },
        { id: 2, username: 'active-writer', passwordHash: 'dummy', role: 'author' },
        {
          id: 3,
          username: 'suspended-writer',
          passwordHash: 'dummy',
          role: 'author',
          suspendedAt: '2026-10-17T12:00:00.000Z',
        },
      ])
      .run();

    const activePost = seed({ title: 'active', authorId: 2 });
    const suspendedPost = seed({ title: 'suspended', authorId: 3 });
    const orphanPost = seed({ title: 'orphan', authorId: null });

    setBookmark(ME, activePost, true);
    setBookmark(ME, suspendedPost, true);
    setBookmark(ME, orphanPost, true);

    expect(titles('bookmarks')).toEqual(['orphan', 'active']);

    // Marks are kept in the database table
    const allBookmarkPostIds = db
      .select({ postId: bookmarks.postId })
      .from(bookmarks)
      .where(eq(bookmarks.userId, ME))
      .all()
      .map((b) => b.postId);
    expect(allBookmarkPostIds).toContain(suspendedPost);

    // Un-suspend author 3
    db.update(users).set({ suspendedAt: null }).where(eq(users.id, 3)).run();
    expect(titles('bookmarks')).toEqual(['orphan', 'suspended', 'active']);
  });
});
