import 'server-only';
import { and, asc, count, desc, eq, isNotNull } from 'drizzle-orm';
import { db } from '@/lib/db';
import { authorAllowlist, displayNameHistory, posts, users } from '@/lib/db/schema';
import { normalizeEmail } from '@/lib/author-access-rules';
import { hashEmail } from '@/lib/email-hash';
import { deleteUserAccount } from '@/lib/user-delete';
import type { PostKind } from '@/lib/content';

// Admin users management: listing, suspending, and unsuspending accounts
// (docs/multi-author-requirements.md §5, §9.5).

export type AdminUser = {
  id: number;
  displayName: string;
  role: 'admin' | 'author';
  suspendedAt: string | null;
  // The withdrawal deadline (§12.2), or null when not withdrawing.
  withdrawalDueAt: string | null;
  isGoogle: boolean;
  joinedVia: 'invite' | 'open' | null;
  postCount: number;
  scribbleCount: number;
  // Names before the current one, newest first, at most PREVIOUS_NAMES_SHOWN
  // (docs/multi-author-requirements.md §10.5).
  previousNames: string[];
  // Every history row, the current name's included: the N of すべて見る（N 件）.
  historyCount: number;
};

// How many earlier names a row of the list shows; the rest are on the detail page (§10.5).
export const PREVIOUS_NAMES_SHOWN = 3;

// Users ordered by id asc (§9.5), with post and scribble counts including drafts.
export function listAdminUsers(): AdminUser[] {
  const userRows = db
    .select({
      id: users.id,
      displayName: users.displayName,
      role: users.role,
      suspendedAt: users.suspendedAt,
      withdrawalDueAt: users.withdrawalDueAt,
      googleSub: users.googleSub,
      joinedVia: users.joinedVia,
    })
    .from(users)
    .orderBy(asc(users.id))
    .all();

  const history = new Map<number, string[]>();
  for (const row of db
    .select({ userId: displayNameHistory.userId, displayName: displayNameHistory.displayName })
    .from(displayNameHistory)
    .orderBy(desc(displayNameHistory.changedAt), desc(displayNameHistory.id))
    .all()) {
    const names = history.get(row.userId) ?? [];
    names.push(row.displayName);
    history.set(row.userId, names);
  }

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
      withdrawalDueAt: u.withdrawalDueAt,
      isGoogle: u.googleSub !== null,
      joinedVia: u.joinedVia,
      postCount: c.post,
      scribbleCount: c.scribble,
      // The newest row is the current name.
      previousNames: (history.get(u.id) ?? []).slice(1, 1 + PREVIOUS_NAMES_SHOWN),
      historyCount: history.get(u.id)?.length ?? 0,
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

// Deletes a suspended author with everything they wrote (docs/multi-author-requirements.md §12.4).
// False, with nothing changed, for an admin, an author who is not suspended, or a missing id.
export function deleteSuspendedAuthor(id: number): boolean {
  return deleteUserAccount(db.$client, id, { kind: 'suspended' });
}

export type EmailLookup = { userIds: number[]; inviteEmails: string[] };

// The accounts and pending invites that belong to an email (docs/multi-author-requirements.md §10.3).
// Accounts are matched by keyed hash, invites by their stored address; both after normalizing.
export function lookupByEmail(email: string): EmailLookup {
  const normalized = normalizeEmail(email);
  if (!normalized) return { userIds: [], inviteEmails: [] };
  const userIds = db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.emailHash, hashEmail(normalized)))
    .orderBy(asc(users.id))
    .all()
    .map((row) => row.id);
  const inviteEmails = db
    .select({ email: authorAllowlist.email })
    .from(authorAllowlist)
    .where(eq(authorAllowlist.email, normalized))
    .all()
    .map((row) => row.email);
  return { userIds, inviteEmails };
}

// How many of each kind of row the detail page lists (§10.6); the rest are counted, not listed.
export const DETAIL_POSTS_SHOWN = 50;

export type UserDetailPost = { id: number; title: string; draft: boolean; createdAt: string };

export type UserDetail = {
  id: number;
  displayName: string;
  username: string | null;
  role: 'admin' | 'author';
  suspendedAt: string | null;
  withdrawalDueAt: string | null;
  isGoogle: boolean;
  joinedVia: 'invite' | 'open' | null;
  createdAt: string | null;
  // Every name, newest first; the first is the current one.
  history: { displayName: string; changedAt: string }[];
  posts: Record<PostKind, { total: number; rows: UserDetailPost[] }>;
};

// Everything the detail page shows (§10.6), or null for an id with no account.
export function getUserDetail(id: number): UserDetail | null {
  if (!Number.isSafeInteger(id)) return null;
  const user = db.select().from(users).where(eq(users.id, id)).get();
  if (!user) return null;

  const history = db
    .select({
      displayName: displayNameHistory.displayName,
      changedAt: displayNameHistory.changedAt,
    })
    .from(displayNameHistory)
    .where(eq(displayNameHistory.userId, id))
    .orderBy(desc(displayNameHistory.changedAt), desc(displayNameHistory.id))
    .all();

  const postsOf = (kind: PostKind) => {
    const where = and(eq(posts.authorId, id), eq(posts.kind, kind));
    const total = db.select({ n: count() }).from(posts).where(where).get()?.n ?? 0;
    const rows = db
      .select({ id: posts.id, title: posts.title, draft: posts.draft, createdAt: posts.createdAt })
      .from(posts)
      .where(where)
      .orderBy(desc(posts.createdAt), desc(posts.id))
      .limit(DETAIL_POSTS_SHOWN)
      .all();
    return { total, rows };
  };

  return {
    id: user.id,
    displayName: user.displayName,
    username: user.username,
    role: user.role,
    suspendedAt: user.suspendedAt,
    withdrawalDueAt: user.withdrawalDueAt,
    isGoogle: user.googleSub !== null,
    joinedVia: user.joinedVia,
    createdAt: user.createdAt,
    history,
    posts: { post: postsOf('post'), scribble: postsOf('scribble') },
  };
}
