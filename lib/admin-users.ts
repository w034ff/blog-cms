import 'server-only';
import { asc, count, eq, isNotNull } from 'drizzle-orm';
import { db } from '@/lib/db';
import { posts, users } from '@/lib/db/schema';

// Admin users management: listing, suspending, and unsuspending accounts
// (docs/multi-author-requirements.md §5, §9.5).

export type AdminUser = {
  id: number;
  displayName: string;
  role: 'admin' | 'author';
  suspendedAt: string | null;
  isGoogle: boolean;
  postCount: number;
  scribbleCount: number;
};

// Users ordered by id asc (§9.5), with post and scribble counts including drafts.
export function listAdminUsers(): AdminUser[] {
  const userRows = db
    .select({
      id: users.id,
      displayName: users.displayName,
      role: users.role,
      suspendedAt: users.suspendedAt,
      googleSub: users.googleSub,
    })
    .from(users)
    .orderBy(asc(users.id))
    .all();

  const counts = db
    .select({
      authorId: posts.authorId,
      kind: posts.kind,
      count: count(),
    })
    .from(posts)
    .where(isNotNull(posts.authorId))
    .groupBy(posts.authorId, posts.kind)
    .all();

  const countsMap = new Map<number, { post: number; scribble: number }>();
  for (const c of counts) {
    if (c.authorId === null) continue;
    const entry = countsMap.get(c.authorId) ?? { post: 0, scribble: 0 };
    if (c.kind === 'post') entry.post = c.count;
    else if (c.kind === 'scribble') entry.scribble = c.count;
    countsMap.set(c.authorId, entry);
  }

  return userRows.map((u) => {
    const c = countsMap.get(u.id) ?? { post: 0, scribble: 0 };
    return {
      id: u.id,
      displayName: u.displayName,
      role: u.role,
      suspendedAt: u.suspendedAt,
      isGoogle: u.googleSub !== null,
      postCount: c.post,
      scribbleCount: c.scribble,
    };
  });
}

// Suspends an author. Refuses admin accounts and makes no change (docs/multi-author-requirements.md §2, §5).
export function suspendUser(id: number, now: Date = new Date()): boolean {
  const user = db.select({ role: users.role }).from(users).where(eq(users.id, id)).get();
  if (!user || user.role === 'admin') return false;
  db.update(users).set({ suspendedAt: now.toISOString() }).where(eq(users.id, id)).run();
  return true;
}

// Unsuspends an account, restoring it to active status.
export function unsuspendUser(id: number): boolean {
  const result = db.update(users).set({ suspendedAt: null }).where(eq(users.id, id)).run();
  return result.changes > 0;
}
