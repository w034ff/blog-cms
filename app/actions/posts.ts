'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  MAX_TAGS,
  isCategoryId,
  isPostKind,
  parseTags,
  type PostCategory,
  type PostKind,
} from '@/lib/content';
import { contentForKind } from '@/lib/draft-content';
import { incompleteFootnotes } from '@/lib/footnotes';
import { getOptionalSession, verifySession } from '@/lib/dal';
import { canCurrentUserEdit, FORBIDDEN_POST_EDIT } from '@/lib/post-access';
import { commitPost, createPost, deletePost } from '@/lib/posts-write';
import { generateUniqueSlug } from '@/lib/slug';
import { getPostForEdit } from '@/lib/posts';
import { knownTagSlugs } from '@/lib/tags';
import { isUploadPath } from '@/lib/thumbnail';
import type { DraftContent } from '@/lib/types';

// Strict: runs only on an explicit publish/unpublish. Autosave (app/api/drafts) stays lenient so
// partial work is never lost. Slug, date and the draft flag are not fields here.
const contentSchema = z.object({
  title: z.string().min(1),
  // Refused rather than normalized: an id off the list reaches here only from a crafted form.
  // '' (not chosen yet) passes here, for 下書きに戻す; publish refuses it on its own below.
  category: z.custom<PostCategory>((value) => value === '' || isCategoryId(value)),
  tags: z.array(z.string()),
  body: z.string(),
  // Normalized, not refused: no picture is a normal outcome, not worth failing a publish over.
  // `isUploadPath` keeps an off-site URL out of `<img src>` and `og:image`.
  thumbnail: z.string().transform((value) => (isUploadPath(value) ? value : '')),
});

export type PostFormState = {
  error?: string;
  // The session lapsed mid-edit. Returned instead of a /login redirect so the editor, and the
  // unsaved draft, stay mounted.
  sessionExpired?: boolean;
  // A successful publish/unpublish, which the editor adopts without navigating away. `at` makes
  // each result a distinct state object.
  saved?: { id: number; slug: string | null; published: boolean; at: number; editedAt: string };
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

// Read only when publish creates the row (投稿 before autosave made one); an existing row keeps
// its own. Anything else makes a post, as app/api/drafts does.
function parseNewKind(formData: FormData): PostKind {
  const value = field(formData, 'kind');
  return isPostKind(value) ? value : 'post';
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

// Inert today: nothing uses the Data Cache and `staleTimes.dynamic` is 0
// (e2e/revalidate-client-cache.spec.ts). Kept as the hook a module-scope cache would need, for the
// same reason as `force-dynamic` (docs/cms-features.md「RSS/Atom フィード」§7.1).
function revalidateBlog(): void {
  revalidatePath('/', 'layout');
}

// The slug is fixed at row creation, so publish only flips visibility and commits the live content.
// The date is stamped at first publish (`existing.date` is '' until then) and kept on every later
// one. With no row yet (投稿 before autosave created one), create-and-publish, written by `userId`.
async function publish(formData: FormData, userId: number): Promise<PostFormState> {
  const sent = parseContent(formData);
  if (!sent) {
    return { error: '入力が不正です。タイトルは必須です。' };
  }
  const id = parseId(formData);
  const existing = id === null ? null : await getPostForEdit(id);
  if (id !== null && !existing) {
    return { error: '記事が見つかりません。' };
  }
  if (id !== null && !(await canCurrentUserEdit(id))) {
    return { error: FORBIDDEN_POST_EDIT };
  }
  const kind = existing ? existing.kind : parseNewKind(formData);
  const content = contentForKind(sent, kind);
  // §12.32: a new post has no category until here. The editor opens 記事の設定 on `missingCategory`.
  // A scribble has none to choose (docs/scribble-requirements.md §3.2).
  if (kind === 'post' && content.category === '') {
    return { error: 'カテゴリを選んでください。', missingCategory: true };
  }
  // The editor's field stops at MAX_TAGS; this holds for a request that bypassed it. Publish only.
  if (content.tags.length > MAX_TAGS) {
    return { error: `タグは ${MAX_TAGS} つまで設定できます。` };
  }
  // docs/footnote-requirements.md §5.2's third layer: a draft may hold an empty note, a published
  // post may not. The message gives the count, since the author never sees the label.
  const incomplete = incompleteFootnotes(content.body);
  if (incomplete.length > 0) {
    return {
      error: `脚注が ${incomplete.length} 件、空のままです。内容を書いてから公開してください。`,
    };
  }
  if (id !== null && existing) {
    // First publish stamps the date; once set it never changes.
    const date = existing.date || new Date().toISOString();
    const editedAt = commitPost(id, content, false, date);
    if (!editedAt) {
      return { error: '記事が見つかりません。' };
    }
    revalidateBlog();
    return {
      saved: {
        id,
        slug: existing.slug,
        published: true,
        at: Date.now(),
        editedAt,
      },
    };
  }

  // Create-and-publish.
  const slug = generateUniqueSlug();
  const { id: newId, editedAt } = createPost({
    slug,
    ...content,
    kind,
    date: new Date().toISOString(),
    draft: false,
    authorId: userId,
  });
  revalidateBlog();
  return { saved: { id: newId, slug, published: true, at: Date.now(), editedAt } };
}

// Back to a draft, keeping the content and the slug, so re-publishing reuses the URL.
async function unpublish(formData: FormData): Promise<PostFormState> {
  const sent = parseContent(formData);
  if (!sent) {
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
  if (!(await canCurrentUserEdit(id))) {
    return { error: FORBIDDEN_POST_EDIT };
  }
  // Keep the first-publish date so re-publishing later reuses it.
  const editedAt = commitPost(id, contentForKind(sent, existing.kind), true, existing.date);
  if (!editedAt) {
    return { error: '記事が見つかりません。' };
  }
  revalidateBlog();
  return {
    saved: {
      id,
      slug: existing.slug,
      published: false,
      at: Date.now(),
      editedAt,
    },
  };
}

export async function submitPostAction(
  _prev: PostFormState,
  formData: FormData,
): Promise<PostFormState> {
  // No redirect on an expired session: it would discard the editor's content (`sessionExpired`).
  const session = await getOptionalSession();
  if (!session) {
    return { sessionExpired: true };
  }
  return field(formData, 'intent') === 'unpublish'
    ? unpublish(formData)
    : publish(formData, session.userId);
}

export async function deletePostAction(formData: FormData): Promise<void> {
  await verifySession();
  const id = parseId(formData);
  if (id !== null && (await canCurrentUserEdit(id))) {
    deletePost(id);
    revalidateBlog();
  }
  redirect('/admin');
}
