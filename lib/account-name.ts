import { getInitialLetter } from '@/lib/site-section';

// Shown where a screen names an account by its display name alone and it has none: the users list
// and detail page, which show the ID right beside it (docs/multi-author-requirements.md §13.5).
// Written as the admin list writes （無題）.
export const NO_DISPLAY_NAME = '（表示名なし）';

export type AccountName = { name: string; initial: string };

// How the admin screens and the header name an account (docs/multi-author-requirements.md §9.7,
// §13.5): the display name, else the ID as @handle. Every account has an ID, so there is always a
// name and a letter. The login username is not used: it pairs with the password.
export function accountName(user: { displayName: string; handle: string }): AccountName {
  const displayName = user.displayName.trim();
  if (displayName) return { name: displayName, initial: getInitialLetter(displayName) };
  return { name: `@${user.handle}`, initial: getInitialLetter(user.handle) };
}
