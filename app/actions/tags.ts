'use server';

import { revalidatePath } from 'next/cache';
import { isAdmin } from '@/lib/dal';
import { addAlias, createTag, deleteTag, removeAlias, updateTag } from '@/lib/tags';

// /admin/tags (docs/editor-requirements.md §12.33). Each action answers the form it came from:
// `error` for a refusal the author has to read, `at` to tell one success from the next.
export type TagFormState = { error?: string; at?: number };

// The dictionary is shared by every author, so changing it is an admin's (§12.33.1). An answer
// rather than a 404: the form is already on screen for someone demoted since it loaded.
const ADMIN_ONLY: TagFormState = { error: 'タグの管理は管理者だけが行えます。' };

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
  if (!(await isAdmin())) return ADMIN_ONLY;
  const result = createTag(field(formData, 'name'));
  if (!result.ok) return { error: result.error };
  if (!result.created) return { error: `「${result.tag.name}」は既にあります。` };
  revalidateTags();
  return { at: Date.now() };
}

export async function updateTagAction(
  _prev: TagFormState,
  formData: FormData,
): Promise<TagFormState> {
  if (!(await isAdmin())) return ADMIN_ONLY;
  const result = updateTag(field(formData, 'slug'), field(formData, 'name'), field(formData, 'to'));
  if (!result.ok) return { error: result.error };
  revalidateTags();
  return { at: Date.now() };
}

export async function deleteTagAction(
  _prev: TagFormState,
  formData: FormData,
): Promise<TagFormState> {
  if (!(await isAdmin())) return ADMIN_ONLY;
  if (!deleteTag(field(formData, 'slug'))) return { error: 'タグが見つかりません。' };
  revalidateTags();
  return { at: Date.now() };
}

export async function addAliasAction(
  _prev: TagFormState,
  formData: FormData,
): Promise<TagFormState> {
  if (!(await isAdmin())) return ADMIN_ONLY;
  const result = addAlias(field(formData, 'slug'), field(formData, 'alias'));
  if (!result.ok) return { error: result.error };
  revalidateTags();
  return { at: Date.now() };
}

export async function removeAliasAction(
  _prev: TagFormState,
  formData: FormData,
): Promise<TagFormState> {
  if (!(await isAdmin())) return ADMIN_ONLY;
  if (!removeAlias(field(formData, 'alias'))) return { error: '別名が見つかりません。' };
  revalidateTags();
  return { at: Date.now() };
}
