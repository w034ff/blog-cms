import type { SiteIdentity } from '@/app/shared-metadata';

// What the settings form accepts (docs/site-settings-requirements.md §3). Pure, so the form can
// count characters against the same limits the Server Action enforces.
export const SITE_NAME_MAX_CHARS = 40;
export const SITE_DESCRIPTION_MAX_CHARS = 120;

// The `app_settings` keys this page owns.
export const SITE_NAME_KEY = 'site_name';
export const SITE_DESCRIPTION_KEY = 'site_description';

export const SITE_NAME_REQUIRED = '名前を入力してください';
export const NO_LINE_BREAKS = '改行は使えません';
export function tooLong(max: number): string {
  return `${max} 文字以内で入力してください`;
}

// Characters as a reader counts them: a surrogate pair is one.
export function codePointLength(value: string): number {
  return Array.from(value).length;
}

export type SiteIdentityErrors = { name?: string; description?: string };
export type SiteIdentityResult =
  { ok: true; value: SiteIdentity } | { ok: false; errors: SiteIdentityErrors };

function check(value: string, max: number, required: boolean): string | undefined {
  if (/[\r\n]/.test(value)) return NO_LINE_BREAKS;
  if (required && value === '') return SITE_NAME_REQUIRED;
  if (codePointLength(value) > max) return tooLong(max);
  return undefined;
}

// Trims both fields, then checks them; an empty description is a value, not a missing one (§3).
export function validateSiteIdentity(raw: SiteIdentity): SiteIdentityResult {
  const name = raw.name.trim();
  const description = raw.description.trim();
  const errors: SiteIdentityErrors = {};
  const nameError = check(name, SITE_NAME_MAX_CHARS, true);
  const descriptionError = check(description, SITE_DESCRIPTION_MAX_CHARS, false);
  if (nameError) errors.name = nameError;
  if (descriptionError) errors.description = descriptionError;
  if (nameError || descriptionError) return { ok: false, errors };
  return { ok: true, value: { name, description } };
}
