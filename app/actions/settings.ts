'use server';

import { revalidatePath } from 'next/cache';
import { isAdmin } from '@/lib/dal';
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
