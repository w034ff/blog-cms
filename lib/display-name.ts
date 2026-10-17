import 'server-only';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { posts, users } from '@/lib/db/schema';

// What the display name accepts (docs/multi-author-requirements.md §3, §6.1).
// Pure validation, matching the rules in lib/site-settings-rules.ts.
export const DISPLAY_NAME_MAX_CHARS = 20;

export const DISPLAY_NAME_TOO_LONG = '20 文字以内で入力してください';
export const NO_LINE_BREAKS = '改行は使えません';

// Characters as a reader counts them: a surrogate pair is one.
export function codePointLength(value: string): number {
  return Array.from(value).length;
}

export type DisplayNameErrors = { displayName?: string };
export type DisplayNameResult =
  { ok: true; value: string } | { ok: false; error: string; errors: DisplayNameErrors };

export function validateDisplayName(raw: string): DisplayNameResult {
  const trimmed = raw.trim();
  if (/[\r\n]/.test(trimmed)) {
    return { ok: false, error: NO_LINE_BREAKS, errors: { displayName: NO_LINE_BREAKS } };
  }
  if (codePointLength(trimmed) > DISPLAY_NAME_MAX_CHARS) {
    return {
      ok: false,
      error: DISPLAY_NAME_TOO_LONG,
      errors: { displayName: DISPLAY_NAME_TOO_LONG },
    };
  }
  return { ok: true, value: trimmed };
}

// Reads the user's display name from the database (docs/multi-author-requirements.md §6.1).
// Returns '' if the user row does not exist or the id is absent.
export function getUserDisplayName(userId: number | null | undefined): string {
  if (userId === null || userId === undefined || !Number.isSafeInteger(userId)) return '';
  const row = db
    .select({ displayName: users.displayName })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  return row?.displayName ?? '';
}

export const getDisplayName = getUserDisplayName;

// Reads the display name of a post's author from the database (docs/multi-author-requirements.md §6.2).
// Returns '' if the post does not exist, authorId is null, or the user is absent.
export function getPostAuthorDisplayName(postId: number): string {
  if (!Number.isSafeInteger(postId)) return '';
  const post = db
    .select({ authorId: posts.authorId })
    .from(posts)
    .where(eq(posts.id, postId))
    .get();
  if (!post || post.authorId === null) return '';
  return getUserDisplayName(post.authorId);
}
