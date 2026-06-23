import { promises as fs } from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import type {
  CategoryCount,
  Post,
  PostFrontmatter,
  TagCount,
} from "@/lib/types";

const POSTS_DIR = path.join(process.cwd(), "content", "posts");
const MDX_EXTENSION = ".mdx";
const DEFAULT_CATEGORY = "uncategorized";

type RawFrontmatter = {
  title?: string;
  date?: string;
  description?: string;
  tags?: string[];
  category?: string;
  draft?: boolean;
};

function parseFrontmatter(raw: RawFrontmatter, slug: string): PostFrontmatter {
  if (typeof raw.title !== "string" || raw.title.length === 0) {
    throw new Error(`Missing 'title' in frontmatter of ${slug}`);
  }
  if (typeof raw.date !== "string" || raw.date.length === 0) {
    throw new Error(`Missing 'date' in frontmatter of ${slug}`);
  }
  return {
    title: raw.title,
    date: raw.date,
    description: raw.description ?? "",
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    category: raw.category ?? DEFAULT_CATEGORY,
    draft: raw.draft ?? false,
  };
}

async function readPostFile(slug: string): Promise<Post> {
  const filePath = path.join(POSTS_DIR, `${slug}${MDX_EXTENSION}`);
  const source = await fs.readFile(filePath, "utf8");
  const parsed = matter(source);
  const frontmatter = parseFrontmatter(parsed.data as RawFrontmatter, slug);
  return { ...frontmatter, slug };
}

export async function getAllPosts(): Promise<Post[]> {
  const entries = await fs.readdir(POSTS_DIR);
  const slugs = entries
    .filter((name) => name.endsWith(MDX_EXTENSION))
    .map((name) => name.slice(0, -MDX_EXTENSION.length));
  const posts = await Promise.all(slugs.map(readPostFile));
  return posts
    .filter((post) => !post.draft)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

export async function getPostBySlug(slug: string): Promise<Post | null> {
  try {
    const post = await readPostFile(slug);
    if (post.draft) return null;
    return post;
  } catch {
    return null;
  }
}

export async function getPostsByTag(tag: string): Promise<Post[]> {
  const posts = await getAllPosts();
  return posts.filter((post) => post.tags.includes(tag));
}

export async function getPostsByCategory(category: string): Promise<Post[]> {
  const posts = await getAllPosts();
  return posts.filter((post) => post.category === category);
}

export async function getAllTags(): Promise<TagCount[]> {
  const posts = await getAllPosts();
  const counts = new Map<string, number>();
  for (const post of posts) {
    for (const tag of post.tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

export async function getAllCategories(): Promise<CategoryCount[]> {
  const posts = await getAllPosts();
  const counts = new Map<string, number>();
  for (const post of posts) {
    counts.set(post.category, (counts.get(post.category) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
}
