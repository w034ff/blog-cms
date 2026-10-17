'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { getOptionalSession } from '@/lib/dal';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { validateDisplayName, type DisplayNameErrors } from '@/lib/display-name';

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

// Saves the signed-in user's display name (docs/multi-author-requirements.md §6.1).
// Updates only the row belonging to the session user, ignoring any other user id submitted.
export async function saveAccountAction(
  _prev: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  const session = await getOptionalSession();
  if (!session) {
    return { error: 'ログインしていません。' };
  }

  const raw = formData.has('displayName')
    ? field(formData, 'displayName')
    : field(formData, 'name');
  const result = validateDisplayName(raw);
  if (!result.ok) {
    return { errors: { displayName: result.error } };
  }

  db.update(users).set({ displayName: result.value }).where(eq(users.id, session.userId)).run();

  revalidatePath('/', 'layout');
  return { at: Date.now() };
}
