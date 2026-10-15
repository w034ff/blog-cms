import 'server-only';
import { and, count, desc, eq, notInArray } from 'drizzle-orm';
import type { PostKind } from '@/lib/content';
import { db } from '@/lib/db';
import { bookmarks, likes, postViews, posts } from '@/lib/db/schema';

// How many posts an account's 最近見た keeps (docs/library-requirements.md §3.3).
export const RECENT_VIEWS_LIMIT = 100;

export type LibraryTab = 'bookmarks' | 'likes' | 'history';

// One row of a library tab: what the row links to and when the account marked or last read it.
export type LibraryEntry = {
  postId: number;
  slug: string | null;
  title: string;
  kind: PostKind;
  // The post's public date, as `posts.date` holds it.
  date: string;
  // Epoch milliseconds.
  at: number;
};

// Who wrote a post an account may mark or record: null for a post that is not published, which
// every caller answers as it answers an id that does not exist (§4), so ids cannot be probed for
// drafts. `authorId` is null for a row with no author, which is nobody's own.
function publishedAuthor(postId: number): { authorId: number | null } | null {
  const row = db
    .select({ draft: posts.draft, authorId: posts.authorId })
    .from(posts)
    .where(eq(posts.id, postId))
    .get();
  if (!row || row.draft) return null;
  return { authorId: row.authorId };
}

// Marks or unmarks a bookmark. False when the post is not published: nothing is written.
export function setBookmark(userId: number, postId: number, on: boolean): boolean {
  if (!publishedAuthor(postId)) return false;
  if (on) {
    db.insert(bookmarks)
      .values({ userId, postId, createdAt: Date.now() })
      .onConflictDoNothing()
      .run();
  } else {
    db.delete(bookmarks)
      .where(and(eq(bookmarks.userId, userId), eq(bookmarks.postId, postId)))
      .run();
  }
  return true;
}

// Marks or unmarks a like. False when the post is not published or is the account's own: a like is
// what reaches another writer (§2), so one's own would only inflate the count.
export function setLike(userId: number, postId: number, on: boolean): boolean {
  const post = publishedAuthor(postId);
  if (!post || post.authorId === userId) return false;
  if (on) {
    db.insert(likes).values({ userId, postId, createdAt: Date.now() }).onConflictDoNothing().run();
  } else {
    db.delete(likes)
      .where(and(eq(likes.userId, userId), eq(likes.postId, postId)))
      .run();
  }
  return true;
}

// Keeps a visit to someone else's published post, then drops the account's views past
// RECENT_VIEWS_LIMIT. Anything else is ignored without a word: the page sends this on its own, and
// there is nobody to tell.
export function recordView(userId: number, postId: number): void {
  const post = publishedAuthor(postId);
  if (!post || post.authorId === userId) return;
  db.transaction((tx) => {
    const viewedAt = Date.now();
    tx.insert(postViews)
      .values({ userId, postId, viewedAt })
      .onConflictDoUpdate({ target: [postViews.userId, postViews.postId], set: { viewedAt } })
      .run();
    const kept = tx
      .select({ postId: postViews.postId })
      .from(postViews)
      .where(eq(postViews.userId, userId))
      .orderBy(desc(postViews.viewedAt), desc(postViews.postId))
      .limit(RECENT_VIEWS_LIMIT);
    tx.delete(postViews)
      .where(and(eq(postViews.userId, userId), notInArray(postViews.postId, kept)))
      .run();
  });
}

// The posts on one of an account's tabs, newest mark first. Only published posts: a row whose post
// went back to a draft stays in its table and returns if the post is published again (§6.2).
export function listLibrary(userId: number, tab: LibraryTab): LibraryEntry[] {
  const table = tab === 'bookmarks' ? bookmarks : tab === 'likes' ? likes : postViews;
  const at = 'createdAt' in table ? table.createdAt : table.viewedAt;
  return db
    .select({
      postId: posts.id,
      slug: posts.slug,
      title: posts.title,
      kind: posts.kind,
      date: posts.date,
      at,
    })
    .from(table)
    .innerJoin(posts, eq(posts.id, table.postId))
    .where(and(eq(table.userId, userId), eq(posts.draft, false)))
    .orderBy(desc(at), desc(posts.id))
    .all();
}

// Whether the account has bookmarked and liked a post, for the buttons on its page.
export function marksOn(userId: number, postId: number): { bookmarked: boolean; liked: boolean } {
  const bookmarked = db
    .select({ postId: bookmarks.postId })
    .from(bookmarks)
    .where(and(eq(bookmarks.userId, userId), eq(bookmarks.postId, postId)))
    .get();
  const liked = db
    .select({ postId: likes.postId })
    .from(likes)
    .where(and(eq(likes.userId, userId), eq(likes.postId, postId)))
    .get();
  return { bookmarked: bookmarked !== undefined, liked: liked !== undefined };
}

// Likes per post, for the admin lists (§6.3). A post with none is absent.
export function likeCounts(): Map<number, number> {
  const rows = db
    .select({ postId: likes.postId, likes: count() })
    .from(likes)
    .groupBy(likes.postId)
    .all();
  return new Map(rows.map((row) => [row.postId, row.likes]));
}

// A post's rows in every library table. Called inside `deletePost`'s transaction (§3.2).
export function deleteLibraryRowsOf(postId: number): void {
  db.delete(bookmarks).where(eq(bookmarks.postId, postId)).run();
  db.delete(likes).where(eq(likes.postId, postId)).run();
  db.delete(postViews).where(eq(postViews.postId, postId)).run();
}
