import type Database from 'better-sqlite3';

// Deleting one account with everything it wrote (docs/multi-author-requirements.md §12.3). The one
// implementation behind both the admin's delete (§12.4) and the nightly purge of withdrawals that
// are due (§12.6). It takes a raw better-sqlite3 connection and imports nothing through `@/`
// because scripts/purge-withdrawn.mts runs it under plain node; the app passes `db.$client`.
//
// What a post takes with it matches `deletePost` (lib/posts-write.ts): its revisions and every
// library row that points at it. user-delete.test.ts checks every `post_id`, `user_id` and
// `author_id` column in the schema, so a table added later cannot be left holding a deleted id.

// Which state the account must be in for the deletion to go ahead. Checked inside the transaction:
// a withdrawal cancelled after the purge listed its targets, or an unsuspend that lands between the
// admin's click and the write, wins.
export type DeleteUserCondition = { kind: 'suspended' } | { kind: 'withdrawal-due'; now: Date };

// True when the account was deleted. False, with nothing changed, when it does not exist, is an
// admin, or is not in the state the condition names.
export function deleteUserAccount(
  sqlite: Database.Database,
  userId: number,
  condition: DeleteUserCondition,
): boolean {
  // Immediate: the purge runs in its own process beside the app, and a deferred transaction that
  // reads first cannot upgrade to a write after another connection commits (scripts/open-db.mts).
  return sqlite
    .transaction((): boolean => {
      const row = sqlite
        .prepare('SELECT role, suspended_at, withdrawal_due_at FROM users WHERE id = ?')
        .get(userId);
      if (!isDeletable(row, condition)) return false;

      const postIds = sqlite
        .prepare('SELECT id FROM posts WHERE author_id = ?')
        .pluck()
        .all(userId);
      const perPost = ['post_revisions', 'bookmarks', 'likes', 'post_views'].map((table) =>
        sqlite.prepare(`DELETE FROM ${table} WHERE post_id = ?`),
      );
      for (const postId of postIds) for (const statement of perPost) statement.run(postId);
      sqlite.prepare('DELETE FROM posts WHERE author_id = ?').run(userId);

      for (const table of ['bookmarks', 'likes', 'post_views', 'display_name_history', 'uploads']) {
        sqlite.prepare(`DELETE FROM ${table} WHERE user_id = ?`).run(userId);
      }
      sqlite.prepare('DELETE FROM users WHERE id = ?').run(userId);
      return true;
    })
    .immediate();
}

function isDeletable(row: unknown, condition: DeleteUserCondition): boolean {
  if (typeof row !== 'object' || row === null) return false;
  if (!('role' in row) || row.role !== 'author') return false;
  if (condition.kind === 'suspended') {
    return 'suspended_at' in row && typeof row.suspended_at === 'string';
  }
  if (!('withdrawal_due_at' in row) || typeof row.withdrawal_due_at !== 'string') return false;
  return isWithdrawalDue(row.withdrawal_due_at, condition.now);
}

// Whether a withdrawal deadline (`users.withdrawal_due_at`) has passed. Anything unparseable is
// never due: a row that cannot be read is kept, not deleted.
export function isWithdrawalDue(dueAt: string, now: Date): boolean {
  const due = new Date(dueAt).getTime();
  return !Number.isNaN(due) && due <= now.getTime();
}
