'use server';

import { revalidatePath } from 'next/cache';
import { isAdmin } from '@/lib/dal';
import { savePinnedPostId } from '@/lib/pinned-post';
import { getAllPosts } from '@/lib/posts';
import { saveSiteIdentity } from '@/lib/site-settings';
import { validateSiteIdentity, type SiteIdentityErrors } from '@/lib/site-settings-rules';

// /admin/settings (docs/site-settings-requirements.md §5). `errors` names the field to fix,
// `error` refuses the whole form, `at` tells one save from the next.
export type SettingsFormState = { errors?: SiteIdentityErrors; error?: string; at?: number };

// An answer rather than a 404, as the tag dictionary's: the form may already be on screen for an
// account demoted since it loaded.
const ADMIN_ONLY: SettingsFormState = { error: 'サイトの設定は管理者だけが変えられます。' };

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

export async function saveSiteSettingsAction(
  _prev: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  if (!(await isAdmin())) return ADMIN_ONLY;
  const result = validateSiteIdentity({
    name: field(formData, 'name'),
    description: field(formData, 'description'),
    shareImage: field(formData, 'shareImage'),
  });
  if (!result.ok) return { errors: result.errors };
  saveSiteIdentity(result.value);
  // The name is in every page's header and title, so the whole site is redrawn, as a tag rename's.
  revalidatePath('/', 'layout');
  return { at: Date.now() };
}

// トップに固定 / 固定を外す on the admin post list (docs/home-requirements.md §3). An empty `id` takes
// the pin off. Admin-only, as every value in `app_settings` is.
export type PinPostState = { error?: string; at?: number };

const PIN_ADMIN_ONLY: PinPostState = { error: 'トップへの固定は管理者だけが変えられます。' };
const PIN_NOT_LISTED: PinPostState = { error: 'トップに固定できるのは公開中の記事だけです。' };

export async function pinPostAction(
  _prev: PinPostState,
  formData: FormData,
): Promise<PinPostState> {
  if (!(await isAdmin())) return PIN_ADMIN_ONLY;
  const raw = field(formData, 'id');
  if (raw === '') {
    savePinnedPostId(null);
  } else {
    const id = Number(raw);
    // The home page's own list, so what can be pinned is exactly what the slot could show: a
    // published, listed post — not a scribble, a draft, or a suspended author's.
    const listed = (await getAllPosts()).some((post) => post.id === id);
    if (!listed) return PIN_NOT_LISTED;
    savePinnedPostId(id);
  }
  revalidatePath('/');
  revalidatePath('/admin');
  return { at: Date.now() };
}
