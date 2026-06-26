'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getOptionalSession, verifySession } from '@/lib/dal';
import { commitPost, createPost, deletePost, postExists } from '@/lib/posts-write';
import { generateUniqueSlug } from '@/lib/slug';
import { getPostForEdit } from '@/lib/posts';
import type { DraftContent } from '@/lib/types';

// Editable content (no slug, no visibility flag). Strict: this runs only when
// the author explicitly publishes/unpublishes, so required fields are enforced
// here — autosave (app/api/drafts) stays lenient so partial work is never lost.
const contentSchema = z.object({
  title: z.string().min(1),
  date: z.string().min(1),
  description: z.string(),
  category: z.string().min(1),
  tags: z.array(z.string()),
  body: z.string(),
});

export type PostFormState = {
  error?: string;
  // The session lapsed mid-edit (14-day cookie expired). Returned instead of a
  // /login redirect so the editor stays mounted and the unsaved draft survives;
  // the client prompts a re-login.
  sessionExpired?: boolean;
  // Set on a successful publish/unpublish so the editor can react without
  // navigating away: adopt the row id (create-and-publish materializes it here),
  // learn the finalized slug, reset the pending-changes baseline, and flash an
  // indicator. `at` makes each result a distinct state object.
  saved?: { id: number; slug: string | null; published: boolean; at: number };
};

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

// The hidden `id` carries the post's row identity once autosave (or a prior
// publish) has materialized it; empty means a brand-new post with no row yet.
function parseId(formData: FormData): number | null {
  const raw = field(formData, 'id');
  if (raw === '') return null;
  const id = Number(raw);
  return Number.isInteger(id) ? id : null;
}

function parseContent(formData: FormData): DraftContent | null {
  const tags = field(formData, 'tags')
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  const parsed = contentSchema.safeParse({
    title: field(formData, 'title'),
    date: field(formData, 'date'),
    description: field(formData, 'description'),
    category: field(formData, 'category') || 'uncategorized',
    tags,
    body: field(formData, 'body'),
  });
  return parsed.success ? parsed.data : null;
}

function revalidateBlog(): void {
  revalidatePath('/', 'layout');
}

// Make a post public with the current editor content. The opaque slug is
// assigned once at row creation, so publish never touches it — it only flips
// visibility and refreshes the live columns. Two cases, told apart by whether
// the row already exists:
//  - existing row (draft or published) → commit the live content; the slug it
//    was born with stays its permanent URL.
//  - no row yet → create-and-publish (the author clicked 投稿 before autosave
//    materialized the row): create it with a fresh opaque slug, already public.
async function publish(formData: FormData): Promise<PostFormState> {
  const content = parseContent(formData);
  if (!content) {
    return { error: '入力が不正です。タイトルと日付は必須です。' };
  }
  const id = parseId(formData);

  if (id !== null) {
    const existing = await getPostForEdit(id);
    if (!existing) {
      return { error: '記事が見つかりません。' };
    }
    commitPost(id, content, false);
    revalidateBlog();
    return { saved: { id, slug: existing.slug, published: true, at: Date.now() } };
  }

  // Create-and-publish.
  const slug = generateUniqueSlug();
  const newId = createPost({ slug, ...content, draft: false });
  revalidateBlog();
  return { saved: { id: newId, slug, published: true, at: Date.now() } };
}

// Take a published post down (back to a draft) while keeping the current content
// and its slug (so re-publishing reuses the same URL). Only offered for existing
// published posts, so the row must exist.
async function unpublish(formData: FormData): Promise<PostFormState> {
  const content = parseContent(formData);
  if (!content) {
    return { error: '入力が不正です。タイトルと日付は必須です。' };
  }
  const id = parseId(formData);
  if (id === null || !postExists(id)) {
    return { error: '記事が見つかりません。' };
  }
  const existing = await getPostForEdit(id);
  commitPost(id, content, true);
  revalidateBlog();
  return { saved: { id, slug: existing?.slug ?? null, published: false, at: Date.now() } };
}

export async function submitPostAction(
  _prev: PostFormState,
  formData: FormData,
): Promise<PostFormState> {
  // Don't redirect on an expired session — that would discard the in-progress
  // editor content. Signal the client instead so it keeps the draft and prompts
  // a re-login. (Admin pages still use verifySession's redirect.)
  if (!(await getOptionalSession())) {
    return { sessionExpired: true };
  }
  return field(formData, 'intent') === 'unpublish' ? unpublish(formData) : publish(formData);
}

export async function deletePostAction(formData: FormData): Promise<void> {
  await verifySession();
  const id = parseId(formData);
  if (id !== null) {
    deletePost(id);
    revalidateBlog();
  }
  redirect('/admin');
}
