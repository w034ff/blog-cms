import 'server-only';
import { and, desc, eq, ne } from 'drizzle-orm';
import { db, type AppDatabase } from '@/lib/db';
import { displayNameHistory, posts, users } from '@/lib/db/schema';
import { formatRevisionTime } from '@/lib/format';
import { codePointLength } from '@/lib/site-settings-rules';

// What the display name accepts (docs/multi-author-requirements.md §3, §6.1).
// Pure validation, matching the rules in lib/site-settings-rules.ts.
export const DISPLAY_NAME_MAX_CHARS = 20;

export const DISPLAY_NAME_TOO_LONG = '20 文字以内で入力してください';
export const NO_LINE_BREAKS = '改行は使えません';
export const DISPLAY_NAME_REQUIRED = '表示名を入力してください';
export const DISPLAY_NAME_TAKEN = 'この表示名はほかの利用者が使っています';
export const DISPLAY_NAME_INVISIBLE = '見えない文字は使えません';
export const DISPLAY_NAME_RESERVED = '「著者」と数字だけの表示名は使えません';

// Characters that draw nothing (docs/multi-author-requirements.md §10.4): controls and format
// characters (zero-width space, joiners, bidi overrides, soft hyphen), and the fillers that render
// as a blank. Neither trim() nor NFKC removes them, so `k\u200Benta` would pass for kenta and a
// lone U+200B for a name.
const INVISIBLE_SOURCE = '[\\p{Cc}\\p{Cf}\\u115F\\u1160\\u3164\\uFFA0\\u2800]';
const INVISIBLE = new RegExp(INVISIBLE_SOURCE, 'u');
const INVISIBLE_ALL = new RegExp(INVISIBLE_SOURCE, 'gu');

export function stripInvisible(value: string): string {
  return value.replace(INVISIBLE_ALL, '');
}

// The shape of the placeholder a new author gets (lib/google-login.ts placeholderDisplayName). No one
// may choose it, or a name taken ahead of time would make the placeholder for that id a duplicate.
const RESERVED = /^著者\s*\d+$/u;

// How often an author may rename themselves (docs/multi-author-requirements.md §10.4): renaming
// again and again is how a troll blends in. An admin is not limited.
export const DISPLAY_NAME_CHANGE_INTERVAL_HOURS = 24;
const HOUR_MS = 60 * 60 * 1000;

export function renameTooSoon(nextAt: Date): string {
  return `表示名を変えられるのは 1 日 1 回です。次は ${formatRevisionTime(nextAt.getTime(), nextAt.getTime())} から変えられます。`;
}

export type DisplayNameErrors = { displayName?: string };
export type DisplayNameResult =
  { ok: true; value: string } | { ok: false; error: string; errors: DisplayNameErrors };

export function validateDisplayName(raw: string): DisplayNameResult {
  const trimmed = raw.trim();
  if (/[\r\n]/.test(trimmed)) {
    return { ok: false, error: NO_LINE_BREAKS, errors: { displayName: NO_LINE_BREAKS } };
  }
  if (INVISIBLE.test(trimmed)) {
    return {
      ok: false,
      error: DISPLAY_NAME_INVISIBLE,
      errors: { displayName: DISPLAY_NAME_INVISIBLE },
    };
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

// Two names that only differ in width or case are one name (§10.4): ＫＥＮＴＡ would pass for kenta.
export function displayNameKey(name: string): string {
  return name.normalize('NFKC').toLowerCase().trim();
}

export function isReservedDisplayName(name: string): boolean {
  return RESERVED.test(displayNameKey(name));
}

type Reader = Pick<AppDatabase, 'select'>;

// Whether someone other than `exceptUserId` currently goes by this name. Past names are free, or a
// renamed author's old name could never be used again. An empty name is never taken.
export function isDisplayNameTaken(
  name: string,
  exceptUserId: number | null,
  reader: Reader = db,
): boolean {
  const key = displayNameKey(name);
  if (!key) return false;
  const others = reader
    .select({ displayName: users.displayName })
    .from(users)
    .where(exceptUserId === null ? undefined : ne(users.id, exceptUserId))
    .all();
  return others.some((other) => displayNameKey(other.displayName) === key);
}

// When this account may next rename itself, or null if it may now. Only names the person set
// count, so a new author can still replace the one Google gave them on the first day.
export function nextRenameAt(userId: number, now: Date, reader: Reader = db): Date | null {
  const last = reader
    .select({ changedAt: displayNameHistory.changedAt })
    .from(displayNameHistory)
    .where(and(eq(displayNameHistory.userId, userId), eq(displayNameHistory.kind, 'change')))
    .orderBy(desc(displayNameHistory.changedAt), desc(displayNameHistory.id))
    .get();
  if (!last) return null;
  const next = new Date(Date.parse(last.changedAt) + DISPLAY_NAME_CHANGE_INTERVAL_HOURS * HOUR_MS);
  return next.getTime() > now.getTime() ? next : null;
}

export type SaveDisplayNameResult = { ok: true } | { ok: false; error: string };

// Saves a name the person chose (§6.1, §10.4): the format rules, then no empty name for a Google
// author, no name another account goes by, and the rename interval for an author. A name that
// differs from the current one is written to the history in the same transaction.
export function saveDisplayName(
  userId: number,
  raw: string,
  now: Date = new Date(),
): SaveDisplayNameResult {
  const format = validateDisplayName(raw);
  if (!format.ok) return { ok: false, error: format.error };
  const name = format.value;

  return db.transaction((tx) => {
    const user = tx
      .select({ role: users.role, googleSub: users.googleSub, displayName: users.displayName })
      .from(users)
      .where(eq(users.id, userId))
      .get();
    if (!user) return { ok: false, error: DISPLAY_NAME_REQUIRED };
    // Before the unchanged check, so a Google author left with an empty name cannot keep it.
    if (!name && user.googleSub !== null) return { ok: false, error: DISPLAY_NAME_REQUIRED };
    if (name === user.displayName) return { ok: true };
    if (isReservedDisplayName(name)) return { ok: false, error: DISPLAY_NAME_RESERVED };
    if (isDisplayNameTaken(name, userId, tx)) return { ok: false, error: DISPLAY_NAME_TAKEN };
    if (user.role === 'author') {
      const next = nextRenameAt(userId, now, tx);
      if (next) return { ok: false, error: renameTooSoon(next) };
    }
    tx.update(users).set({ displayName: name }).where(eq(users.id, userId)).run();
    tx.insert(displayNameHistory)
      .values({ userId, displayName: name, kind: 'change', changedAt: now.toISOString() })
      .run();
    return { ok: true };
  });
}
