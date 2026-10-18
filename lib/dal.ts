import 'server-only';
import { cache } from 'react';
import { notFound, redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { getSession } from '@/lib/session';
import type { SessionPayload } from '@/lib/session-token';

// The signed-in account, with what is needed to name it (lib/account-name.ts).
export type SessionUser = SessionPayload & { displayName: string; username: string | null };

export const getOptionalSession = cache(async (): Promise<SessionUser | null> => {
  const session = await getSession();
  if (!session) return null;
  const user = db
    .select({
      suspendedAt: users.suspendedAt,
      displayName: users.displayName,
      username: users.username,
    })
    .from(users)
    .where(eq(users.id, session.userId))
    .get();
  if (!user || user.suspendedAt !== null) {
    return null;
  }
  return { userId: session.userId, displayName: user.displayName, username: user.username };
});

export const verifySession = cache(async (): Promise<SessionUser> => {
  const session = await getOptionalSession();
  if (!session) {
    redirect('/login');
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
