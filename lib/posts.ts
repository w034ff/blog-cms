import 'server-only';
import { z } from 'zod';
import { and, count, desc, eq, isNotNull, isNull, notInArray, or } from 'drizzle-orm';
import { CATEGORIES, normalizeCategory, type CategoryId, type PostKind } from '@/lib/content';
import { db } from '@/lib/db';
import { posts, users } from '@/lib/db/schema';
import { normalizeDraftContent, sameDraftContent } from '@/lib/draft-content';
import { resolveTags, tagNames } from '@/lib/tags';
import type { CategoryCount, DraftContent, Post, TagCount } from '@/lib/types';

const tagsSchema = z.array(z.string()).catch([]);

type PostRow = typeof posts.$inferSelect;

// A post as seen in the editor: the live (published) version plus its private
// working copy of pending edits, if any. draftContent is non-null only for a
// published post with unpublished changes, and `hasPendingEdits` says whether that copy differs
// from what is public — see hasUnpublishedEdits, which is why the two are not the same question.
export type PostForEdit = Post & {
  draftContent: DraftContent | null;
  hasPendingEdits: boolean;
};

// What the admin list needs beyond a Post: whether a published post is carrying edits readers
// cannot see yet, when the author last touched it (lib/db/schema.ts `editedAt`), and the author's id.
// Narrowed the same way PostForEdit is, and for the same reason — the public
// surfaces have no use for it, and Post reaches every one of them.
export type AdminPost = Post & {
  hasPendingEdits: boolean;
  editedAt: string;
  authorId: number | null;
  author?: { displayName: string; username: string | null } | null;
};

// `names` is the dictionary (`tagNames()`), read once by the caller rather than once per row. A slug
// the dictionary does not have is dropped here, so no surface draws a tag whose page is a 404.
function toPost(row: PostRow, names: ReadonlyMap<string, string>): Post {
  const tagList = resolveTags(tagsSchema.parse(row.tags), names);
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    date: row.date,
    category: normalizeCategory(row.category),
    tags: tagList.map((tag) => tag.slug),
    tagList,
    draft: row.draft,
    body: row.body,
    thumbnail: row.thumbnail,
    unlisted: row.unlisted,
    updatedAt: row.updatedAt,
    kind: row.kind,
  };
}

// Public reads exclude posts by suspended authors (docs/multi-author-requirements.md §5).
// Rows with no author (authorId === null) are retained.
export function notSuspendedAuthor() {
  return or(
    isNull(posts.authorId),
    notInArray(
      posts.authorId,
      db.select({ id: users.id }).from(users).where(isNotNull(users.suspendedAt)),
    ),
  );
}

// Set of user IDs whose accounts are currently suspended.
export function getSuspendedAuthorIds(): Set<number> {
  const rows = db.select({ id: users.id }).from(users).where(isNotNull(users.suspendedAt)).all();
  return new Set(rows.map((r) => r.id));
}

// Every read below is scoped to one kind here, not by its callers: a page that forgot to filter
// would leak scribbles into the home page or the RSS feed (docs/scribble-requirements.md §4).
function listed(kind: PostKind) {
  return and(
    eq(posts.kind, kind),
    eq(posts.draft, false),
    eq(posts.unlisted, false),
    notSuspendedAuthor(),
  );
}

function listedRows(kind: PostKind, page: ListPage = {}): PostRow[] {
  const query = db
    .select()
    .from(posts)
    .where(listed(kind))
    // `id` breaks a tie, so a page boundary cannot show one row twice or skip one.
    .orderBy(desc(posts.date), desc(posts.id));
  if (page.limit === undefined) return query.all();
  return query
    .limit(page.limit)
    .offset(page.offset ?? 0)
    .all();
}

function publishedBySlug(kind: PostKind, slug: string): Post | null {
  const row = db
    .select()
    .from(posts)
    .where(and(eq(posts.slug, slug), notSuspendedAuthor()))
    .get();
  if (!row || row.draft || row.kind !== kind) return null;
  return toPost(row, tagNames());
}

function draftBySlug(kind: PostKind, slug: string): Post | null {
  const row = db.select().from(posts).where(eq(posts.slug, slug)).get();
  if (!row || !row.draft || row.kind !== kind) return null;
  return toPost(row, tagNames());
}

export async function getAllPosts(): Promise<Post[]> {
  const names = tagNames();
  return listedRows('post').map((row) => toPost(row, names));
}

// All published, listed posts and scribbles for public search (docs/search-requirements.md §3.1).
// Excludes drafts, unlisted rows, and private draft_content edits.
export async function getSearchablePosts(): Promise<Post[]> {
  const rows = db
    .select()
    .from(posts)
    .where(or(listed('post'), listed('scribble')))
    .orderBy(desc(posts.date), desc(posts.id))
    .all();
  const names = tagNames();
  return rows.map((row) => toPost(row, names));
}

// A scribble's slug answers exactly as an unknown one does, since a link card and /api/link-title
// ask this (docs/link-card-requirements.md §6.1); scribbles are not cards in v1
// (docs/scribble-requirements.md §7.2).
export async function getPostBySlug(slug: string): Promise<Post | null> {
  return publishedBySlug('post', slug);
}

// The complement of the above, and deliberately a second function rather than a flag on it.
// `getPostBySlug` is what a link card (lib/resolve-card.ts's resolveCard) and
// /api/link-title ask, and both are required to report a draft and an unknown slug identically —
// docs/link-card-requirements.md §6.1. Widening that one would leak draft titles into cards; this one
// can only ever answer for a draft, so no caller of it can be surprised.
//
// **It carries no authorization of its own.** The only caller gates on a session first
// (getOptionalSession in the post page); this just narrows the row set. Naming it for the draft
// rather than for the viewer is what keeps that honest: a function called "forAuthor" invites the
// belief that it checks who is asking.
//
// A draft's current content is in the live columns — `draft_content` is written only for a
// *published* post, so there is no working copy to prefer here.
export async function getDraftBySlug(slug: string): Promise<Post | null> {
  return draftBySlug('post', slug);
}

// The scribble counterparts of the three above, with the same contracts. `page` is an object so the
// author filter multi-author needs can join it without a new signature (§9).
export type ListPage = { limit?: number; offset?: number };

export async function getScribbles(page: ListPage = {}): Promise<Post[]> {
  const names = tagNames();
  return listedRows('scribble', page).map((row) => toPost(row, names));
}

export async function countScribbles(): Promise<number> {
  return db.select({ n: count() }).from(posts).where(listed('scribble')).get()?.n ?? 0;
}

export async function getScribbleBySlug(slug: string): Promise<Post | null> {
  return publishedBySlug('scribble', slug);
}

// No authorization of its own, as getDraftBySlug.
export async function getScribbleDraftBySlug(slug: string): Promise<Post | null> {
  return draftBySlug('scribble', slug);
}

// `draft_content` is written only for a published post (a draft's edits go straight to the live
// columns) and cleared by commitPost on both publish and unpublish, so the flag is derived, not
// stored — and it can never be true on a row the list is badging 下書き. It asks whether the
// parked copy differs from what is public, not merely whether one exists: see hasUnpublishedEdits.
//
// This list is the only place that state can be noticed after the fact. In the editor it is the
// publish button's own enabled state, which you have to already be in the editor to read.
export async function listAllPosts(authorId?: number): Promise<AdminPost[]> {
  return listAll('post', authorId);
}

// The admin list of scribbles, separate from 記事一覧 (docs/scribble-requirements.md §6).
export async function listAllScribbles(authorId?: number): Promise<AdminPost[]> {
  return listAll('scribble', authorId);
}

function listAll(kind: PostKind, authorId?: number): AdminPost[] {
  const conditions = [eq(posts.kind, kind)];
  if (authorId !== undefined) {
    conditions.push(eq(posts.authorId, authorId));
  }
  const rows = db
    .select()
    .from(posts)
    .where(and(...conditions))
    .orderBy(desc(posts.date))
    .all();
  const userRows = db
    .select({
      id: users.id,
      displayName: users.displayName,
      username: users.username,
    })
    .from(users)
    .all();
  const userMap = new Map(
    userRows.map((u) => [u.id, { displayName: u.displayName, username: u.username }]),
  );
  const names = tagNames();
  return rows.map((row) => {
    const post = toPost(row, names);
    return {
      ...post,
      editedAt: row.editedAt,
      authorId: row.authorId,
      author: row.authorId !== null ? (userMap.get(row.authorId) ?? null) : null,
      hasPendingEdits: hasUnpublishedEdits(
        post,
        row.draftContent ? normalizeDraftContent(row.draftContent) : null,
      ),
    };
  });
}

// The live (public) columns in the shape the working copy is stored in, so the two can be compared
// — and so the editor can load one or the other without writing the shape out a second time.
export function liveContent(post: Post): DraftContent {
  return {
    title: post.title,
    category: post.category,
    tags: post.tags,
    body: post.body,
    thumbnail: post.thumbnail,
  };
}

// Whether a working copy is an unpublished *change* rather than a copy of what is public. Publish and
// autosave can race: `commitPost` clears draft_content while an in-flight autosave writes it back
// with identical content, which the admin list then badged 未公開の変更あり. Comparing content covers
// that case without touching the write path.
function hasUnpublishedEdits(post: Post, draftContent: DraftContent | null): boolean {
  return draftContent !== null && !sameDraftContent(draftContent, liveContent(post));
}

export async function getPostForEdit(id: number): Promise<PostForEdit | null> {
  const row = db.select().from(posts).where(eq(posts.id, id)).get();
  if (!row) return null;
  const post = toPost(row, tagNames());
  const draftContent = row.draftContent ? normalizeDraftContent(row.draftContent) : null;
  return { ...post, draftContent, hasPendingEdits: hasUnpublishedEdits(post, draftContent) };
}

export async function getPostsByTag(tag: string): Promise<Post[]> {
  const all = await getAllPosts();
  return all.filter((post) => post.tags.includes(tag));
}

export async function getPostsByCategory(category: CategoryId): Promise<Post[]> {
  const rows = db
    .select()
    .from(posts)
    .where(and(listed('post'), eq(posts.category, category)))
    .orderBy(desc(posts.date))
    .all();
  const names = tagNames();
  return rows.map((row) => toPost(row, names));
}

// The tags of the published posts, most frequent first with ties broken by name. Counted from
// `tagList`, which toPost has already resolved, so a slug the dictionary lacks is not counted.
export async function getAllTags(): Promise<TagCount[]> {
  const counts = new Map<string, TagCount>();
  for (const post of await getAllPosts()) {
    for (const tag of post.tagList) {
      counts.set(tag.slug, { ...tag, count: (counts.get(tag.slug)?.count ?? 0) + 1 });
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

// In CATEGORIES' order rather than by count: the list is fixed and short, so its own order is the
// one a reader learns. A category with no published post is left out — its page would be a 404.
export async function getAllCategories(): Promise<CategoryCount[]> {
  const published = await getAllPosts();
  return CATEGORIES.map(({ id }) => ({
    category: id,
    count: published.filter((post) => post.category === id).length,
  })).filter(({ count }) => count > 0);
}
