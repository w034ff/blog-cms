import 'server-only';
import { desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { appSettings, authorAllowlist } from '@/lib/db/schema';
import {
  AUTHOR_ACCESS_MODE_KEY,
  DEFAULT_AUTHOR_ACCESS_MODE,
  isAuthorAccessMode,
  normalizeEmail,
  type AuthorAccessMode,
} from '@/lib/author-access-rules';

// Who may become an author (docs/multi-author-requirements.md §9.4). Callers check that the
// account is an admin; these functions only read and write.

export function readAuthorAccessMode(): AuthorAccessMode {
  const row = db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, AUTHOR_ACCESS_MODE_KEY))
    .get();
  return isAuthorAccessMode(row?.value) ? row.value : DEFAULT_AUTHOR_ACCESS_MODE;
}

export function saveAuthorAccessMode(mode: AuthorAccessMode): void {
  db.insert(appSettings)
    .values({ key: AUTHOR_ACCESS_MODE_KEY, value: mode })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: mode } })
    .run();
}

export type Invite = { email: string; createdAt: string };

// Newest first, the order the users screen lists them in (§9.5).
export function listInvites(): Invite[] {
  return db
    .select()
    .from(authorAllowlist)
    .orderBy(desc(authorAllowlist.createdAt), desc(authorAllowlist.email))
    .all();
}

export function isInvited(email: string): boolean {
  return (
    db
      .select({ email: authorAllowlist.email })
      .from(authorAllowlist)
      .where(eq(authorAllowlist.email, normalizeEmail(email)))
      .get() !== undefined
  );
}

// The address must already be checked for shape. `duplicate` when it is already invited.
export function addInvite(email: string, now: Date = new Date()): 'added' | 'duplicate' {
  const result = db
    .insert(authorAllowlist)
    .values({ email: normalizeEmail(email), createdAt: now.toISOString() })
    .onConflictDoNothing()
    .run();
  return result.changes === 0 ? 'duplicate' : 'added';
}

export function removeInvite(email: string): void {
  db.delete(authorAllowlist)
    .where(eq(authorAllowlist.email, normalizeEmail(email)))
    .run();
}
