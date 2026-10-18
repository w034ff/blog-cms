import 'server-only';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { authorAllowlist, users } from '@/lib/db/schema';
import { normalizeEmail, type AuthorAccessMode } from '@/lib/author-access-rules';
import { readAuthorAccessMode } from '@/lib/author-access';
import { DISPLAY_NAME_MAX_CHARS } from '@/lib/display-name';
import type { GoogleClaims } from '@/lib/google-oidc';
import type { GoogleLoginError } from '@/lib/google-login-errors';

export type GoogleLoginDecision =
  | { kind: 'login'; userId: number }
  | { kind: 'create' }
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
  return input.mode === 'open' || input.invited
    ? { kind: 'create' }
    : { kind: 'reject', reason: 'not_invited' };
}

// A new author's display name: Google's `name` with line breaks removed, cut to the display name's
// limit in code points (§9.2), so it already passes the account form's rules.
export function initialDisplayName(name: string): string {
  const oneLine = name.replace(/[\r\n]+/g, ' ').trim();
  return Array.from(oneLine).slice(0, DISPLAY_NAME_MAX_CHARS).join('').trim();
}

export type GoogleSignIn = { ok: true; userId: number } | { ok: false; reason: GoogleLoginError };

// Finds or creates the author for verified claims, in one transaction with the invite it uses up.
// The email is read here and nowhere stored on the user (§9.1).
export function signInWithGoogle(claims: GoogleClaims): GoogleSignIn {
  const email = normalizeEmail(claims.email);
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
    if (decision.kind === 'login') return { ok: true, userId: decision.userId };

    const created = tx
      .insert(users)
      .values({
        role: 'author',
        googleSub: claims.sub,
        displayName: initialDisplayName(claims.name),
      })
      .returning({ id: users.id })
      .get();
    return { ok: true, userId: created.id };
  });
}
