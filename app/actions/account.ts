'use server';

import { revalidatePath } from 'next/cache';
import { getOptionalSession } from '@/lib/dal';
import { saveDisplayName } from '@/lib/display-name';
import { chooseHandle, planHandleChange } from '@/lib/handle';

// /admin/account (docs/multi-author-requirements.md §6.1). `errors` names the field to fix,
// `error` refuses the whole form, `at` tells one save from the next.
export type AccountFormErrors = { displayName?: string; handle?: string };

export type AccountFormState = {
  errors?: AccountFormErrors;
  error?: string;
  at?: number;
};

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

// Saves the signed-in user's display name and, while it can still be chosen, their ID
// (docs/multi-author-requirements.md §6.1, §10.4, §13.4).
// Updates only the row belonging to the session user, ignoring any other user id submitted.
export async function saveAccountAction(
  _prev: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  const session = await getOptionalSession();
  if (!session) {
    return { error: 'ログインしていません。' };
  }

  // The ID field is sent only while the ID can still be chosen (§13.4). It is checked before
  // anything is written, so a refused ID does not leave the display name saved behind it.
  const rawHandle = formData.get('handle');
  const handlePlan =
    typeof rawHandle === 'string' ? planHandleChange(session.userId, rawHandle) : null;
  if (handlePlan?.kind === 'error') {
    return { errors: { handle: handlePlan.error } };
  }

  const result = saveDisplayName(session.userId, field(formData, 'displayName'));
  if (!result.ok) {
    return { errors: { displayName: result.error } };
  }

  if (handlePlan?.kind === 'change') {
    const chosen = chooseHandle(session.userId, handlePlan.value);
    if (!chosen.ok) return { errors: { handle: chosen.error } };
  }

  revalidatePath('/', 'layout');
  return { at: Date.now() };
}
