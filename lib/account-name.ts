import { getInitialLetter } from '@/lib/site-section';

// Shown where an account has neither a display name nor a username: a Google author who cleared
// theirs (docs/multi-author-requirements.md §9.7). Written as the admin list writes （無題）.
export const NO_DISPLAY_NAME = '（表示名なし）';

// The account button's letter when there is no name to take one from.
const NO_NAME_INITIAL = '?';

export type AccountName = { name: string; initial: string };

// How the admin screens and the header name an account (docs/multi-author-requirements.md §9.7):
// the display name, else the username, else NO_DISPLAY_NAME.
export function accountName(user: { displayName: string; username: string | null }): AccountName {
  const name = user.displayName.trim() || user.username?.trim() || '';
  return name
    ? { name, initial: getInitialLetter(name) }
    : { name: NO_DISPLAY_NAME, initial: NO_NAME_INITIAL };
}
