'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { verifySession } from '@/lib/dal';
import { createPost, deletePost, postExists, updatePost, type PostInput } from '@/lib/posts-write';

const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const postSchema = z.object({
  slug: z.string().regex(slugRegex),
  title: z.string().min(1),
  date: z.string().min(1),
  description: z.string(),
  category: z.string().min(1),
  tags: z.array(z.string()),
  draft: z.boolean(),
  body: z.string(),
});

export type PostFormState = { error?: string };

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

function revalidateBlog(): void {
  revalidatePath('/', 'layout');
}

function destinationFor(input: PostInput): string {
  return input.draft ? '/admin' : `/posts/${input.slug}`;
}

export async function createPostAction(
  _prev: PostFormState,
  formData: FormData,
): Promise<PostFormState> {
  await verifySession();
  const input = parseForm(formData);
  if (!input) {
    return {
      error: '入力が不正です。slug は英小文字・数字・ハイフンのみ、タイトルと日付は必須です。',
    };
  }
  if (postExists(input.slug)) {
    return { error: `slug '${input.slug}' は既に存在します。` };
  }
  createPost(input);
  revalidateBlog();
  redirect(destinationFor(input));
}

export async function updatePostAction(
  _prev: PostFormState,
  formData: FormData,
): Promise<PostFormState> {
  await verifySession();
  const input = parseForm(formData);
  if (!input) {
    return { error: '入力が不正です。' };
  }
  if (!postExists(input.slug)) {
    return { error: `slug '${input.slug}' が見つかりません。` };
  }
  updatePost(input.slug, input);
  revalidateBlog();
  redirect(destinationFor(input));
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
