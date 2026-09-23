'use server';

import { revalidatePath } from 'next/cache';
import { verifySession } from '@/lib/dal';
import { createTag, deleteTag, renameTag } from '@/lib/tags';

// /admin/tags (docs/editor-requirements.md §12.33). Each action answers the form it came from:
// `error` for a refusal the author has to read, `at` to tell one success from the next.
export type TagFormState = { error?: string; at?: number };

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

// A name or a deletion shows on every public surface that draws tags, so the whole site is
// revalidated, as a post's publish does (app/actions/posts.ts `revalidateBlog`).
function revalidateTags(): void {
  revalidatePath('/', 'layout');
}

export async function createTagAction(
  _prev: TagFormState,
  formData: FormData,
): Promise<TagFormState> {
  await verifySession();
  const result = createTag(field(formData, 'name'));
  if (!result.ok) return { error: result.error };
  if (!result.created) return { error: `「${result.tag.name}」は既にあります。` };
  revalidateTags();
  return { at: Date.now() };
}

export async function renameTagAction(
  _prev: TagFormState,
  formData: FormData,
): Promise<TagFormState> {
  await verifySession();
  const result = renameTag(field(formData, 'slug'), field(formData, 'name'));
  if (!result.ok) return { error: result.error };
  revalidateTags();
  return { at: Date.now() };
}

export async function deleteTagAction(
  _prev: TagFormState,
  formData: FormData,
): Promise<TagFormState> {
  await verifySession();
  if (!deleteTag(field(formData, 'slug'))) return { error: 'タグが見つかりません。' };
  revalidateTags();
  return { at: Date.now() };
}
