import { and, desc, eq, inArray, ne } from 'drizzle-orm';
import { db } from '@/lib/db';
import { postRevisions, posts } from '@/lib/db/schema';
import { normalizeDraftContent, normalizeNewlines, sameDraftContent } from '@/lib/draft-content';
import type { DraftContent } from '@/lib/types';

// Past versions of a post and the restore that brings one back (docs/revision-requirements.md).
// Synchronous like lib/posts-write.ts, whose writes call into here from inside their own
// transactions — better-sqlite3 transactions belong to the connection, so these statements join
// the caller's rather than committing on their own.

export type RevisionReason = (typeof postRevisions.$inferSelect)['reason'];

export type Revision = {
  id: number;
  postId: number;
  createdAt: number;
  reason: RevisionReason;
  content: DraftContent;
};

// How many revisions a post keeps, per pool (§4). Two pools so that the `session` revisions every
// editing session adds cannot push out the published versions, which are fewer and the ones most
// worth finding later.
export const REVISION_KEEP = { publish: 5, other: 5 } as const;

type PostRow = typeof posts.$inferSelect;
type RevisionRow = typeof postRevisions.$inferSelect;

// A post's live columns in the shape a revision stores. `tags` is JSON asserted by `$type`, so it
// is checked rather than trusted, the same call `toPost` in lib/posts.ts makes.
export function liveContentOfRow(row: PostRow): DraftContent {
  return {
    title: row.title,
    category: row.category,
    tags: Array.isArray(row.tags) ? row.tags.filter((tag) => typeof tag === 'string') : [],
    body: row.body,
    thumbnail: row.thumbnail,
  };
}

function toRevision(row: RevisionRow): Revision {
  return { ...row, content: normalizeDraftContent(row.content) };
}

// Which pool a reason counts against. Everything but `publish` shares one.
function inPool(reason: RevisionReason) {
  return reason === 'publish'
    ? eq(postRevisions.reason, 'publish')
    : ne(postRevisions.reason, 'publish');
}

// Keep `content` as a revision of the post, unless the newest revision in the same pool already
// holds the same thing (§3). Returns whether a row was added.
//
// Newlines are normalized before the comparison, not only before the insert: publish arrives
// through a form as CRLF, and without this a `publish` revision and the `session` one after it
// would differ by line endings alone.
//
// Pruning happens here, in the same statement group as the insert, so there is no background job
// to schedule and no moment at which a post holds more than its allowance.
export function recordRevision(
  postId: number,
  reason: RevisionReason,
  content: DraftContent,
): boolean {
  const normalized = { ...normalizeDraftContent(content), body: normalizeNewlines(content.body) };
  const latest = db
    .select()
    .from(postRevisions)
    .where(and(eq(postRevisions.postId, postId), inPool(reason)))
    .orderBy(desc(postRevisions.id))
    .get();
  if (latest && sameDraftContent(normalizeDraftContent(latest.content), normalized)) return false;

  db.insert(postRevisions)
    .values({ postId, reason, content: normalized, createdAt: Date.now() })
    .run();

  // Ordered by id rather than created_at: two revisions can share a millisecond, an id cannot.
  const keep = reason === 'publish' ? REVISION_KEEP.publish : REVISION_KEEP.other;
  const stale = db
    .select({ id: postRevisions.id })
    .from(postRevisions)
    .where(and(eq(postRevisions.postId, postId), inPool(reason)))
    .orderBy(desc(postRevisions.id))
    .all()
    .slice(keep)
    .map((row) => row.id);
  if (stale.length > 0) {
    db.delete(postRevisions).where(inArray(postRevisions.id, stale)).run();
  }
  return true;
}

// Newest first, which is the order the history page lists them in.
export function listRevisions(postId: number): Revision[] {
  return db
    .select()
    .from(postRevisions)
    .where(eq(postRevisions.postId, postId))
    .orderBy(desc(postRevisions.id))
    .all()
    .map(toRevision);
}

// Scoped by post as well as id, so a revision id pasted onto another post's URL finds nothing.
export function getRevision(postId: number, revisionId: number): Revision | null {
  const row = db
    .select()
    .from(postRevisions)
    .where(and(eq(postRevisions.id, revisionId), eq(postRevisions.postId, postId)))
    .get();
  return row ? toRevision(row) : null;
}

export function deleteRevisionsOf(postId: number): void {
  db.delete(postRevisions).where(eq(postRevisions.postId, postId)).run();
}

// What a restore can bring back: a stored revision, or — for a published post — the version that
// is live right now, which is how pending edits are discarded (§2).
export type RestoreTarget = number | 'live';

// Write a past version to where autosave writes, keeping what it replaces as a `restore` revision
// first so the restore itself can be undone (§5). Never publishes: a published post's live columns
// are not touched.
//
// Returns false when there is nothing to restore — the post is gone, the revision is not this
// post's, or 'live' was asked of a draft, which has no live version.
export function restoreRevision(postId: number, target: RestoreTarget): boolean {
  return db.transaction(() => {
    const row = db.select().from(posts).where(eq(posts.id, postId)).get();
    if (!row) return false;
    const live = liveContentOfRow(row);

    if (row.draft) {
      if (target === 'live') return false;
      const revision = getRevision(postId, target);
      if (!revision) return false;
      recordRevision(postId, 'restore', live);
      db.update(posts)
        .set({ ...revision.content, updatedAt: new Date().toISOString() })
        .where(eq(posts.id, postId))
        .run();
      return true;
    }

    // Published: the working copy is what autosave would have written, so it is what a restore
    // replaces. An empty one replaces nothing — the live version it stands for is still in the row.
    let restored: DraftContent;
    if (target === 'live') {
      restored = live;
    } else {
      const revision = getRevision(postId, target);
      if (!revision) return false;
      restored = revision.content;
    }
    if (row.draftContent) {
      recordRevision(postId, 'restore', normalizeDraftContent(row.draftContent));
    }
    // A working copy identical to the live columns is no pending edit (lib/posts.ts
    // hasUnpublishedEdits), so it is stored as none — which is also exactly what discarding is.
    const draftContent = sameDraftContent(restored, live) ? null : restored;
    db.update(posts).set({ draftContent }).where(eq(posts.id, postId)).run();
    return true;
  });
}
