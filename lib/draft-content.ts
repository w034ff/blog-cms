import { normalizeCategory } from '@/lib/content';
import type { DraftContent } from '@/lib/types';

// The pieces of DraftContent handling that more than one table needs: `posts.draft_content` and
// `post_revisions.content` store the same shape and hit the same two hazards, so the answers live
// here rather than in whichever module met the hazard first.

// The two ways content reaches the server disagree about line endings: autosave posts JSON and
// keeps the editor's LF, while publish/unpublish go through a form, and form submission rewrites
// every newline in a value to CRLF. Left alone, a post's stored markdown flips between the two
// depending on which button was pressed, and every line-based reader of the body has to know it —
// lib/footnotes.ts did not, and counted written footnotes as empty. One form is stored: LF, what
// the editor serialized in the first place.
export function normalizeNewlines(body: string): string {
  return body.replace(/\r\n?/g, '\n');
}

// A JSON column typed with `$type<DraftContent>()` only asserts its shape — nothing validates what
// is actually in it. Every row written before a field existed is missing that field, and the
// assertion hides it: `thumbnail` came in 2026-08-15, so a post that had pending edits before then
// hands back `undefined` where the type promises a string. That reached the editor as a field
// showing 「なし」 while its label claimed an image had been chosen, with the body fallback skipped,
// because `undefined === ''` is false.
//
// `category` is the same hazard from the other side: the field was always there, but its values
// were free text until 2026-09-23. drizzle/0008 moved the stored ones onto the fixed list; this
// catches whatever it could not see.
//
// Normalized at the read rather than at each consumer. A field added to DraftContent later needs
// its default added here too.
export function normalizeDraftContent(stored: DraftContent): DraftContent {
  return {
    ...stored,
    category: normalizeCategory(stored.category),
    thumbnail: stored.thumbnail ?? '',
  };
}

// Whether two contents are the same post as an author would see it. Written out field by field on
// purpose: a field added to DraftContent later needs a line here too, the same obligation
// `normalizeDraftContent` above carries for its defaults.
export function sameDraftContent(a: DraftContent, b: DraftContent): boolean {
  return (
    a.title === b.title &&
    a.category === b.category &&
    a.body === b.body &&
    a.thumbnail === b.thumbnail &&
    a.tags.length === b.tags.length &&
    a.tags.every((tag, index) => tag === b.tags[index])
  );
}
