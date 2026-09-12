import 'server-only';
import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { posts } from '@/lib/db/schema';
import type { CategoryCount, DraftContent, Post, TagCount } from '@/lib/types';

const tagsSchema = z.array(z.string()).catch([]);

type PostRow = typeof posts.$inferSelect;

// A post as seen in the editor: the live (published) version plus its private
// working copy of pending edits, if any. draftContent is non-null only for a
// published post with unpublished changes.
export type PostForEdit = Post & { draftContent: DraftContent | null };

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
    description: row.description,
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

// `draft_content` is non-null exactly when autosave has parked edits the public version does not
// have: autosavePost writes there only for a published post (a draft's edits go straight to the
// live columns), and commitPost clears it on both publish and unpublish. So the flag is derived,
// not stored — and it can never be true on a row the list is badging 下書き.
//
// This list is the only place that state can be noticed after the fact. In the editor it is the
// publish button's own enabled state, which you have to already be in the editor to read.
export async function listAllPosts(): Promise<AdminPost[]> {
  const rows = db.select().from(posts).orderBy(desc(posts.date)).all();
  return rows.map((row) => ({ ...toPost(row), hasPendingEdits: row.draftContent !== null }));
}

// `draft_content` is JSON, and `$type<DraftContent>()` only asserts its shape — nothing validates
// what is actually in the column. Every row written before a field existed is missing that field,
// and the assertion hides it: `thumbnail` came in 2026-08-15, so a post that had pending edits
// before then hands back `undefined` where the type promises a string. That reached the editor as a
// field showing 「なし」 while its label claimed an image had been chosen, with the body fallback
// skipped, because `undefined === ''` is false.
//
// Normalized here rather than at each reader, which is the same call `toPost` makes one function up
// for `tags` (`tagsSchema … .catch([])`). A field added to DraftContent later needs its default
// added here too.
function toDraftContent(stored: DraftContent): DraftContent {
  return { ...stored, thumbnail: stored.thumbnail ?? '', unlisted: stored.unlisted ?? false };
}

export async function getPostForEdit(id: number): Promise<PostForEdit | null> {
  const row = db.select().from(posts).where(eq(posts.id, id)).get();
  if (!row) return null;
  return {
    ...toPost(row),
    draftContent: row.draftContent ? toDraftContent(row.draftContent) : null,
  };
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
