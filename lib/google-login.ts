import 'server-only';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { authorAllowlist, displayNameHistory, users } from '@/lib/db/schema';
import { normalizeEmail, type AuthorAccessMode } from '@/lib/author-access-rules';
import { readAuthorAccessMode } from '@/lib/author-access';
import {
  DISPLAY_NAME_MAX_CHARS,
  isDisplayNameTaken,
  isReservedDisplayName,
  stripInvisible,
} from '@/lib/display-name';
import { automaticHandle } from '@/lib/handle-rules';
import { hashEmail } from '@/lib/email-hash';
import type { GoogleClaims } from '@/lib/google-oidc';
import type { GoogleLoginError } from '@/lib/google-login-errors';

export type GoogleLoginDecision =
  | { kind: 'login'; userId: number }
  | { kind: 'create'; joinedVia: 'invite' | 'open' }
  | { kind: 'reject'; reason: Extract<GoogleLoginError, 'not_invited' | 'suspended'> };

// Whether a verified Google account may sign in (docs/multi-author-requirements.md §9.3, step 4).
// An invite gates only the creation of an account: an existing author is let in whatever the
// policy and the invites say, so tightening the policy never locks anyone out (§9.1).
export function decideGoogleLogin(input: {
  existing: { id: number; suspendedAt: string | null } | null;
  mode: AuthorAccessMode;
  invited: boolean;
}): GoogleLoginDecision {
  if (input.existing) {
    return input.existing.suspendedAt === null
      ? { kind: 'login', userId: input.existing.id }
      : { kind: 'reject', reason: 'suspended' };
  }
  // An invite is recorded as the way in even under the open policy: the admin chose this person.
  if (input.invited) return { kind: 'create', joinedVia: 'invite' };
  return input.mode === 'open'
    ? { kind: 'create', joinedVia: 'open' }
    : { kind: 'reject', reason: 'not_invited' };
}

// A new author's display name: Google's `name` with line breaks removed, cut to the display name's
// limit in code points (§9.2), so it already passes the account form's rules.
export function initialDisplayName(name: string): string {
  const oneLine = stripInvisible(name.replace(/[\r\n]+/g, ' ')).trim();
  return Array.from(oneLine).slice(0, DISPLAY_NAME_MAX_CHARS).join('').trim();
}

export type GoogleSignIn = { ok: true; userId: number } | { ok: false; reason: GoogleLoginError };

// The name a new author starts with when Google's is empty or another account already goes by it
// (§10.4): unique by construction, and plainly a placeholder.
function placeholderDisplayName(userId: number): string {
  return `著者 ${userId}`;
}

// Finds or creates the author for verified claims, in one transaction with the invite it uses up.
// The email itself is stored nowhere (§9.1); only its keyed hash, rewritten on every sign-in so a
// re-keyed hash heals (§10.3).
export function signInWithGoogle(claims: GoogleClaims, now: Date = new Date()): GoogleSignIn {
  const email = normalizeEmail(claims.email);
  const emailHash = hashEmail(email);
  return db.transaction((tx) => {
    const existing =
      tx
        .select({ id: users.id, suspendedAt: users.suspendedAt })
        .from(users)
        .where(eq(users.googleSub, claims.sub))
        .get() ?? null;
    const invited =
      tx
        .select({ email: authorAllowlist.email })
        .from(authorAllowlist)
        .where(eq(authorAllowlist.email, email))
        .get() !== undefined;
    const decision = decideGoogleLogin({ existing, mode: readAuthorAccessMode(), invited });
    if (decision.kind === 'reject') return { ok: false, reason: decision.reason };

    // An invite for someone who is already an author would otherwise sit as 招待中 forever.
    tx.delete(authorAllowlist).where(eq(authorAllowlist.email, email)).run();
    if (decision.kind === 'login') {
      tx.update(users).set({ emailHash }).where(eq(users.id, decision.userId)).run();
      return { ok: true, userId: decision.userId };
    }

    const created = tx
      .insert(users)
      .values({
        role: 'author',
        googleSub: claims.sub,
        joinedVia: decision.joinedVia,
        emailHash,
        createdAt: now.toISOString(),
      })
      .returning({ id: users.id })
      .get();
    const fromGoogle = initialDisplayName(claims.name);
    const displayName =
      fromGoogle &&
      !isReservedDisplayName(fromGoogle) &&
      !isDisplayNameTaken(fromGoogle, created.id, tx)
        ? fromGoogle
        : placeholderDisplayName(created.id);
    // The ID needs the row's id, so it is written here rather than in the insert (§13.2).
    tx.update(users)
      .set({ displayName, handle: automaticHandle(created.id) })
      .where(eq(users.id, created.id))
      .run();
    tx.insert(displayNameHistory)
      .values({ userId: created.id, displayName, kind: 'initial', changedAt: now.toISOString() })
      .run();
    return { ok: true, userId: created.id };
  });
}
