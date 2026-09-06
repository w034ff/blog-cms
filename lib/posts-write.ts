import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { posts } from '@/lib/db/schema';
import type { DraftContent } from '@/lib/types';

export type PostInput = {
  // The opaque public slug, assigned once at row creation (drafts included) and
  // never changed afterwards.
  slug: string;
  title: string;
  date: string;
  description: string;
  category: string;
  tags: string[];
  draft: boolean;
  body: string;
  thumbnail: string;
  unlisted: boolean;
};

// The two ways content reaches the server disagree about line endings: autosave posts JSON and
// keeps the editor's LF, while publish/unpublish go through a form, and form submission rewrites
// every newline in a value to CRLF. Left alone, a post's stored markdown flips between the two
// depending on which button was pressed, and every line-based reader of the body has to know it —
// lib/footnotes.ts did not, and counted written footnotes as empty. One form is stored: LF, what
// the editor serialized in the first place.
function normalizeNewlines(body: string): string {
  return body.replace(/\r\n?/g, '\n');
}

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

// Insert a new post and return its generated id.
export function createPost(input: PostInput): number {
  const now = new Date().toISOString();
  const row = db
    .insert(posts)
    .values({ ...input, body: normalizeNewlines(input.body), createdAt: now, updatedAt: now })
    .returning({ id: posts.id })
    .get();
  return row.id;
}

export function updatePost(id: number, input: PostInput): void {
  db.update(posts)
    .set({ ...input, body: normalizeNewlines(input.body), updatedAt: new Date().toISOString() })
    .where(eq(posts.id, id))
    .run();
}

export function deletePost(id: number): void {
  db.delete(posts).where(eq(posts.id, id)).run();
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
    .select({ draft: posts.draft, title: posts.title })
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
  const safe = normalized.title.trim() === '' ? { ...normalized, title: row.title } : normalized;
  if (row.draft) {
    db.update(posts)
      .set({ ...safe, updatedAt: new Date().toISOString() })
      .where(eq(posts.id, id))
      .run();
  } else {
    db.update(posts).set({ draftContent: safe }).where(eq(posts.id, id)).run();
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
export function commitPost(
  id: number,
  content: DraftContent,
  draft: boolean,
  date: string,
): boolean {
  const result = db
    .update(posts)
    .set({
      ...content,
      body: normalizeNewlines(content.body),
      date,
      draft,
      draftContent: null,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(posts.id, id))
    .run();
  return result.changes > 0;
}
