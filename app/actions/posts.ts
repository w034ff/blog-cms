'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { MAX_TAGS, isCategoryId, parseTags, type PostCategory } from '@/lib/content';
import { incompleteFootnotes } from '@/lib/footnotes';
import { getOptionalSession, verifySession } from '@/lib/dal';
import { commitPost, createPost, deletePost } from '@/lib/posts-write';
import { generateUniqueSlug } from '@/lib/slug';
import { getPostForEdit } from '@/lib/posts';
import { knownTagSlugs } from '@/lib/tags';
import { isUploadPath } from '@/lib/thumbnail';
import type { DraftContent } from '@/lib/types';

// Editable content (no slug; publish date and the draft/publish flag live outside this schema, set
// by which button was pressed rather than a field here). Strict: this runs only when the author
// explicitly publishes/unpublishes, so required fields are enforced here — autosave (app/api/drafts)
// stays lenient so partial work is never lost.
const contentSchema = z.object({
  title: z.string().min(1),
  // Refused rather than normalized: an id off the list reaches here only from a crafted form.
  // '' (not chosen yet) passes here, for 下書きに戻す; publish refuses it on its own below.
  category: z.custom<PostCategory>((value) => value === '' || isCategoryId(value)),
  tags: z.array(z.string()),
  body: z.string(),
  // Not strict, unlike its neighbours here: an unusable path normalizes to ''
  // (the "author chose none" state) rather than refusing the publish. The image
  // is decoration on a card, and no picture is a normal outcome — failing the
  // whole publish over one would be the wrong trade. `isUploadPath` is what
  // keeps an off-site URL out of `<img src>` and `og:image`.
  thumbnail: z.string().transform((value) => (isUploadPath(value) ? value : '')),
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
  // The refusal is for カテゴリ not chosen (§12.32): the editor opens 記事の設定 onto it.
  missingCategory?: true;
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
  const parsed = contentSchema.safeParse({
    title: field(formData, 'title'),
    category: field(formData, 'category'),
    // Slugs the dictionary does not have are dropped, not refused (lib/tags.ts `knownTagSlugs`).
    tags: knownTagSlugs(parseTags(field(formData, 'tags'))),
    body: field(formData, 'body'),
    thumbnail: field(formData, 'thumbnail'),
  });
  return parsed.success ? parsed.data : null;
}

// Measured inert on this site, and kept for the same reason `force-dynamic` is (docs/cms-features.md
// §7.1): `revalidatePath` reaches `fetch()`'s Data Cache, which nothing here uses, and the browser's
// Client Cache, which holds nothing because `staleTimes.dynamic` defaults to 0 and every route is
// dynamic. A/B'd 2026-09-14 against a production build — with this body and without it, a just-
// published edit is visible on /admin, / and /posts/[slug] reached by <Link> alone
// (e2e/revalidate-client-cache.spec.ts). It is the invalidation hook a module-scope cache would
// need, so it stays where the four call sites already are.
function revalidateBlog(): void {
  revalidatePath('/', 'layout');
}

// Make a post public with the current editor content. The opaque slug is
// assigned once at row creation, so publish never touches it — it only flips
// visibility and refreshes the live columns. The public date is captured here at
// first publish (`existing.date` is the '' sentinel until then) and preserved on
// every later publish, so it reflects when the post first went live; the
// timestamp is UTC, rendered as the Asia/Tokyo date at display time. Two cases,
// told apart by whether the row already exists:
//  - existing row (draft or published) → commit the live content; the slug it
//    was born with stays its permanent URL, and its date is kept once set.
//  - no row yet → create-and-publish (the author clicked 投稿 before autosave
//    materialized the row): create it with a fresh opaque slug and today's date,
//    already public.
async function publish(formData: FormData): Promise<PostFormState> {
  const content = parseContent(formData);
  if (!content) {
    return { error: '入力が不正です。タイトルは必須です。' };
  }
  // A new post starts with no category (§12.32), and publishing is where it has to be chosen. The
  // editor opens 記事の設定 on `missingCategory` and says this under the field, so it need not
  // name where the field is.
  if (content.category === '') {
    return { error: 'カテゴリを選んでください。', missingCategory: true };
  }
  // docs/footnote-requirements.md §5.2's third layer. Autosave and 下書き保存 stay lenient — a note
  // half-written is work in progress, and refusing to store it is how drafts get lost — but an
  // empty one is meaningless to a reader, so publishing is where it has to be finished. The number
  // is what the author sees on screen; the label never is, so it is no use in the message.
  // The editor's field stops at MAX_TAGS; this is the same line for a request that did not come
  // through it. Publish only: autosave and 下書きに戻す keep what they are given.
  if (content.tags.length > MAX_TAGS) {
    return { error: `タグは ${MAX_TAGS} つまで設定できます。` };
  }
  const incomplete = incompleteFootnotes(content.body);
  if (incomplete.length > 0) {
    return {
      error: `脚注が ${incomplete.length} 件、空のままです。内容を書いてから公開してください。`,
    };
  }
  const id = parseId(formData);

  if (id !== null) {
    const existing = await getPostForEdit(id);
    if (!existing) {
      return { error: '記事が見つかりません。' };
    }
    // First publish stamps the date; once set it never changes.
    const date = existing.date || new Date().toISOString();
    if (!commitPost(id, content, false, date)) {
      return { error: '記事が見つかりません。' };
    }
    revalidateBlog();
    return { saved: { id, slug: existing.slug, published: true, at: Date.now() } };
  }

  // Create-and-publish.
  const slug = generateUniqueSlug();
  const newId = createPost({ slug, ...content, date: new Date().toISOString(), draft: false });
  revalidateBlog();
  return { saved: { id: newId, slug, published: true, at: Date.now() } };
}

// Take a published post down (back to a draft) while keeping the current content
// and its slug (so re-publishing reuses the same URL). Only offered for existing
// published posts, so the row must exist.
async function unpublish(formData: FormData): Promise<PostFormState> {
  const content = parseContent(formData);
  if (!content) {
    return { error: '入力が不正です。タイトルは必須です。' };
  }
  const id = parseId(formData);
  if (id === null) {
    return { error: '記事が見つかりません。' };
  }
  const existing = await getPostForEdit(id);
  if (!existing) {
    return { error: '記事が見つかりません。' };
  }
  // Keep the first-publish date so re-publishing later reuses it.
  if (!commitPost(id, content, true, existing.date)) {
    return { error: '記事が見つかりません。' };
  }
  revalidateBlog();
  return { saved: { id, slug: existing.slug, published: false, at: Date.now() } };
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
