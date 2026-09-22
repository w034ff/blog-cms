import 'server-only';
import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { posts } from '@/lib/db/schema';
import { normalizeDraftContent, sameDraftContent } from '@/lib/draft-content';
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
// cannot see yet. Narrowed the same way PostForEdit is, and for the same reason — the public
// surfaces have no use for it, and Post reaches every one of them.
export type AdminPost = Post & { hasPendingEdits: boolean };

function toPost(row: PostRow): Post {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    date: row.date,
    category: row.category,
    tags: tagsSchema.parse(row.tags),
    draft: row.draft,
    body: row.body,
    thumbnail: row.thumbnail,
    unlisted: row.unlisted,
    updatedAt: row.updatedAt,
  };
}

export async function getAllPosts(): Promise<Post[]> {
  const rows = db
    .select()
    .from(posts)
    .where(and(eq(posts.draft, false), eq(posts.unlisted, false)))
    .orderBy(desc(posts.date))
    .all();
  return rows.map(toPost);
}

export async function getPostBySlug(slug: string): Promise<Post | null> {
  const row = db.select().from(posts).where(eq(posts.slug, slug)).get();
  if (!row || row.draft) return null;
  return toPost(row);
}

// The complement of the above, and deliberately a second function rather than a flag on it.
// `getPostBySlug` is what a link card (lib/resolve-card.ts's resolveCard) and
// /api/link-title ask, and both are required to report a draft and an unknown slug identically —
// docs/link-requirements.md §6.1. Widening that one would leak draft titles into cards; this one
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
  const row = db.select().from(posts).where(eq(posts.slug, slug)).get();
  if (!row || !row.draft) return null;
  return toPost(row);
}

// `draft_content` is written only for a published post (a draft's edits go straight to the live
// columns) and cleared by commitPost on both publish and unpublish, so the flag is derived, not
// stored — and it can never be true on a row the list is badging 下書き. It asks whether the
// parked copy differs from what is public, not merely whether one exists: see hasUnpublishedEdits.
//
// This list is the only place that state can be noticed after the fact. In the editor it is the
// publish button's own enabled state, which you have to already be in the editor to read.
export async function listAllPosts(): Promise<AdminPost[]> {
  const rows = db.select().from(posts).orderBy(desc(posts.date)).all();
  return rows.map((row) => {
    const post = toPost(row);
    return {
      ...post,
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

// Whether a stored working copy is an unpublished *change*, rather than a copy of what is already
// public. The two differ because publish and autosave can race: `commitPost` clears draft_content
// while an autosave started a moment earlier is still in flight, and that save writes the copy
// back afterwards. Both carry the same form content, so what lands is a working copy identical to
// the live columns — real as a row, empty as a claim. Keyed on `draft_content !== null` the admin
// list badged that as 未公開の変更あり, indistinguishable from a genuine pending edit and clearable
// only by publishing again. Comparing the content answers that case and the genuine one alike, and
// asks nothing of the write path (where an abort would not help: the request is already sent, and
// the handler runs whether or not the client is still listening).
function hasUnpublishedEdits(post: Post, draftContent: DraftContent | null): boolean {
  return draftContent !== null && !sameDraftContent(draftContent, liveContent(post));
}

export async function getPostForEdit(id: number): Promise<PostForEdit | null> {
  const row = db.select().from(posts).where(eq(posts.id, id)).get();
  if (!row) return null;
  const post = toPost(row);
  const draftContent = row.draftContent ? normalizeDraftContent(row.draftContent) : null;
  return { ...post, draftContent, hasPendingEdits: hasUnpublishedEdits(post, draftContent) };
}

export async function getPostsByTag(tag: string): Promise<Post[]> {
  const all = await getAllPosts();
  return all.filter((post) => post.tags.includes(tag));
}

export async function getPostsByCategory(category: string): Promise<Post[]> {
  const rows = db
    .select()
    .from(posts)
    .where(and(eq(posts.draft, false), eq(posts.unlisted, false), eq(posts.category, category)))
    .orderBy(desc(posts.date))
    .all();
  return rows.map(toPost);
}

// Tally one facet of the published posts, most frequent first with ties broken by name.
// The tag and category listings differ only in what each post contributes — a tag array
// versus its single category — and in what their result rows are called, so `valuesOf`
// covers the first and the caller's own `map` the second. The ordering is the part worth
// keeping in one place: it was written out twice, so a change to the tiebreak could land
// on one listing and not the other.
function countFacet(list: Post[], valuesOf: (post: Post) => readonly string[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const post of list) {
    for (const value of valuesOf(post)) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries()).sort(
    ([aName, aCount], [bName, bCount]) => bCount - aCount || aName.localeCompare(bName),
  );
}

export async function getAllTags(): Promise<TagCount[]> {
  const counted = countFacet(await getAllPosts(), (post) => post.tags);
  return counted.map(([tag, count]) => ({ tag, count }));
}

export async function getAllCategories(): Promise<CategoryCount[]> {
  const counted = countFacet(await getAllPosts(), (post) => [post.category]);
  return counted.map(([category, count]) => ({ category, count }));
}
