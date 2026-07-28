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
  };
}

export async function getAllPosts(): Promise<Post[]> {
  const rows = db
    .select()
    .from(posts)
    .where(eq(posts.draft, false))
    .orderBy(desc(posts.date))
    .all();
  return rows.map(toPost);
}

export async function getPostBySlug(slug: string): Promise<Post | null> {
  const row = db.select().from(posts).where(eq(posts.slug, slug)).get();
  if (!row || row.draft) return null;
  return toPost(row);
}

export async function listAllPosts(): Promise<Post[]> {
  const rows = db.select().from(posts).orderBy(desc(posts.date)).all();
  return rows.map(toPost);
}

export async function getPostForEdit(id: number): Promise<PostForEdit | null> {
  const row = db.select().from(posts).where(eq(posts.id, id)).get();
  if (!row) return null;
  return { ...toPost(row), draftContent: row.draftContent ?? null };
}

export async function getPostsByTag(tag: string): Promise<Post[]> {
  const all = await getAllPosts();
  return all.filter((post) => post.tags.includes(tag));
}

export async function getPostsByCategory(category: string): Promise<Post[]> {
  const rows = db
    .select()
    .from(posts)
    .where(and(eq(posts.draft, false), eq(posts.category, category)))
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
