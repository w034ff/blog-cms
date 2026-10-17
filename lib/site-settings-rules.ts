import type { SiteIdentity } from '@/app/shared-metadata';
import { isUploadPath } from '@/lib/thumbnail';

// What the settings form accepts (docs/site-settings-requirements.md §3). Pure, so the form can
// count characters against the same limits the Server Action enforces.
export const SITE_NAME_MAX_CHARS = 40;
export const SITE_DESCRIPTION_MAX_CHARS = 120;

// The `app_settings` keys this page owns.
export const SITE_NAME_KEY = 'site_name';
export const SITE_DESCRIPTION_KEY = 'site_description';
export const SITE_SHARE_IMAGE_KEY = 'site_share_image';

export const SITE_NAME_REQUIRED = '名前を入力してください';
export const NO_LINE_BREAKS = '改行は使えません';
// Only a forged request sends anything but '' or an upload path; the picker produces nothing else.
export const SHARE_IMAGE_INVALID = '画像を選び直してください';
export function tooLong(max: number): string {
  return `${max} 文字以内で入力してください`;
}

// Characters as a reader counts them: a surrogate pair is one.
export function codePointLength(value: string): number {
  return Array.from(value).length;
}

export type SiteIdentityErrors = { name?: string; description?: string; shareImage?: string };
export type SiteIdentityResult =
  { ok: true; value: SiteIdentity } | { ok: false; errors: SiteIdentityErrors };

function check(value: string, max: number, required: boolean): string | undefined {
  if (/[\r\n]/.test(value)) return NO_LINE_BREAKS;
  if (required && value === '') return SITE_NAME_REQUIRED;
  if (codePointLength(value) > max) return tooLong(max);
  return undefined;
}

// Trims the text fields, then checks them; an empty description is a value, not a missing one
// (§3). The share image is '' or an upload path, the shape the uploads sweep recognises (§9).
export function validateSiteIdentity(raw: SiteIdentity): SiteIdentityResult {
  const name = raw.name.trim();
  const description = raw.description.trim();
  const shareImage = raw.shareImage;
  const errors: SiteIdentityErrors = {};
  const nameError = check(name, SITE_NAME_MAX_CHARS, true);
  const descriptionError = check(description, SITE_DESCRIPTION_MAX_CHARS, false);
  const shareImageError =
    shareImage === '' || isUploadPath(shareImage) ? undefined : SHARE_IMAGE_INVALID;
  if (nameError) errors.name = nameError;
  if (descriptionError) errors.description = descriptionError;
  if (shareImageError) errors.shareImage = shareImageError;
  if (nameError || descriptionError || shareImageError) return { ok: false, errors };
  return { ok: true, value: { name, description, shareImage } };
}
