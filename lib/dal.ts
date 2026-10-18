import 'server-only';
import { cache } from 'react';
import { notFound, redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { handleOf } from '@/lib/handle';
import { getSession } from '@/lib/session';
import type { SessionPayload } from '@/lib/session-token';

// The signed-in account, with what is needed to name it (lib/account-name.ts).
export type SessionUser = SessionPayload & { displayName: string; handle: string };

// Where a withdrawing author's session leads (docs/multi-author-requirements.md §12.5). Outside
// /admin: app/admin/layout.tsx refuses everyone getOptionalSession does not return, so a page
// under it would send a withdrawing author back to itself.
export const WITHDRAWAL_PATH = '/withdrawal';

// The session's account row, read once per request.
const readAccount = cache(async () => {
  const session = await getSession();
  if (!session) return null;
  const user = db
    .select({
      suspendedAt: users.suspendedAt,
      withdrawalDueAt: users.withdrawalDueAt,
      displayName: users.displayName,
      handle: users.handle,
    })
    .from(users)
    .where(eq(users.id, session.userId))
    .get();
  return user ? { userId: session.userId, ...user } : null;
});

// A withdrawing author counts as signed out everywhere but the withdrawal page and its two
// actions (§12.5), so no write path needs its own check.
export const getOptionalSession = cache(async (): Promise<SessionUser | null> => {
  const account = await readAccount();
  if (!account || account.suspendedAt !== null || account.withdrawalDueAt !== null) {
    return null;
  }
  return {
    userId: account.userId,
    displayName: account.displayName,
    handle: handleOf({ id: account.userId, handle: account.handle }),
  };
});

// The signed-in author whose withdrawal is pending, for the withdrawal page, its cancel and its
// sign-out. Null for anyone else; suspension wins, as it does at sign-in.
export const getWithdrawingSession = cache(
  async (): Promise<{ userId: number; withdrawalDueAt: string } | null> => {
    const account = await readAccount();
    if (!account || account.suspendedAt !== null || account.withdrawalDueAt === null) {
      return null;
    }
    return { userId: account.userId, withdrawalDueAt: account.withdrawalDueAt };
  },
);

export const verifySession = cache(async (): Promise<SessionUser> => {
  const session = await getOptionalSession();
  if (!session) {
    // Not /login: it would send a still-signed-in withdrawing author straight back (§5's loop).
    redirect((await getWithdrawingSession()) ? WITHDRAWAL_PATH : '/login');
  }
  return session;
});

// Whether the signed-in account is an admin (docs/editor-requirements.md §12.33.1). Asked of the
// database rather than the session token, so a demotion holds from the next request on.
export const isAdmin = cache(async (): Promise<boolean> => {
  const session = await verifySession();
  const row = db.select({ role: users.role }).from(users).where(eq(users.id, session.userId)).get();
  return row?.role === 'admin';
});

// For an admin-only page. A 404 rather than a 403: `forbidden()` needs the experimental
// `authInterrupts`, and an author has no use for knowing the screen is there.
export async function verifyAdmin(): Promise<void> {
  if (!(await isAdmin())) notFound();
}
