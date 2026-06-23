import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { posts } from "@/lib/db/schema";

export type PostInput = {
  slug: string;
  title: string;
  date: string;
  description: string;
  category: string;
  tags: string[];
  draft: boolean;
  body: string;
};

export function postExists(slug: string): boolean {
  const row = db
    .select({ slug: posts.slug })
    .from(posts)
    .where(eq(posts.slug, slug))
    .get();
  return row !== undefined;
}

export function createPost(input: PostInput): void {
  const now = new Date().toISOString();
  db.insert(posts)
    .values({ ...input, createdAt: now, updatedAt: now })
    .run();
}

export function updatePost(slug: string, input: PostInput): void {
  db.update(posts)
    .set({ ...input, updatedAt: new Date().toISOString() })
    .where(eq(posts.slug, slug))
    .run();
}

export function deletePost(slug: string): void {
  db.delete(posts).where(eq(posts.slug, slug)).run();
}
