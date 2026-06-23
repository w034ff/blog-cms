import "server-only";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { posts } from "@/lib/db/schema";
import type { CategoryCount, Post, TagCount } from "@/lib/types";

const tagsSchema = z.array(z.string()).catch([]);

type PostRow = typeof posts.$inferSelect;

function toPost(row: PostRow): Post {
  return {
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

export async function getPostForEdit(slug: string): Promise<Post | null> {
  const row = db.select().from(posts).where(eq(posts.slug, slug)).get();
  return row ? toPost(row) : null;
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

export async function getAllTags(): Promise<TagCount[]> {
  const all = await getAllPosts();
  const counts = new Map<string, number>();
  for (const post of all) {
    for (const tag of post.tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

export async function getAllCategories(): Promise<CategoryCount[]> {
  const all = await getAllPosts();
  const counts = new Map<string, number>();
  for (const post of all) {
    counts.set(post.category, (counts.get(post.category) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
}
