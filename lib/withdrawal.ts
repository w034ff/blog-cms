import 'server-only';
import { and, count, eq, isNull } from 'drizzle-orm';
import { db } from '@/lib/db';
import { posts, users } from '@/lib/db/schema';
import { withdrawalDueAt } from '@/lib/withdrawal-rules';

// An author's own withdrawal (docs/multi-author-requirements.md §12.5). The purge that ends it is
// scripts/purge-withdrawn.mts.

// Starts a withdrawal and returns its deadline. Null, with nothing changed, for an admin (§12.1), a
// missing row, or an author already withdrawing.
export function requestWithdrawal(userId: number, now: Date = new Date()): string | null {
  const dueAt = withdrawalDueAt(now).toISOString();
  const result = db
    .update(users)
    .set({ withdrawalDueAt: dueAt })
    .where(and(eq(users.id, userId), eq(users.role, 'author'), isNull(users.withdrawalDueAt)))
    .run();
  return result.changes > 0 ? dueAt : null;
}

// Allowed for as long as the row exists, past the deadline included (§12.5).
export function cancelWithdrawal(userId: number): void {
  db.update(users).set({ withdrawalDueAt: null }).where(eq(users.id, userId)).run();
}

// What the withdrawal page says will go: the author's rows of each kind, drafts included.
export function countAuthoredRows(userId: number): { posts: number; scribbles: number } {
  const rows = db
    .select({ kind: posts.kind, n: count() })
    .from(posts)
    .where(eq(posts.authorId, userId))
    .groupBy(posts.kind)
    .all();
  return {
    posts: rows.find((row) => row.kind === 'post')?.n ?? 0,
    scribbles: rows.find((row) => row.kind === 'scribble')?.n ?? 0,
  };
}
