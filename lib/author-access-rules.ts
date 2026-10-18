// The author sign-up policy and invites (docs/multi-author-requirements.md §9.4). Pure, so the users
// screen's form can share the values with the Server Action that saves them.

// `allowlist`: only invited addresses may create an account. `open`: any Google account may.
export const AUTHOR_ACCESS_MODES = ['allowlist', 'open'] as const;
export type AuthorAccessMode = (typeof AUTHOR_ACCESS_MODES)[number];
export const DEFAULT_AUTHOR_ACCESS_MODE: AuthorAccessMode = 'allowlist';

// The `app_settings` key the policy is saved under. No row means the default.
export const AUTHOR_ACCESS_MODE_KEY = 'author_access_mode';

export function isAuthorAccessMode(value: unknown): value is AuthorAccessMode {
  return AUTHOR_ACCESS_MODES.some((mode) => mode === value);
}

// Invites and Google's `email` claim are compared in this form: trimmed and lower-cased, with no
// provider-specific folding (Gmail's dots and `+` tags are kept), §9.2.
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}
