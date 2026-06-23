'use server';

import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { verifySession } from '@/lib/dal';
import { createPost, deletePost, postExists, updatePost, type PostInput } from '@/lib/posts-write';

const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const postSchema = z.object({
  // Empty is allowed on create — the slug is then auto-generated server-side.
  slug: z.union([z.literal(''), z.string().regex(slugRegex)]),
  title: z.string().min(1),
  date: z.string().min(1),
  description: z.string(),
  category: z.string().min(1),
  tags: z.array(z.string()),
  draft: z.boolean(),
  body: z.string(),
});

export type PostFormState = {
  error?: string;
  // Set on a successful save so the client can stay in the editor instead of
  // navigating away. `at` is a timestamp so each save (even a repeat of
  // identical content) is a distinct state the client can react to. `slug` is
  // the authoritative slug, which may be server-generated when left blank.
  // `draft` reflects the just-saved visibility, so the editor knows whether a
  // public "view" link would resolve (drafts 404 on the public page).
  saved?: { slug: string; draft: boolean; at: number };
};

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

function parseForm(formData: FormData): PostInput | null {
  const tags = field(formData, 'tags')
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  const draftRaw = field(formData, 'draft');
  const parsed = postSchema.safeParse({
    slug: field(formData, 'slug'),
    title: field(formData, 'title'),
    date: field(formData, 'date'),
    description: field(formData, 'description'),
    category: field(formData, 'category') || 'uncategorized',
    tags,
    draft: draftRaw === 'on' || draftRaw === 'true',
    body: field(formData, 'body'),
  });
  return parsed.success ? parsed.data : null;
}

// Qiita-style opaque id (20 hex chars), used as a fallback slug when the
// author leaves the slug blank (e.g. a Japanese-only title). Retried on the
// astronomically unlikely chance of a collision.
function generateUniqueSlug(): string {
  let slug = randomUUID().replace(/-/g, '').slice(0, 20);
  while (postExists(slug)) {
    slug = randomUUID().replace(/-/g, '').slice(0, 20);
  }
  return slug;
}

// Disambiguate an auto-derived slug that's already taken by appending an
// incrementing suffix (WordPress-style: foo, foo-2, foo-3 …). The result still
// matches the slug regex. Manually typed slugs are NOT suffixed — a collision
// there is reported instead, so the author can pick a different URL on purpose.
function uniqueSuffixedSlug(base: string): string {
  let n = 2;
  while (postExists(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

function revalidateBlog(): void {
  revalidatePath('/', 'layout');
}

export async function createPostAction(
  _prev: PostFormState,
  formData: FormData,
): Promise<PostFormState> {
  await verifySession();
  const parsed = parseForm(formData);
  if (!parsed) {
    return {
      error: '入力が不正です。slug は英小文字・数字・ハイフンのみ、タイトルと日付は必須です。',
    };
  }
  // Empty slug (e.g. a Japanese-only title) → opaque generated id. A non-empty
  // slug that's taken is auto-suffixed when derived from the title, but reported
  // as an error when the author typed it explicitly (slugManual).
  let slug = parsed.slug;
  if (slug === '') {
    slug = generateUniqueSlug();
  } else if (postExists(slug)) {
    if (field(formData, 'slugManual') === 'true') {
      return { error: `slug '${slug}' は既に存在します。` };
    }
    slug = uniqueSuffixedSlug(slug);
  }
  const input = { ...parsed, slug };
  createPost(input);
  revalidateBlog();
  return { saved: { slug: input.slug, draft: input.draft, at: Date.now() } };
}

export async function updatePostAction(
  _prev: PostFormState,
  formData: FormData,
): Promise<PostFormState> {
  await verifySession();
  const input = parseForm(formData);
  if (!input || input.slug === '') {
    return { error: '入力が不正です。' };
  }
  if (!postExists(input.slug)) {
    return { error: `slug '${input.slug}' が見つかりません。` };
  }
  updatePost(input.slug, input);
  revalidateBlog();
  return { saved: { slug: input.slug, draft: input.draft, at: Date.now() } };
}

export async function deletePostAction(formData: FormData): Promise<void> {
  await verifySession();
  const slug = field(formData, 'slug');
  if (slug.length > 0) {
    deletePost(slug);
    revalidateBlog();
  }
  redirect('/admin');
}
