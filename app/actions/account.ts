'use server';

import { revalidatePath } from 'next/cache';
import { getOptionalSession } from '@/lib/dal';
import { saveDisplayName, type DisplayNameErrors } from '@/lib/display-name';

// /admin/account (docs/multi-author-requirements.md §6.1). `errors` names the field to fix,
// `error` refuses the whole form, `at` tells one save from the next.
export type AccountFormState = {
  errors?: DisplayNameErrors;
  error?: string;
  at?: number;
};

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

// Saves the signed-in user's display name (docs/multi-author-requirements.md §6.1, §10.4).
// Updates only the row belonging to the session user, ignoring any other user id submitted.
export async function saveAccountAction(
  _prev: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  const session = await getOptionalSession();
  if (!session) {
    return { error: 'ログインしていません。' };
  }

  const result = saveDisplayName(session.userId, field(formData, 'displayName'));
  if (!result.ok) {
    return { errors: { displayName: result.error } };
  }

  revalidatePath('/', 'layout');
  return { at: Date.now() };
}
