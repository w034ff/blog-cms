import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { posts } from '@/lib/db/schema';
import { normalizeNewlines } from '@/lib/draft-content';
import { deleteRevisionsOf, liveContentOfRow, recordRevision } from '@/lib/revisions';
import type { PostKind } from '@/lib/content';
import type { DraftContent } from '@/lib/types';

export type PostInput = {
  // The opaque public slug, assigned once at row creation (drafts included) and
  // never changed afterwards.
  slug: string;
  title: string;
  date: string;
  category: string;
  tags: string[];
  draft: boolean;
  body: string;
  thumbnail: string;
  // Required, not left to the column's default: every creation path says which list it feeds.
  kind: PostKind;
};

// Whether a slug is already taken. Used at publish time to keep public URLs
// unique; null slugs (drafts) never match a lookup.
export function slugExists(slug: string): boolean {
  const row = db.select({ id: posts.id }).from(posts).where(eq(posts.slug, slug)).get();
  return row !== undefined;
}

// Whether a post row exists by its stable internal id.
export function postExists(id: number): boolean {
  const row = db.select({ id: posts.id }).from(posts).where(eq(posts.id, id)).get();
  return row !== undefined;
}

// A row's kind by its id, or null when there is no such row. The write paths read it to decide what
// the row may hold (`contentForKind`); a kind is never written after creation.
export function postKind(id: number): PostKind | null {
  const row = db.select({ kind: posts.kind }).from(posts).where(eq(posts.id, id)).get();
  return row?.kind ?? null;
}

// Insert a new post and return its generated id.
export function createPost(input: PostInput): number {
  const now = new Date().toISOString();
  const row = db
    .insert(posts)
    .values({
      ...input,
      body: normalizeNewlines(input.body),
      createdAt: now,
      updatedAt: now,
      editedAt: now,
    })
    .returning({ id: posts.id })
    .get();
  return row.id;
}

// Revisions go with the post, in the same transaction (docs/revision-requirements.md §4 says why
// this is not a foreign-key cascade).
export function deletePost(id: number): void {
  db.transaction(() => {
    deleteRevisionsOf(id);
    db.delete(posts).where(eq(posts.id, id)).run();
  });
}

// Persist in-progress edits without publishing. The destination depends on the
// post's current visibility:
//  - Unpublished (draft=true): the row itself is the draft and is never public,
//    so edits go straight to the live columns.
//  - Published (draft=false): edits go to the private working copy
//    (draft_content) so the live (public) columns stay frozen until the author
//    publishes. A non-null draft_content is how the editor knows there are
//    "unpublished changes".
// No-op if the post no longer exists (e.g. deleted in another tab).
export function autosavePost(id: number, content: DraftContent): void {
  const row = db
    .select({ draft: posts.draft, title: posts.title, draftContent: posts.draftContent })
    .from(posts)
    .where(eq(posts.id, id))
    .get();
  if (!row) return;
  const normalized = { ...content, body: normalizeNewlines(content.body) };
  // Never let autosave wipe an existing title. The title field is briefly empty
  // whenever the author clears it to retype; if a debounced autosave fires in
  // that window (or the in-progress retype is then lost to navigation), the
  // blank would overwrite a real title and surface as an empty title in the
  // admin list. Keep the stored title when the incoming one is blank.
  //
  // The title to keep is the one this save's own destination already holds. For a published post
  // that is the working copy's, not the live column's: the author may have retitled the post in an
  // earlier session and not published it yet, and restoring the live title there would silently
  // undo that edit — the guard against losing a title would be the thing losing one. `draft_content`
  // is JSON whose shape is only asserted (see lib/posts.ts), so a row written before a field
  // existed can hand back undefined; a missing or blank title there falls back to the live column.
  const pendingTitle = row.draft ? '' : (row.draftContent?.title ?? '');
  const keptTitle = pendingTitle.trim() === '' ? row.title : pendingTitle;
  const safe = normalized.title.trim() === '' ? { ...normalized, title: keptTitle } : normalized;
  const now = new Date().toISOString();
  if (row.draft) {
    db.update(posts)
      .set({ ...safe, updatedAt: now, editedAt: now })
      .where(eq(posts.id, id))
      .run();
  } else {
    // `updatedAt` stays: it is the public 更新日, and nothing public changed.
    db.update(posts).set({ draftContent: safe, editedAt: now }).where(eq(posts.id, id)).run();
  }
}

// Commit content to the live (public) columns and set visibility, discarding any
// pending working copy. Used by both publish (draft=false) and unpublish
// (draft=true): the button click carries the current editor content, so the
// live version always matches what the author sees at the moment they commit.
// The slug is never touched here — it was assigned at row creation and is the
// post's permanent URL.
//
// `date` is the public publish date, decided by the caller. It is captured once
// at first publish and preserved verbatim thereafter (re-publish, plain update,
// and unpublish all pass the existing value back), so it reflects when the post
// first went live rather than the latest edit.
// Returns false if the row was gone by the time this ran (e.g. deleted from
// another tab between the caller's existence check and this call) instead of
// silently no-oping the update.
//
// A published post's live version is kept as a `publish` revision before it is replaced
// (docs/revision-requirements.md §3) — here rather than at the moment it went live, so a post
// published before revisions existed still has its version kept on its first update. A draft's
// live columns are not a published version, and what replaces them is what autosave just wrote.
export function commitPost(
  id: number,
  content: DraftContent,
  draft: boolean,
  date: string,
): boolean {
  return db.transaction(() => {
    const row = db.select().from(posts).where(eq(posts.id, id)).get();
    if (!row) return false;
    if (!row.draft) recordRevision(id, 'publish', liveContentOfRow(row));
    return writeCommit(id, content, draft, date);
  });
}

function writeCommit(id: number, content: DraftContent, draft: boolean, date: string): boolean {
  const now = new Date().toISOString();
  const result = db
    .update(posts)
    .set({
      ...content,
      body: normalizeNewlines(content.body),
      date,
      draft,
      draftContent: null,
      updatedAt: now,
      editedAt: now,
    })
    .where(eq(posts.id, id))
    .run();
  return result.changes > 0;
}
